use std::sync::Arc;

use chrono::Utc;
use nostr_sdk::prelude::*;
use nostr_sdk::RelayStatus;
use serde_json::Value;
use uuid::Uuid;
use zeroize::Zeroize;

use ::hkdf::Hkdf;
use ::sha2::Sha256;

use crate::config::Config;
use crate::crypto::KeyEncryptor;
use crate::db::{Database, Identity, PendingAuth};

pub struct Bunker {
    signer_keys: Keys,
    client: Client,
    db: Database,
    crypto: Arc<KeyEncryptor>,
    config: Config,
}

impl Bunker {
    pub async fn new(
        db: Database,
        crypto: Arc<KeyEncryptor>,
        config: Config,
    ) -> Result<Self, String> {
        // Derive a deterministic keypair from MASTER_KEY so the bunker pubkey
        // stays stable across restarts (clients cache it in bunker:// URIs).
        let signer_keys = {
            let hk = Hkdf::<Sha256>::new(None, &config.master_key);
            let mut okm = [0u8; 32];
            hk.expand(b"nostr-bunker-signer-key", &mut okm)
                .map_err(|e| format!("HKDF expand failed: {e}"))?;
            let sk = SecretKey::from_slice(&okm)
                .map_err(|e| format!("Invalid derived secret key: {e}"))?;
            Keys::new(sk)
        };
        let client = Client::builder().signer(signer_keys.clone()).build();

        for relay in &config.nostr_relays {
            client
                .add_relay(relay.as_str())
                .await
                .map_err(|e| format!("Failed to add relay {relay}: {e}"))?;
        }

        client.connect().await;

        tracing::info!(
            bunker_pubkey = %signer_keys.public_key.to_hex(),
            "Bunker started"
        );

        Ok(Self {
            signer_keys,
            client,
            db,
            crypto,
            config,
        })
    }

    pub fn pubkey(&self) -> PublicKey {
        self.signer_keys.public_key
    }

    pub fn client(&self) -> Client {
        self.client.clone()
    }

    pub fn keys(&self) -> Keys {
        self.signer_keys.clone()
    }

