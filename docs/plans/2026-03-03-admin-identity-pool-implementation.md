# Admin-Managed Identity Pool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-user nsec generation with an admin-managed pool of Nostr identities that users choose from during the NIP-46 connection flow.

**Architecture:** New `identities` table stores admin-managed encrypted nsecs. The `users` table is simplified to be OAuth-only (no crypto columns). Connections link to an identity instead of deriving keys from users. The AuthPopup gains an identity picker step after OAuth.

**Tech Stack:** Rust/Axum backend, SQLite, AES-256-GCM encryption, React/TypeScript frontend, nostr-tools for relay profile fetching.

---

### Task 1: Add `Identity` struct and `identities` table to DB

**Files:**
- Modify: `src/db.rs`

**Step 1: Add the Identity data struct**

Add after the `PendingAuth` struct (after line 47):

```rust
#[derive(Debug, Clone)]
pub struct Identity {
    pub id: String,
    pub encrypted_nsec: Vec<u8>,
    pub nonce: Vec<u8>,
    pub pubkey: String,
    pub label: Option<String>,
    pub created_at: i64,
}
```

**Step 2: Add identities table to `run_migrations`**

Add inside the `run_migrations` method's `execute_batch` string, after the `pending_auth` table (before line 121):

```sql
CREATE TABLE IF NOT EXISTS identities (
    id              TEXT    PRIMARY KEY,
    encrypted_nsec  BLOB    NOT NULL,
    nonce           BLOB    NOT NULL,
    pubkey          TEXT    NOT NULL UNIQUE,
    label           TEXT,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identities_pubkey ON identities(pubkey);
```

**Step 3: Add `identity_id` column to connections via alter migration**

Add to `run_alter_migrations` (after the email migration block, after line 147):

```rust
// Add identity_id column to connections table if it doesn't exist
let has_identity_id: bool = conn
    .prepare("SELECT COUNT(*) FROM pragma_table_info('connections') WHERE name = 'identity_id'")?
    .query_row([], |row| row.get::<_, i64>(0))
    .map(|count| count > 0)?;

if !has_identity_id {
    conn.execute_batch("ALTER TABLE connections ADD COLUMN identity_id TEXT REFERENCES identities(id);")?;
}
```

**Step 4: Add CRUD methods for identities**

Add a new section after the Pending Auth section:

```rust
// -----------------------------------------------------------------------
// Identities
// -----------------------------------------------------------------------

pub fn create_identity(&self, identity: &Identity) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO identities (id, encrypted_nsec, nonce, pubkey, label, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            identity.id,
            identity.encrypted_nsec,
            identity.nonce,
            identity.pubkey,
            identity.label,
            identity.created_at,
        ],
    )?;
    Ok(())
}

pub fn list_identities(&self) -> rusqlite::Result<Vec<Identity>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, encrypted_nsec, nonce, pubkey, label, created_at
         FROM identities ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Identity {
            id: row.get(0)?,
            encrypted_nsec: row.get(1)?,
            nonce: row.get(2)?,
            pubkey: row.get(3)?,
            label: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn find_identity_by_id(&self, id: &str) -> rusqlite::Result<Option<Identity>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, encrypted_nsec, nonce, pubkey, label, created_at
         FROM identities WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(Identity {
            id: row.get(0)?,
            encrypted_nsec: row.get(1)?,
            nonce: row.get(2)?,
            pubkey: row.get(3)?,
            label: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn delete_identity(&self, id: &str) -> rusqlite::Result<bool> {
    let conn = self.conn.lock().unwrap();
    let affected = conn.execute(
        "DELETE FROM identities WHERE id = ?1",
        params![id],
    )?;
    Ok(affected > 0)
}

pub fn count_connections_for_identity(&self, identity_id: &str) -> rusqlite::Result<i64> {
    let conn = self.conn.lock().unwrap();
    conn.prepare("SELECT COUNT(*) FROM connections WHERE identity_id = ?1")?
        .query_row(params![identity_id], |row| row.get(0))
}
```