    pub async fn run(&self) {
        let filter = Filter::new()
            .kind(Kind::NostrConnect)
            .pubkey(self.signer_keys.public_key);

        if let Err(e) = self.client.subscribe(filter, None).await {
            tracing::error!(error = %e, "Failed to subscribe to NIP-46 events");
            return;
        }

        tracing::info!(
            bunker_pubkey = %self.signer_keys.public_key.to_hex(),
            "Bunker subscribed to NIP-46 events"
        );

        // Spawn a background task to monitor relay connections and reconnect if needed
        let client_for_health = self.client.clone();
        let health_handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;
                let relays = client_for_health.relays().await;
                for (url, relay) in &relays {
                    let status = relay.status();
                    if status != RelayStatus::Connected {
                        tracing::warn!(
                            relay = %url,
                            status = %status,
                            "Relay not connected, reconnecting"
                        );
                    }
                }
                client_for_health.connect().await;
            }
        });

        let _ = self
            .client
            .handle_notifications(|notification| async move {
                match &notification {
                    RelayPoolNotification::Event { event, .. } => {
                        tracing::info!(
                            kind = %event.kind,
                            author = %event.pubkey.to_hex(),
                            event_id = %event.id.to_hex(),
                            "Received relay event"
                        );
                        if event.kind == Kind::NostrConnect {
                            if let Err(e) = self.handle_nip46_event(&event).await {
                                tracing::warn!(
                                    error = %e,
                                    author = %event.pubkey.to_hex(),
                                    "Failed to handle NIP-46 event"
                                );
                            }
                        }
                    }
                    RelayPoolNotification::Message { relay_url, message } => {
                        tracing::debug!(
                            relay = %relay_url,
                            message = ?message,
                            "Relay message"
                        );
                    }
                    _ => {
                        tracing::debug!("Other relay notification: {:?}", notification);
                    }
                }
                Ok(false) // never exit
            })
            .await;

        health_handle.abort();
    }

    async fn handle_nip46_event(&self, event: &Event) -> Result<(), String> {
        tracing::info!(
            author = %event.pubkey.to_hex(),
            "Decrypting NIP-46 event"
        );
        let content = self.decrypt_content(event).await?;

        tracing::info!(content = %content, "Decrypted NIP-46 content");

        let parsed: Value =
            serde_json::from_str(&content).map_err(|e| format!("Invalid JSON: {e}"))?;

        let id = parsed["id"]
            .as_str()
            .ok_or("Missing 'id' field")?;
        let method = parsed["method"]
            .as_str()
            .ok_or("Missing 'method' field")?;
        let params = parsed["params"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        let client_pubkey = event.pubkey;

        tracing::info!(
            method = %method,
            id = %id,
            client = %client_pubkey.to_hex(),
            "Handling NIP-46 method"
        );

        let response = match method {
            "connect" => self.handle_connect(id, &client_pubkey, &params).await,
            "get_public_key" => self.handle_get_public_key(id, &client_pubkey).await,
            "sign_event" => self.handle_sign_event(id, &client_pubkey, &params).await,
            "nip44_encrypt" => self.handle_nip44_encrypt(id, &client_pubkey, &params).await,
            "nip44_decrypt" => self.handle_nip44_decrypt(id, &client_pubkey, &params).await,
            "nip04_encrypt" => self.handle_nip04_encrypt(id, &client_pubkey, &params).await,
            "nip04_decrypt" => self.handle_nip04_decrypt(id, &client_pubkey, &params).await,
            "ping" => Ok(nip46_result(id, "pong")),
            _ => Ok(nip46_error(id, &format!("Unknown method: {method}"))),
        };

        let response_str = response?;
        self.send_response(client_pubkey, &response_str).await?;

        Ok(())
    }

    async fn handle_connect(
        &self,
        id: &str,
        client_pubkey: &PublicKey,
        params: &[Value],
    ) -> Result<String, String> {
        let client_pk_hex = client_pubkey.to_hex();

        // Check for existing connection
        let connections = self
            .db
            .list_connections_by_client_pubkey(&client_pk_hex)
            .map_err(|e| format!("DB error: {e}"))?;

        if !connections.is_empty() {
            return Ok(nip46_result(id, "ack"));
        }

        // No existing connection; create pending auth
        let request_id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();

        // Extract secret from params if provided (params[1] is optional secret)
        let secret = params
            .get(1)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Extract relay from params if provided (params[0] is the remote pubkey)
        let relay_url = self
            .config
            .nostr_relays
            .first()
            .cloned()
            .unwrap_or_default();

        let pending = PendingAuth {
            request_id: request_id.clone(),
            client_pubkey: client_pk_hex,
            relay_url,
            secret,
            nip46_id: id.to_string(),
            created_at: now,
            expires_at: now + 600, // 10 minutes
        };

        self.db
            .create_pending_auth(&pending)
            .map_err(|e| format!("DB error creating pending auth: {e}"))?;

        let auth_url = format!("{}/auth/{}", self.config.public_url, request_id);
        Ok(nip46_auth_url(id, &auth_url))
    }

    async fn handle_get_public_key(
        &self,
        id: &str,
        client_pubkey: &PublicKey,
    ) -> Result<String, String> {
        let identity = self.find_identity_by_client(client_pubkey).await?;
        Ok(nip46_result(id, &identity.pubkey))
    }

    async fn handle_sign_event(
        &self,
        id: &str,
        client_pubkey: &PublicKey,
        params: &[Value],
    ) -> Result<String, String> {
        let identity = self.find_identity_by_client(client_pubkey).await?;

        let event_json = params
            .first()
            .and_then(|v| v.as_str())
            .ok_or("Missing event JSON param")?;

        // NIP-46 clients may omit `pubkey` from the unsigned event — we need to
        // inject the identity's pubkey before deserializing.
        let mut event_value: serde_json::Value =
            serde_json::from_str(event_json).map_err(|e| format!("Invalid event JSON: {e}"))?;
        if let Some(obj) = event_value.as_object_mut() {
            if !obj.contains_key("pubkey") {
                obj.insert("pubkey".to_string(), serde_json::Value::String(identity.pubkey.clone()));
            }
        }
        let patched_json = serde_json::to_string(&event_value)
            .map_err(|e| format!("Failed to serialize patched event: {e}"))?;

        let unsigned: UnsignedEvent =
            UnsignedEvent::from_json(&patched_json).map_err(|e| format!("Invalid unsigned event: {e}"))?;

        let mut secret_bytes = self
            .crypto
            .decrypt_nsec(&identity.id, &identity.encrypted_nsec, &identity.nonce)?;

        let secret_key = SecretKey::from_slice(&secret_bytes)
            .map_err(|e| format!("Invalid secret key: {e}"))?;
        let identity_keys = Keys::new(secret_key);

        let signed = unsigned
            .sign_with_keys(&identity_keys)
            .map_err(|e| format!("Signing failed: {e}"))?;

        secret_bytes.zeroize();

        let signed_json = signed.as_json();
        Ok(nip46_result(id, &signed_json))
    }

    async fn handle_nip44_encrypt(
        &self,
        id: &str,
        client_pubkey: &PublicKey,
        params: &[Value],
    ) -> Result<String, String> {
        let identity = self.find_identity_by_client(client_pubkey).await?;

        let third_party_hex = params
            .first()
            .and_then(|v| v.as_str())
            .ok_or("Missing third-party pubkey")?;
        let plaintext = params
            .get(1)
            .and_then(|v| v.as_str())
            .ok_or("Missing plaintext")?;

        let third_party_pk = PublicKey::from_hex(third_party_hex)
            .map_err(|e| format!("Invalid pubkey: {e}"))?;

        let mut secret_bytes = self
            .crypto
            .decrypt_nsec(&identity.id, &identity.encrypted_nsec, &identity.nonce)?;
        let secret_key = SecretKey::from_slice(&secret_bytes)
            .map_err(|e| format!("Invalid secret key: {e}"))?;

        let encrypted = nip44::encrypt(&secret_key, &third_party_pk, plaintext, nip44::Version::V2)
            .map_err(|e| format!("NIP-44 encrypt failed: {e}"))?;

        secret_bytes.zeroize();

        Ok(nip46_result(id, &encrypted))
    }

    async fn handle_nip44_decrypt(
        &self,
        id: &str,
        client_pubkey: &PublicKey,
        params: &[Value],
    ) -> Result<String, String> {
        let identity = self.find_identity_by_client(client_pubkey).await?;

        let third_party_hex = params
            .first()
            .and_then(|v| v.as_str())
            .ok_or("Missing third-party pubkey")?;
        let ciphertext = params
            .get(1)
            .and_then(|v| v.as_str())
            .ok_or("Missing ciphertext")?;

        let third_party_pk = PublicKey::from_hex(third_party_hex)
            .map_err(|e| format!("Invalid pubkey: {e}"))?;

        let mut secret_bytes = self
            .crypto
            .decrypt_nsec(&identity.id, &identity.encrypted_nsec, &identity.nonce)?;
        let secret_key = SecretKey::from_slice(&secret_bytes)
            .map_err(|e| format!("Invalid secret key: {e}"))?;

        let decrypted = nip44::decrypt(&secret_key, &third_party_pk, ciphertext)
            .map_err(|e| format!("NIP-44 decrypt failed: {e}"))?;

        secret_bytes.zeroize();

        Ok(nip46_result(id, &decrypted))
    }

    async fn handle_nip04_encrypt(
        &self,
        id: &str,
        client_pubkey: &PublicKey,
        params: &[Value],
    ) -> Result<String, String> {
        let identity = self.find_identity_by_client(client_pubkey).await?;

        let third_party_hex = params
            .first()
            .and_then(|v| v.as_str())
            .ok_or("Missing third-party pubkey")?;
        let plaintext = params
            .get(1)
            .and_then(|v| v.as_str())
            .ok_or("Missing plaintext")?;

        let third_party_pk = PublicKey::from_hex(third_party_hex)
            .map_err(|e| format!("Invalid pubkey: {e}"))?;

        let mut secret_bytes = self
            .crypto
            .decrypt_nsec(&identity.id, &identity.encrypted_nsec, &identity.nonce)?;
        let secret_key = SecretKey::from_slice(&secret_bytes)
            .map_err(|e| format!("Invalid secret key: {e}"))?;

        let encrypted = nip04::encrypt(&secret_key, &third_party_pk, plaintext)
            .map_err(|e| format!("NIP-04 encrypt failed: {e}"))?;

        secret_bytes.zeroize();

        Ok(nip46_result(id, &encrypted))
    }

    async fn handle_nip04_decrypt(
        &self,
        id: &str,
        client_pubkey: &PublicKey,
        params: &[Value],
    ) -> Result<String, String> {
        let identity = self.find_identity_by_client(client_pubkey).await?;

        let third_party_hex = params
            .first()
            .and_then(|v| v.as_str())
            .ok_or("Missing third-party pubkey")?;
        let ciphertext = params
            .get(1)
            .and_then(|v| v.as_str())
            .ok_or("Missing ciphertext")?;

        let third_party_pk = PublicKey::from_hex(third_party_hex)
            .map_err(|e| format!("Invalid pubkey: {e}"))?;

        let mut secret_bytes = self
            .crypto
            .decrypt_nsec(&identity.id, &identity.encrypted_nsec, &identity.nonce)?;
        let secret_key = SecretKey::from_slice(&secret_bytes)
            .map_err(|e| format!("Invalid secret key: {e}"))?;

        let decrypted = nip04::decrypt(&secret_key, &third_party_pk, ciphertext)
            .map_err(|e| format!("NIP-04 decrypt failed: {e}"))?;

        secret_bytes.zeroize();

        Ok(nip46_result(id, &decrypted))
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    async fn decrypt_content(&self, event: &Event) -> Result<String, String> {
        let sk = self.signer_keys.secret_key();
        let pk = &event.pubkey;

        // Try NIP-44 first, fall back to NIP-04
        match nip44::decrypt(sk, pk, &event.content) {
            Ok(decrypted) => Ok(decrypted),
            Err(_) => nip04::decrypt(sk, pk, &event.content)
                .map_err(|e| format!("Decryption failed (NIP-44 and NIP-04): {e}")),
        }
    }

    async fn send_response(&self, to: PublicKey, content: &str) -> Result<(), String> {
        let sk = self.signer_keys.secret_key();

        let encrypted = nip44::encrypt(sk, &to, content, nip44::Version::V2)
            .map_err(|e| format!("NIP-44 encrypt response failed: {e}"))?;

        let event_builder =
            EventBuilder::new(Kind::NostrConnect, &encrypted).tag(Tag::public_key(to));

        self.client
            .send_event_builder(event_builder)
            .await
            .map_err(|e| format!("Failed to send response: {e}"))?;

        Ok(())
    }

    async fn find_identity_by_client(&self, client_pubkey: &PublicKey) -> Result<Identity, String> {
        let client_pk_hex = client_pubkey.to_hex();

        self.db
            .find_identity_by_client_pubkey(&client_pk_hex)
            .map_err(|e| format!("DB error: {e}"))?
            .ok_or_else(|| "No identity found for this client".to_string())
    }
}

// ---------------------------------------------------------------------------
// NIP-46 JSON response helpers
// ---------------------------------------------------------------------------

fn nip46_result(id: &str, result: &str) -> String {
    serde_json::json!({
        "id": id,
        "result": result,
    })
    .to_string()
}

fn nip46_error(id: &str, error: &str) -> String {
    serde_json::json!({
        "id": id,
        "result": "",
        "error": error,
    })
    .to_string()
}

fn nip46_auth_url(id: &str, auth_url: &str) -> String {
    serde_json::json!({
        "id": id,
        "result": "auth_url",
        "error": auth_url,
    })
    .to_string()
}