**Step 5: Add connection creation with identity_id**

Add a new method for creating connections with identity_id:

```rust
pub fn create_connection_with_identity(&self, connection: &NipConnection, identity_id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO connections (id, user_id, client_pubkey, relay_url, identity_id, created_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            connection.id,
            connection.user_id,
            connection.client_pubkey,
            connection.relay_url,
            identity_id,
            connection.created_at,
            connection.last_used_at,
        ],
    )?;
    Ok(())
}
```

**Step 6: Add method to find identity by connection's client_pubkey**

```rust
pub fn find_identity_by_client_pubkey(&self, client_pubkey: &str) -> rusqlite::Result<Option<Identity>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT i.id, i.encrypted_nsec, i.nonce, i.pubkey, i.label, i.created_at
         FROM identities i
         JOIN connections c ON c.identity_id = i.id
         WHERE c.client_pubkey = ?1
         ORDER BY c.created_at DESC
         LIMIT 1",
    )?;
    let mut rows = stmt.query_map(params![client_pubkey], |row| {
        Ok(Identity {
            id: row.get(0)?,
            encrypted_nsec: row.get(1)?,
            nonce: row.get(2)?,
            pubkey: row.get(3)?,
            label: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}
```

**Step 7: Build and verify compilation**

Run: `cargo build 2>&1 | head -30`
Expected: Compiles (may have unused warnings, that's fine)

**Step 8: Commit**

```bash
git add src/db.rs
git commit -m "feat: add identities table and CRUD methods"
```

---

### Task 2: Modify bunker to use identities instead of users for key operations

**Files:**
- Modify: `src/bunker.rs`

**Step 1: Change the import to include Identity**

Change line 15 from:
```rust
use crate::db::{Database, PendingAuth, User};
```
to:
```rust
use crate::db::{Database, Identity, PendingAuth};
```

**Step 2: Replace `find_user_by_client` with `find_identity_by_client`**

Replace the `find_user_by_client` method (lines 482-498) with:

```rust
async fn find_identity_by_client(&self, client_pubkey: &PublicKey) -> Result<Identity, String> {
    let client_pk_hex = client_pubkey.to_hex();

    self.db
        .find_identity_by_client_pubkey(&client_pk_hex)
        .map_err(|e| format!("DB error: {e}"))?
        .ok_or_else(|| "No connection/identity found for this client".to_string())
}
```

**Step 3: Update `handle_get_public_key` to use identity**

Replace lines 258-265:

```rust
async fn handle_get_public_key(
    &self,
    id: &str,
    client_pubkey: &PublicKey,
) -> Result<String, String> {
    let identity = self.find_identity_by_client(client_pubkey).await?;
    Ok(nip46_result(id, &identity.pubkey))
}
```

**Step 4: Update `handle_sign_event` to use identity**

Replace lines 267-311. Change all references from `user` to `identity`:

```rust
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
    let user_keys = Keys::new(secret_key);

    let signed = unsigned
        .sign_with_keys(&user_keys)
        .map_err(|e| format!("Signing failed: {e}"))?;

    secret_bytes.zeroize();

    let signed_json = signed.as_json();
    Ok(nip46_result(id, &signed_json))
}
```

**Step 5: Update all NIP-44/NIP-04 encrypt/decrypt handlers similarly**

For each of the four handlers (`handle_nip44_encrypt`, `handle_nip44_decrypt`, `handle_nip04_encrypt`, `handle_nip04_decrypt`), change:
- `let user = self.find_user_by_client(client_pubkey).await?;` → `let identity = self.find_identity_by_client(client_pubkey).await?;`
- `self.crypto.decrypt_nsec(&user.id, &user.encrypted_nsec, &user.nonce)?` → `self.crypto.decrypt_nsec(&identity.id, &identity.encrypted_nsec, &identity.nonce)?`

**Step 6: Build and verify**

Run: `cargo build 2>&1 | head -30`
Expected: Compiles successfully

**Step 7: Commit**

```bash
git add src/bunker.rs
git commit -m "feat: bunker uses identities instead of users for key operations"
```

---

### Task 3: Add admin API endpoints for identity management

**Files:**
- Modify: `src/web.rs`

**Step 1: Add Identity import and new request/response structs**

Update the import at line 14 to include Identity:
```rust
use crate::db::{Identity, NipConnection, Session, User};
```

Add new structs near the other request/response structs (after `ImportKeyBody` around line 35):

```rust
#[derive(Deserialize)]
pub struct AddIdentityBody {
    pub nsec: String,
    pub label: Option<String>,
}

#[derive(Serialize)]
struct IdentityResponse {
    id: String,
    pubkey: String,
    label: Option<String>,
    created_at: i64,
    active_connections: i64,
}
```

**Step 2: Add routes to the router**

Add these routes in the `router()` function (after the existing routes, before the closing brace around line 103):

```rust
.route("/api/identities", get(api_list_identities))
.route("/api/admin/identities", post(api_add_identity))
.route("/api/admin/identities/{id}", delete(api_delete_identity))
.route("/api/select-identity", post(api_select_identity))
```

**Step 3: Implement `api_list_identities`**

```rust
async fn api_list_identities(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Response> {
    let identities = state.db.list_identities().map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    let response: Vec<IdentityResponse> = identities
        .into_iter()
        .map(|i| {
            let active_connections = state.db.count_connections_for_identity(&i.id).unwrap_or(0);
            IdentityResponse {
                id: i.id,
                pubkey: i.pubkey,
                label: i.label,
                created_at: i.created_at,
                active_connections,
            }
        })
        .collect();

    Ok(Json(response))
}
```

**Step 4: Implement `api_add_identity`**

```rust
async fn api_add_identity(
    State(state): State<AppState>,
    Json(body): Json<AddIdentityBody>,
) -> Result<impl IntoResponse, Response> {
    let secret_key = nostr_sdk::SecretKey::from_bech32(&body.nsec).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("Invalid nsec: {e}")}))).into_response()
    })?;

    let keys = Keys::new(secret_key);
    let pubkey = keys.public_key().to_hex();
    let secret_key_bytes = keys.secret_key().as_secret_bytes().to_vec();

    let identity_id = Uuid::new_v4().to_string();

    let (encrypted_nsec, nonce) = state
        .crypto
        .encrypt_nsec(&identity_id, &secret_key_bytes)
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Encryption error: {e}")}))).into_response()
        })?;

    let now = Utc::now().timestamp();
    let identity = Identity {
        id: identity_id,
        encrypted_nsec,
        nonce,
        pubkey: pubkey.clone(),
        label: body.label,
        created_at: now,
    };

    state.db.create_identity(&identity).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    let npub = nostr_sdk::PublicKey::from_hex(&pubkey)
        .map(|pk| pk.to_bech32().unwrap_or_default())
        .unwrap_or_default();

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": identity.id,
            "pubkey": pubkey,
            "npub": npub,
        })),
    ).into_response())
}
```

**Step 5: Implement `api_delete_identity`**

```rust
async fn api_delete_identity(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    let deleted = state.db.delete_identity(&id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    if deleted {
        Ok(Json(serde_json::json!({"deleted": true})))
    } else {
        Err((StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Identity not found"}))).into_response())
    }
}
```

**Step 6: Implement `api_select_identity`**

This is the key endpoint called from the AuthPopup after the user picks an identity:

```rust
#[derive(Deserialize)]
pub struct SelectIdentityBody {
    pub request_id: String,
    pub identity_id: String,
}

async fn api_select_identity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SelectIdentityBody>,
) -> Result<impl IntoResponse, Response> {
    let user = get_authenticated_user(&state, &headers)?;

    // Verify identity exists
    let identity = state.db.find_identity_by_id(&body.identity_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?.ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Identity not found"}))).into_response()
    })?;

    // Find and validate pending auth
    let pending = state.db.find_pending_auth(&body.request_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?.ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Pending auth not found or expired"}))).into_response()
    })?;

    // Create connection linking client_pubkey to user + identity
    let now = Utc::now().timestamp();
    let connection = NipConnection {
        id: Uuid::new_v4().to_string(),
        user_id: user.id.clone(),
        client_pubkey: pending.client_pubkey.clone(),
        relay_url: pending.relay_url.clone(),
        created_at: now,
        last_used_at: now,
    };
    state.db.create_connection_with_identity(&connection, &identity.id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Connection error: {e}")}))).into_response()
    })?;

    // Send NIP-46 ack
    if !pending.nip46_id.is_empty() {
        let ack_response = serde_json::json!({
            "id": pending.nip46_id,
            "result": "ack",
        })
        .to_string();

        let client_pk = PublicKey::from_hex(&pending.client_pubkey).map_err(|e| {
            tracing::error!("Invalid client pubkey: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Invalid client pubkey"}))).into_response()
        })?;

        let sk = state.signer_keys.secret_key();
        let encrypted = nip44::encrypt(sk, &client_pk, &ack_response, nip44::Version::V2)
            .map_err(|e| {
                tracing::error!("NIP-44 encrypt failed: {e}");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Encryption failed"}))).into_response()
            })?;

        let event_builder = EventBuilder::new(Kind::NostrConnect, &encrypted)
            .tag(Tag::public_key(client_pk));

        if let Err(e) = state.nostr_client.send_event_builder(event_builder).await {
            tracing::error!("Failed to send NIP-46 ack: {e}");
        } else {
            tracing::info!(
                client = %pending.client_pubkey,
                nip46_id = %pending.nip46_id,
                identity_pubkey = %identity.pubkey,
                "Sent NIP-46 connect ack after identity selection"
            );
        }
    }

    // Delete pending auth
    let _ = state.db.delete_pending_auth(&body.request_id);

    Ok(Json(serde_json::json!({
        "connected": true,
        "identity_pubkey": identity.pubkey,
    })))
}
```

**Step 7: Modify `handle_oauth_complete` for the NIP-46 flow**

The key change: when `request_id` is present, instead of creating the connection immediately and closing the popup, redirect back to the popup page so the user can pick an identity.

Replace the NIP-46 branch in `handle_oauth_complete` (the `if !request_id_str.is_empty()` block, lines 386-461) with:

```rust
    if !request_id_str.is_empty() {
        // NIP-46 flow: redirect back to popup for identity selection
        // The session cookie is set so the popup can call /api/select-identity
        Ok((
            StatusCode::SEE_OTHER,
            [
                (header::SET_COOKIE, cookie),
                (header::LOCATION, format!("/auth-popup/{}?authenticated=true", request_id_str)),
            ],
        )
            .into_response())
    } else {
```

**Step 8: Remove `api_import_key` endpoint and route**

Remove the `/api/import-key` route from the router and the `api_import_key` function. Also remove `ImportKeyBody` struct if desired (or leave it — removing is cleaner).

**Step 9: Build and verify**

Run: `cargo build 2>&1 | head -30`
Expected: Compiles

**Step 10: Commit**

```bash
git add src/web.rs
git commit -m "feat: admin identity API endpoints and identity selection flow"
```

---

### Task 4: Simplify User struct (remove crypto fields)

**Files:**
- Modify: `src/db.rs`
- Modify: `src/web.rs`

**Step 1: Remove crypto fields from User struct**

In `src/db.rs`, simplify the `User` struct (lines 10-19):

```rust
#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub oauth_provider: String,
    pub oauth_sub: String,
    pub email: Option<String>,
    pub created_at: i64,
}
```

**Step 2: Update `create_user` to not include crypto fields**

```rust
pub fn create_user(&self, user: &User) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO users (id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, email, created_at)
         VALUES (?1, ?2, ?3, X'00', X'00', '', ?4, ?5)",
        params![
            user.id,
            user.oauth_provider,
            user.oauth_sub,
            user.email,
            user.created_at,
        ],
    )?;
    Ok(())
}
```

Note: We keep inserting dummy values for `encrypted_nsec`, `nonce`, `pubkey` since the columns still exist in the table (SQLite schema can't easily drop columns on older versions). These columns are now unused but won't break anything.

**Step 3: Update all `find_user_*` methods to not read crypto columns**

Update `find_user_by_oauth`, `find_user_by_id` to select only non-crypto columns:

```rust
pub fn find_user_by_oauth(
    &self,
    provider: &str,
    sub: &str,
) -> rusqlite::Result<Option<User>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, oauth_provider, oauth_sub, email, created_at
         FROM users WHERE oauth_provider = ?1 AND oauth_sub = ?2",
    )?;
    let mut rows = stmt.query_map(params![provider, sub], |row| {
        Ok(User {
            id: row.get(0)?,
            oauth_provider: row.get(1)?,
            oauth_sub: row.get(2)?,
            email: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

pub fn find_user_by_id(&self, id: &str) -> rusqlite::Result<Option<User>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, oauth_provider, oauth_sub, email, created_at
         FROM users WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok(User {
            id: row.get(0)?,
            oauth_provider: row.get(1)?,
            oauth_sub: row.get(2)?,
            email: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}
```

**Step 4: Remove `update_user_key` and `update_user_email` methods**

Delete `update_user_key` (lines 236-249). Keep `update_user_email` as it's still useful.

**Step 5: Update `handle_oauth_complete` in web.rs**

Remove the key generation from the new-user branch. The user creation block in `handle_oauth_complete` (the `None =>` branch) becomes:

```rust
None => {
    let user_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    let user = User {
        id: user_id,
        oauth_provider: oauth_user.provider.clone(),
        oauth_sub: oauth_user.sub.clone(),
        email: oauth_user.email.clone(),
        created_at: now,
    };

    state.db.create_user(&user).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    user
}
```

**Step 6: Update `api_me` in web.rs**

Since users no longer have pubkeys, simplify the `/api/me` response:

```rust
#[derive(Serialize)]
struct MeResponse {
    user_id: String,
    oauth_provider: String,
    email: Option<String>,
    created_at: i64,
    bunker_url: String,
}
```

And update the handler:

```rust
async fn api_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    let user = get_authenticated_user(&state, &headers)?;

    let bunker_pk = state.bunker_pubkey.read().await;
    let signer_pubkey = bunker_pk.as_deref().unwrap_or_default();
    let relay_params: String = state
        .config
        .nostr_relays
        .iter()
        .map(|r| format!("relay={}", urlencoding::encode(r)))
        .collect::<Vec<_>>()
        .join("&");
    let bunker_url = format!("bunker://{}?{}", signer_pubkey, relay_params);

    Ok(Json(MeResponse {
        user_id: user.id,
        oauth_provider: user.oauth_provider,
        email: user.email,
        created_at: user.created_at,
        bunker_url,
    }))
}
```

**Step 7: Update `api_connections` since user no longer has pubkey**

The connection listing now needs to go through identity. Replace with listing connections by user_id:

```rust
async fn api_connections(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    let user = get_authenticated_user(&state, &headers)?;

    let connections = state.db.list_connections(&user.id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    let response: Vec<ConnectionResponse> = connections
        .into_iter()
        .map(|c| ConnectionResponse {
            id: c.id,
            client_pubkey: c.client_pubkey,
            relay_url: c.relay_url,
            created_at: c.created_at,
            last_used_at: c.last_used_at,
            is_own: true,
            oauth_provider: user.oauth_provider.clone(),
            oauth_sub: String::new(),
            created_by_email: user.email.clone(),
        })
        .collect();

    Ok(Json(response))
}
```

**Step 8: Remove `list_connections_by_pubkey` from db.rs**

This method is no longer needed (users don't have pubkeys). Remove it.

**Step 9: Build and verify**

Run: `cargo build 2>&1 | head -30`
Expected: Compiles

**Step 10: Commit**

```bash
git add src/db.rs src/web.rs
git commit -m "refactor: simplify User struct, remove per-user nsec"
```

---

### Task 5: Add Admin page to React frontend

**Files:**
- Modify: `web-ui/src/App.tsx`
- Create: `web-ui/src/pages/Admin.tsx`

**Step 1: Install nostr-tools**

Run: `cd web-ui && npm install nostr-tools`

This is needed for Task 6 (profile fetching) but install now to avoid a second npm install.

**Step 2: Create Admin.tsx**

Create `web-ui/src/pages/Admin.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Loader2, Trash2 } from 'lucide-react'

interface Identity {
  id: string
  pubkey: string
  label: string | null
  created_at: number
  active_connections: number
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 16) return pubkey
  return pubkey.slice(0, 8) + '...' + pubkey.slice(-8)
}

export default function Admin() {
  const [identities, setIdentities] = useState<Identity[]>([])
  const [loading, setLoading] = useState(true)
  const [nsecInput, setNsecInput] = useState('')
  const [labelInput, setLabelInput] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const fetchIdentities = async () => {
    try {
      const res = await fetch('/api/identities')
      if (res.ok) {
        setIdentities(await res.json())
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchIdentities()
  }, [])

  const handleAdd = async () => {
    setAddLoading(true)
    setAddError(null)
    try {
      const res = await fetch('/api/admin/identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nsec: nsecInput, label: labelInput || null }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to add identity')
      }
      setNsecInput('')
      setLabelInput('')
      await fetchIdentities()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add identity')
    } finally {
      setAddLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/identities/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setIdentities((prev) => prev.filter((i) => i.id !== id))
      }
    } catch {
      // silently fail
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen justify-center px-4 py-8">
      <div className="w-full max-w-[600px] space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Admin — Manage Identities</h1>

        {/* Add Identity */}
        <Card>
          <CardHeader>
            <CardTitle>Add Identity</CardTitle>
            <CardDescription>
              Add a Nostr secret key (nsec) to the identity pool. Users will be able to sign as this identity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nsec">nsec (Nostr secret key)</Label>
              <Input
                id="nsec"
                type="password"
                placeholder="nsec1..."
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="label">Label (optional)</Label>
              <Input
                id="label"
                placeholder="e.g. Company Bot, News Account"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
              />
            </div>
            {addError && (
              <p className="text-sm text-destructive">{addError}</p>
            )}
            <Button
              disabled={!nsecInput.startsWith('nsec1') || addLoading}
              onClick={handleAdd}
            >
              {addLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Identity
            </Button>
          </CardContent>
        </Card>

        {/* Identity List */}
        <Card>
          <CardHeader>
            <CardTitle>Identities</CardTitle>
            <CardDescription>
              {identities.length === 0
                ? 'No identities added yet.'
                : `${identities.length} identity${identities.length === 1 ? '' : 'ies'} in the pool.`}
            </CardDescription>
          </CardHeader>
          {identities.length > 0 && (
            <CardContent className="space-y-3">
              {identities.map((identity, i) => (
                <div key={identity.id}>
                  {i > 0 && <Separator className="mb-3" />}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-mono">
                          {truncatePubkey(identity.pubkey)}
                        </p>
                        {identity.label && (
                          <Badge variant="secondary">{identity.label}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {identity.active_connections} active connection{identity.active_connections === 1 ? '' : 's'}
                      </p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="icon" className="h-8 w-8 shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete identity?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {identity.active_connections > 0
                              ? `This identity has ${identity.active_connections} active connection(s). Deleting it may break existing connections.`
                              : 'This will permanently remove the identity from the pool.'}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(identity.id)}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  )
}
```

**Step 3: Add route to App.tsx**

Add import and route:

```tsx
import Admin from './pages/Admin'
```

Add route:
```tsx
<Route path="/admin" element={<Admin />} />
```

**Step 4: Build frontend and verify**

Run: `cd web-ui && npm run build`
Expected: Builds successfully

**Step 5: Commit**

```bash
git add web-ui/src/pages/Admin.tsx web-ui/src/App.tsx web-ui/package.json web-ui/package-lock.json
git commit -m "feat: add admin page for identity management"
```

---

### Task 6: Update AuthPopup with identity picker

**Files:**
- Modify: `web-ui/src/pages/AuthPopup.tsx`

**Step 1: Rewrite AuthPopup with two-phase flow**

Replace the entire contents of `AuthPopup.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { SimplePool, finalizeEvent } from 'nostr-tools'

const providers = [
  { name: 'Google', path: '/auth/google' },
  { name: 'GitHub', path: '/auth/github' },
  { name: 'Microsoft', path: '/auth/microsoft' },
  { name: 'Apple', path: '/auth/apple' },
]

const PROFILE_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nsec.app',
]

interface Identity {
  id: string
  pubkey: string
  label: string | null
}

interface NostrProfile {
  name?: string
  display_name?: string
  picture?: string
  about?: string
}

function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 16) return pubkey
  return pubkey.slice(0, 8) + '...' + pubkey.slice(-8)
}

export default function AuthPopup() {
  const { requestId } = useParams<{ requestId: string }>()
  const [searchParams] = useSearchParams()
  const authenticated = searchParams.get('authenticated') === 'true'

  const [identities, setIdentities] = useState<Identity[]>([])
  const [profiles, setProfiles] = useState<Record<string, NostrProfile>>({})
  const [loading, setLoading] = useState(false)
  const [selecting, setSelecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch identities and profiles when authenticated
  useEffect(() => {
    if (!authenticated) return

    setLoading(true)
    fetch('/api/identities')
      .then((res) => res.json())
      .then((data: Identity[]) => {
        setIdentities(data)
        // Fetch profiles from relays
        if (data.length > 0) {
          fetchProfiles(data.map((i) => i.pubkey))
        }
      })
      .catch(() => setError('Failed to load identities'))
      .finally(() => setLoading(false))
  }, [authenticated])

  const fetchProfiles = async (pubkeys: string[]) => {
    try {
      const pool = new SimplePool()
      const events = await pool.querySync(
        PROFILE_RELAYS,
        { kinds: [0], authors: pubkeys }
      )

      const profileMap: Record<string, NostrProfile> = {}
      for (const event of events) {
        // Only keep the latest profile per pubkey
        if (!profileMap[event.pubkey]) {
          try {
            profileMap[event.pubkey] = JSON.parse(event.content)
          } catch {
            // skip invalid JSON
          }
        }
      }
      setProfiles(profileMap)
      pool.close(PROFILE_RELAYS)
    } catch {
      // Profile fetching is best-effort
    }
  }

  const handleSelectIdentity = async (identityId: string) => {
    setSelecting(identityId)
    setError(null)
    try {
      const res = await fetch('/api/select-identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, identity_id: identityId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to select identity')
      }
      // Success — close the popup
      window.close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Selection failed')
      setSelecting(null)
    }
  }

  // Phase 1: Not authenticated — show OAuth buttons
  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-[400px] space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Connect to Nostr</CardTitle>
              <CardDescription>Sign in to authorize this connection</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {providers.map((provider) => (
                <Button
                  key={provider.name}
                  variant="outline"
                  className="w-full justify-center"
                  asChild
                >
                  <a href={`${provider.path}?request_id=${requestId}`}>
                    Sign in with {provider.name}
                  </a>
                </Button>
              ))}
            </CardContent>
          </Card>
          <p className="text-center text-sm text-muted-foreground">
            After signing in, you'll choose a Nostr identity to use.
          </p>
        </div>
      </div>
    )
  }

  // Phase 2: Authenticated — show identity picker
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[400px] space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Choose Identity</CardTitle>
            <CardDescription>
              Select a Nostr identity to use with this connection
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {identities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No identities available. Ask an admin to add identities.
              </p>
            ) : (
              identities.map((identity) => {
                const profile = profiles[identity.pubkey]
                const displayName = profile?.display_name || profile?.name || identity.label || truncatePubkey(identity.pubkey)
                const avatar = profile?.picture

                return (
                  <Button
                    key={identity.id}
                    variant="outline"
                    className="w-full justify-start gap-3 h-auto py-3"
                    disabled={selecting !== null}
                    onClick={() => handleSelectIdentity(identity.id)}
                  >
                    {selecting === identity.id ? (
                      <Loader2 className="h-8 w-8 animate-spin shrink-0" />
                    ) : avatar ? (
                      <img
                        src={avatar}
                        alt=""
                        className="h-8 w-8 rounded-full shrink-0 object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
                    )}
                    <div className="min-w-0 text-left">
                      <p className="truncate font-medium">{displayName}</p>
                      <p className="truncate text-xs text-muted-foreground font-mono">
                        {truncatePubkey(identity.pubkey)}
                      </p>
                    </div>
                  </Button>
                )
              })
            )}
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

**Step 2: Build frontend**

Run: `cd web-ui && npm run build`
Expected: Builds successfully

**Step 3: Commit**

```bash
git add web-ui/src/pages/AuthPopup.tsx
git commit -m "feat: identity picker in auth popup after OAuth"
```

---

### Task 7: Update Dashboard for new data model

**Files:**
- Modify: `web-ui/src/pages/Dashboard.tsx`

**Step 1: Update Dashboard to remove per-user identity display**

Key changes:
- Remove "Your Identity" card (npub display) — users no longer have their own pubkey
- Remove "Import Key" card and all related state
- Update `UserInfo` interface to match new `MeResponse`
- Keep "Connected Apps" and "Connection Info" cards

Update the `UserInfo` interface:
```tsx
interface UserInfo {
  user_id: string
  oauth_provider: string
  email: string | null
  created_at: number
  bunker_url: string
}
```

Remove: `importOpen`, `nsecInput`, `importLoading`, `importError` state variables and `handleImportKey` function.

Remove the "Your Identity" card and the "Import Key" card. Keep the "Connect from any Nostr client" card (use bunker_url from user). Keep "Connected Apps" but remove `is_own` logic since all connections now belong to the current user. Remove the `FromBech32`/`ToBech32` related npub display.

**Step 2: Build frontend**

Run: `cd web-ui && npm run build`
Expected: Builds successfully

**Step 3: Commit**

```bash
git add web-ui/src/pages/Dashboard.tsx
git commit -m "refactor: simplify dashboard for identity-pool model"
```

---

### Task 8: Update Landing page

**Files:**
- Modify: `web-ui/src/pages/Landing.tsx`

**Step 1: Update Landing page text**

Change the tagline from "Sign in with your existing account to get a Nostr identity. No keys to manage." to "Sign in with your existing account to connect with a Nostr identity."

Remove the line about importing keys.

**Step 2: Build frontend**

Run: `cd web-ui && npm run build`
Expected: Builds

**Step 3: Commit**

```bash
git add web-ui/src/pages/Landing.tsx
git commit -m "chore: update landing page copy for identity pool model"
```

---

### Task 9: Full integration build and smoke test

**Files:**
- None (verification only)

**Step 1: Build the full Rust project**

Run: `cargo build`
Expected: Compiles with no errors

**Step 2: Verify the web-ui dist is up to date**

Run: `cd web-ui && npm run build`
Expected: Builds successfully

**Step 3: Delete the old dev database to start fresh**

Run: `rm -f oauth-signer.db`

**Step 4: Run `cargo build` one more time to embed latest frontend assets**

Run: `cargo build`
Expected: Compiles

**Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: integration build verification"
```
