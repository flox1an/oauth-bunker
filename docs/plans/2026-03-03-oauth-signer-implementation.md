# OAuth Nostr Remote Signer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a NIP-46 remote signer in Rust that authenticates users via Google/GitHub OAuth, serving a React+Shadcn web UI from a single binary.

**Architecture:** Single Rust binary — Axum web server + NIP-46 bunker (via `nostr-connect` crate) + SQLite (via `rusqlite`) + embedded React/Shadcn static assets. The `nostr-connect` crate handles NIP-46 protocol; we implement the `NostrConnectSignerActions` trait to gate signing behind OAuth sessions.

**Tech Stack:** Rust (Axum 0.8, nostr-sdk 0.44, nostr-connect 0.44, rusqlite 0.33, aes-gcm 0.10, oauth2 5.0), React 19 + TypeScript + Shadcn/ui + Tailwind CSS, rust-embed 8.11

**Design doc:** `docs/plans/2026-03-03-oauth-signer-design.md`

---

## Task 1: Project Scaffolding

**Files:**
- Create: `Cargo.toml`
- Create: `src/main.rs`
- Create: `src/config.rs`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Initialize Cargo project**

```bash
cd /Users/flox/dev/nostr/oauth-signer
cargo init --name oauth-signer
```

**Step 2: Set up Cargo.toml with all dependencies**

Replace `Cargo.toml` with:

```toml
[package]
name = "oauth-signer"
version = "0.1.0"
edition = "2021"

[dependencies]
# Nostr
nostr-sdk = "0.44"
nostr-connect = "0.44"

# Web server
axum = "0.8"
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.6", features = ["cors"] }

# Database
rusqlite = { version = "0.33", features = ["bundled"] }

# Crypto
aes-gcm = "0.10"
hkdf = "0.12"
sha2 = "0.10"
zeroize = { version = "1", features = ["derive"] }
rand = "0.8"

# OAuth
oauth2 = "5.0"
reqwest = { version = "0.12", features = ["json"] }

# Embedded static files
rust-embed = "8.11"
axum-embed = "0.1"
mime_guess = "2"

# Utilities
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
dotenvy = "0.15"
chrono = { version = "0.4", features = ["serde"] }
```

**Step 3: Create .env.example**

```env
# Server
HOST=127.0.0.1
PORT=3000
PUBLIC_URL=http://localhost:3000

# Master encryption key (32 bytes hex-encoded). Generate with: openssl rand -hex 32
MASTER_KEY=

# OAuth: Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# OAuth: GitHub
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Nostr relays (comma-separated)
NOSTR_RELAYS=wss://relay.nsec.app,wss://relay.damus.io,wss://nos.lol

# Database path
DATABASE_URL=oauth-signer.db
```

**Step 4: Create .gitignore**

```
/target
.env
*.db
*.db-journal
*.db-wal
*.db-shm
node_modules/
web-ui/dist/
```

**Step 5: Create src/config.rs**

```rust
use std::env;

#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub public_url: String,
    pub master_key: Vec<u8>,
    pub google_client_id: String,
    pub google_client_secret: String,
    pub github_client_id: String,
    pub github_client_secret: String,
    pub nostr_relays: Vec<String>,
    pub database_url: String,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        dotenvy::dotenv().ok();

        let master_key_hex = env::var("MASTER_KEY")
            .map_err(|_| "MASTER_KEY must be set")?;
        let master_key = hex::decode(&master_key_hex)
            .map_err(|_| "MASTER_KEY must be valid hex")?;
        if master_key.len() != 32 {
            return Err("MASTER_KEY must be 32 bytes (64 hex chars)".into());
        }

        let relays = env::var("NOSTR_RELAYS")
            .unwrap_or_else(|_| "wss://relay.nsec.app,wss://relay.damus.io,wss://nos.lol".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        Ok(Config {
            host: env::var("HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            port: env::var("PORT")
                .unwrap_or_else(|_| "3000".into())
                .parse()
                .map_err(|_| "PORT must be a number")?,
            public_url: env::var("PUBLIC_URL")
                .unwrap_or_else(|_| "http://localhost:3000".into()),
            master_key,
            google_client_id: env::var("GOOGLE_CLIENT_ID")
                .map_err(|_| "GOOGLE_CLIENT_ID must be set")?,
            google_client_secret: env::var("GOOGLE_CLIENT_SECRET")
                .map_err(|_| "GOOGLE_CLIENT_SECRET must be set")?,
            github_client_id: env::var("GITHUB_CLIENT_ID")
                .map_err(|_| "GITHUB_CLIENT_ID must be set")?,
            github_client_secret: env::var("GITHUB_CLIENT_SECRET")
                .map_err(|_| "GITHUB_CLIENT_SECRET must be set")?,
            nostr_relays: relays,
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "oauth-signer.db".into()),
        })
    }
}
```

Add `hex = "0.4"` to Cargo.toml dependencies.

**Step 6: Create minimal src/main.rs**

```rust
mod config;

use config::Config;
use tracing_subscriber::{fmt, EnvFilter};

#[tokio::main]
async fn main() {
    fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    let config = Config::from_env().unwrap_or_else(|e| {
        eprintln!("Configuration error: {e}");
        std::process::exit(1);
    });

    tracing::info!(
        host = %config.host,
        port = %config.port,
        relays = ?config.nostr_relays,
        "Starting OAuth Signer"
    );
}
```

**Step 7: Verify it compiles**

```bash
cargo check
```

Expected: compiles with no errors (may have warnings about unused fields).

**Step 8: Commit**

```bash
git add Cargo.toml Cargo.lock src/ .env.example .gitignore
git commit -m "feat: project scaffolding with config and dependencies"
```

---

## Task 2: Database Layer

**Files:**
- Create: `src/db.rs`
- Modify: `src/main.rs`

**Step 1: Create src/db.rs with schema and CRUD operations**

```rust
use rusqlite::{Connection, params};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub oauth_provider: String,
    pub oauth_sub: String,
    pub encrypted_nsec: Vec<u8>,
    pub nonce: Vec<u8>,
    pub pubkey: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct NipConnection {
    pub id: String,
    pub user_id: String,
    pub client_pubkey: String,
    pub relay_url: String,
    pub created_at: i64,
    pub last_used_at: i64,
}

#[derive(Debug, Clone)]
pub struct Session {
    pub token: String,
    pub user_id: String,
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
pub struct PendingAuth {
    pub request_id: String,
    pub client_pubkey: String,
    pub relay_url: String,
    pub secret: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
}

impl Database {
    pub fn new(path: &str) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS users (
                id              TEXT PRIMARY KEY,
                oauth_provider  TEXT NOT NULL,
                oauth_sub       TEXT NOT NULL,
                encrypted_nsec  BLOB NOT NULL,
                nonce           BLOB NOT NULL,
                pubkey          TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                UNIQUE(oauth_provider, oauth_sub)
            );

            CREATE TABLE IF NOT EXISTS connections (
                id              TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL REFERENCES users(id),
                client_pubkey   TEXT NOT NULL,
                relay_url       TEXT NOT NULL,
                created_at      INTEGER NOT NULL,
                last_used_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token           TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL REFERENCES users(id),
                expires_at      INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pending_auth (
                request_id      TEXT PRIMARY KEY,
                client_pubkey   TEXT NOT NULL,
                relay_url       TEXT NOT NULL,
                secret          TEXT,
                created_at      INTEGER NOT NULL,
                expires_at      INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_users_pubkey ON users(pubkey);
            CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
            CREATE INDEX IF NOT EXISTS idx_pending_auth_expires ON pending_auth(expires_at);"
        )?;
        Ok(())
    }

    // --- Users ---

    pub fn create_user(&self, user: &User) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![user.id, user.oauth_provider, user.oauth_sub, user.encrypted_nsec, user.nonce, user.pubkey, user.created_at],
        )?;
        Ok(())
    }

    pub fn find_user_by_oauth(&self, provider: &str, sub: &str) -> rusqlite::Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, created_at
             FROM users WHERE oauth_provider = ?1 AND oauth_sub = ?2"
        )?;
        let mut rows = stmt.query_map(params![provider, sub], |row| {
            Ok(User {
                id: row.get(0)?,
                oauth_provider: row.get(1)?,
                oauth_sub: row.get(2)?,
                encrypted_nsec: row.get(3)?,
                nonce: row.get(4)?,
                pubkey: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        match rows.next() {
            Some(Ok(user)) => Ok(Some(user)),
            Some(Err(e)) => Err(e),
            None => Ok(None),
        }
    }

    pub fn find_user_by_id(&self, id: &str) -> rusqlite::Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, created_at
             FROM users WHERE id = ?1"
        )?;
        let mut rows = stmt.query_map(params![id], |row| {
            Ok(User {
                id: row.get(0)?,
                oauth_provider: row.get(1)?,
                oauth_sub: row.get(2)?,
                encrypted_nsec: row.get(3)?,
                nonce: row.get(4)?,
                pubkey: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        match rows.next() {
            Some(Ok(user)) => Ok(Some(user)),
            Some(Err(e)) => Err(e),
            None => Ok(None),
        }
    }

    pub fn update_user_key(&self, user_id: &str, encrypted_nsec: &[u8], nonce: &[u8], pubkey: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET encrypted_nsec = ?1, nonce = ?2, pubkey = ?3 WHERE id = ?4",
            params![encrypted_nsec, nonce, pubkey, user_id],
        )?;
        Ok(())
    }

    // --- Connections ---

    pub fn create_connection(&self, conn_record: &NipConnection) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO connections (id, user_id, client_pubkey, relay_url, created_at, last_used_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![conn_record.id, conn_record.user_id, conn_record.client_pubkey, conn_record.relay_url, conn_record.created_at, conn_record.last_used_at],
        )?;
        Ok(())
    }

    pub fn list_connections(&self, user_id: &str) -> rusqlite::Result<Vec<NipConnection>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, client_pubkey, relay_url, created_at, last_used_at
             FROM connections WHERE user_id = ?1 ORDER BY last_used_at DESC"
        )?;
        let rows = stmt.query_map(params![user_id], |row| {
            Ok(NipConnection {
                id: row.get(0)?,
                user_id: row.get(1)?,
                client_pubkey: row.get(2)?,
                relay_url: row.get(3)?,
                created_at: row.get(4)?,
                last_used_at: row.get(5)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_connection(&self, id: &str, user_id: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute(
            "DELETE FROM connections WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
        )?;
        Ok(count > 0)
    }

    // --- Sessions ---

    pub fn create_session(&self, session: &Session) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)",
            params![session.token, session.user_id, session.expires_at],
        )?;
        Ok(())
    }

    pub fn find_session(&self, token: &str) -> rusqlite::Result<Option<Session>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        let mut stmt = conn.prepare(
            "SELECT token, user_id, expires_at FROM sessions WHERE token = ?1 AND expires_at > ?2"
        )?;
        let mut rows = stmt.query_map(params![token, now], |row| {
            Ok(Session {
                token: row.get(0)?,
                user_id: row.get(1)?,
                expires_at: row.get(2)?,
            })
        })?;
        match rows.next() {
            Some(Ok(s)) => Ok(Some(s)),
            Some(Err(e)) => Err(e),
            None => Ok(None),
        }
    }

    pub fn delete_session(&self, token: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM sessions WHERE token = ?1", params![token])?;
        Ok(())
    }

    // --- Pending Auth ---

    pub fn create_pending_auth(&self, auth: &PendingAuth) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO pending_auth (request_id, client_pubkey, relay_url, secret, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![auth.request_id, auth.client_pubkey, auth.relay_url, auth.secret, auth.created_at, auth.expires_at],
        )?;
        Ok(())
    }

    pub fn find_pending_auth(&self, request_id: &str) -> rusqlite::Result<Option<PendingAuth>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        let mut stmt = conn.prepare(
            "SELECT request_id, client_pubkey, relay_url, secret, created_at, expires_at
             FROM pending_auth WHERE request_id = ?1 AND expires_at > ?2"
        )?;
        let mut rows = stmt.query_map(params![request_id, now], |row| {
            Ok(PendingAuth {
                request_id: row.get(0)?,
                client_pubkey: row.get(1)?,
                relay_url: row.get(2)?,
                secret: row.get(3)?,
                created_at: row.get(4)?,
                expires_at: row.get(5)?,
            })
        })?;
        match rows.next() {
            Some(Ok(a)) => Ok(Some(a)),
            Some(Err(e)) => Err(e),
            None => Ok(None),
        }
    }

    pub fn delete_pending_auth(&self, request_id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM pending_auth WHERE request_id = ?1", params![request_id])?;
        Ok(())
    }

    pub fn cleanup_expired(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?1", params![now])?;
        conn.execute("DELETE FROM pending_auth WHERE expires_at <= ?1", params![now])?;
        Ok(())
    }
}
```

**Step 2: Wire Database into main.rs**

Add to `src/main.rs`:

```rust
mod config;
mod db;

use config::Config;
use db::Database;
use tracing_subscriber::{fmt, EnvFilter};

#[tokio::main]
async fn main() {
    fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    let config = Config::from_env().unwrap_or_else(|e| {
        eprintln!("Configuration error: {e}");
        std::process::exit(1);
    });

    let db = Database::new(&config.database_url).unwrap_or_else(|e| {
        eprintln!("Database error: {e}");
        std::process::exit(1);
    });

    tracing::info!(
        host = %config.host,
        port = %config.port,
        "Starting OAuth Signer"
    );
}
```

**Step 3: Verify it compiles**

```bash
cargo check
```

**Step 4: Commit**

```bash
git add src/db.rs src/main.rs
git commit -m "feat: database layer with SQLite schema and CRUD operations"
```

---

## Task 3: Key Encryption Module

**Files:**
- Create: `src/crypto.rs`
- Modify: `src/main.rs`

**Step 1: Create src/crypto.rs**

```rust
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroize;

pub struct KeyEncryptor {
    master_key: Vec<u8>,
}

impl KeyEncryptor {
    pub fn new(master_key: Vec<u8>) -> Result<Self, String> {
        if master_key.len() != 32 {
            return Err("Master key must be 32 bytes".into());
        }
        Ok(Self { master_key })
    }

    fn derive_key(&self, user_id: &str) -> Key<Aes256Gcm> {
        let hk = Hkdf::<Sha256>::new(Some(user_id.as_bytes()), &self.master_key);
        let mut okm = [0u8; 32];
        hk.expand(b"nostr-key-encryption", &mut okm)
            .expect("HKDF expand should not fail with valid length");
        let key = *Key::<Aes256Gcm>::from_slice(&okm);
        okm.zeroize();
        key
    }

    pub fn encrypt_nsec(&self, user_id: &str, secret_key_bytes: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
        let key = self.derive_key(user_id);
        let cipher = Aes256Gcm::new(&key);
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ciphertext = cipher
            .encrypt(&nonce, secret_key_bytes)
            .map_err(|e| format!("Encryption failed: {e}"))?;
        Ok((ciphertext, nonce.to_vec()))
    }

    pub fn decrypt_nsec(&self, user_id: &str, ciphertext: &[u8], nonce_bytes: &[u8]) -> Result<Vec<u8>, String> {
        let key = self.derive_key(user_id);
        let cipher = Aes256Gcm::new(&key);
        let nonce = Nonce::from_slice(nonce_bytes);
        let mut plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| format!("Decryption failed: {e}"))?;
        // Caller is responsible for zeroizing the returned Vec
        Ok(plaintext)
    }
}

impl Drop for KeyEncryptor {
    fn drop(&mut self) {
        self.master_key.zeroize();
    }
}
```

**Step 2: Add `mod crypto;` to main.rs**

**Step 3: Verify it compiles**

```bash
cargo check
```

**Step 4: Commit**

```bash
git add src/crypto.rs src/main.rs
git commit -m "feat: AES-256-GCM key encryption with HKDF per-user key derivation"
```

---

## Task 4: OAuth Module

**Files:**
- Create: `src/oauth.rs`
- Modify: `src/main.rs`

**Step 1: Create src/oauth.rs**

```rust
use oauth2::{
    basic::BasicClient, AuthUrl, AuthorizationCode, ClientId, ClientSecret,
    CsrfToken, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use serde::Deserialize;

use crate::config::Config;

#[derive(Debug, Clone)]
pub struct OAuthUser {
    pub provider: String,
    pub sub: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

pub struct OAuthManager {
    google_client: BasicClient,
    github_client: BasicClient,
    http_client: reqwest::Client,
}

#[derive(Deserialize)]
struct GoogleUserInfo {
    sub: String,
    email: Option<String>,
    name: Option<String>,
    picture: Option<String>,
}

#[derive(Deserialize)]
struct GitHubUserInfo {
    id: u64,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

impl OAuthManager {
    pub fn new(config: &Config) -> Result<Self, String> {
        let google_client = BasicClient::new(ClientId::new(config.google_client_id.clone()))
            .set_client_secret(ClientSecret::new(config.google_client_secret.clone()))
            .set_auth_uri(AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".into()).unwrap())
            .set_token_uri(TokenUrl::new("https://oauth2.googleapis.com/token".into()).unwrap())
            .set_redirect_uri(
                RedirectUrl::new(format!("{}/auth/google/callback", config.public_url))
                    .map_err(|e| format!("Invalid redirect URL: {e}"))?,
            );

        let github_client = BasicClient::new(ClientId::new(config.github_client_id.clone()))
            .set_client_secret(ClientSecret::new(config.github_client_secret.clone()))
            .set_auth_uri(AuthUrl::new("https://github.com/login/oauth/authorize".into()).unwrap())
            .set_token_uri(TokenUrl::new("https://github.com/login/oauth/access_token".into()).unwrap())
            .set_redirect_uri(
                RedirectUrl::new(format!("{}/auth/github/callback", config.public_url))
                    .map_err(|e| format!("Invalid redirect URL: {e}"))?,
            );

        let http_client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

        Ok(Self {
            google_client,
            github_client,
            http_client,
        })
    }

    pub fn google_auth_url(&self, state: &str) -> String {
        let (url, _csrf) = self
            .google_client
            .authorize_url(|| CsrfToken::new(state.to_string()))
            .add_scope(Scope::new("openid".into()))
            .add_scope(Scope::new("email".into()))
            .add_scope(Scope::new("profile".into()))
            .url();
        url.to_string()
    }

    pub fn github_auth_url(&self, state: &str) -> String {
        let (url, _csrf) = self
            .github_client
            .authorize_url(|| CsrfToken::new(state.to_string()))
            .add_scope(Scope::new("read:user".into()))
            .url();
        url.to_string()
    }

    pub async fn exchange_google_code(&self, code: &str) -> Result<OAuthUser, String> {
        let token = self
            .google_client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .request_async(&self.http_client)
            .await
            .map_err(|e| format!("Google token exchange failed: {e}"))?;

        let user_info: GoogleUserInfo = self
            .http_client
            .get("https://www.googleapis.com/oauth2/v3/userinfo")
            .bearer_auth(token.access_token().secret())
            .send()
            .await
            .map_err(|e| format!("Google userinfo request failed: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Google userinfo parse failed: {e}"))?;

        Ok(OAuthUser {
            provider: "google".into(),
            sub: user_info.sub,
            email: user_info.email,
            name: user_info.name,
            avatar_url: user_info.picture,
        })
    }

    pub async fn exchange_github_code(&self, code: &str) -> Result<OAuthUser, String> {
        let token = self
            .github_client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .request_async(&self.http_client)
            .await
            .map_err(|e| format!("GitHub token exchange failed: {e}"))?;

        let user_info: GitHubUserInfo = self
            .http_client
            .get("https://api.github.com/user")
            .bearer_auth(token.access_token().secret())
            .header("User-Agent", "oauth-signer")
            .send()
            .await
            .map_err(|e| format!("GitHub user request failed: {e}"))?
            .json()
            .await
            .map_err(|e| format!("GitHub user parse failed: {e}"))?;

        Ok(OAuthUser {
            provider: "github".into(),
            sub: user_info.id.to_string(),
            email: None,
            name: user_info.name.or(Some(user_info.login)),
            avatar_url: user_info.avatar_url,
        })
    }
}
```

**Step 2: Add `mod oauth;` to main.rs**

**Step 3: Verify it compiles**

```bash
cargo check
```

**Step 4: Commit**

```bash
git add src/oauth.rs src/main.rs
git commit -m "feat: OAuth module for Google and GitHub authentication"
```

---

## Task 5: Axum Web Server + API Routes

**Files:**
- Create: `src/web.rs`
- Create: `src/state.rs`
- Modify: `src/main.rs`

**Step 1: Create src/state.rs — shared application state**

```rust
use std::sync::Arc;

use crate::config::Config;
use crate::crypto::KeyEncryptor;
use crate::db::Database;
use crate::oauth::OAuthManager;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub db: Database,
    pub crypto: Arc<KeyEncryptor>,
    pub oauth: Arc<OAuthManager>,
}
```

**Step 2: Create src/web.rs — routes and handlers**

```rust
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Redirect, Response},
    routing::{delete, get, post},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::db::{NipConnection, PendingAuth, Session, User};
use crate::state::AppState;

// --- Well-known endpoint ---

#[derive(Serialize)]
struct NostrJson {
    names: std::collections::HashMap<String, String>,
    nip46: std::collections::HashMap<String, Vec<String>>,
}

async fn well_known_nostr(State(state): State<AppState>) -> Json<NostrJson> {
    let mut names = std::collections::HashMap::new();
    let mut nip46 = std::collections::HashMap::new();

    // The bunker's own pubkey — will be set when bunker starts
    // For now return a placeholder structure
    names.insert("_".to_string(), "TODO_BUNKER_PUBKEY".to_string());
    nip46.insert("TODO_BUNKER_PUBKEY".to_string(), state.config.nostr_relays.clone());

    Json(NostrJson { names, nip46 })
}

// --- Health ---

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    database: bool,
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let db_ok = state.db.find_user_by_id("nonexistent").is_ok();
    Json(HealthResponse {
        status: if db_ok { "ok".into() } else { "degraded".into() },
        database: db_ok,
    })
}

// --- OAuth Routes ---

#[derive(Deserialize)]
pub struct AuthQuery {
    pub request_id: Option<String>,
}

async fn auth_google(State(state): State<AppState>, Query(query): Query<AuthQuery>) -> Redirect {
    let csrf_state = query.request_id.unwrap_or_default();
    let url = state.oauth.google_auth_url(&csrf_state);
    Redirect::temporary(&url)
}

async fn auth_github(State(state): State<AppState>, Query(query): Query<AuthQuery>) -> Redirect {
    let csrf_state = query.request_id.unwrap_or_default();
    let url = state.oauth.github_auth_url(&csrf_state);
    Redirect::temporary(&url)
}

#[derive(Deserialize)]
pub struct OAuthCallback {
    pub code: String,
    pub state: Option<String>,
}

async fn auth_google_callback(
    State(state): State<AppState>,
    Query(params): Query<OAuthCallback>,
) -> Response {
    match state.oauth.exchange_google_code(&params.code).await {
        Ok(oauth_user) => handle_oauth_complete(state, oauth_user, params.state).await,
        Err(e) => {
            tracing::error!(error = %e, "Google OAuth failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Authentication failed").into_response()
        }
    }
}

async fn auth_github_callback(
    State(state): State<AppState>,
    Query(params): Query<OAuthCallback>,
) -> Response {
    match state.oauth.exchange_github_code(&params.code).await {
        Ok(oauth_user) => handle_oauth_complete(state, oauth_user, params.state).await,
        Err(e) => {
            tracing::error!(error = %e, "GitHub OAuth failed");
            (StatusCode::INTERNAL_SERVER_ERROR, "Authentication failed").into_response()
        }
    }
}

async fn handle_oauth_complete(
    state: AppState,
    oauth_user: crate::oauth::OAuthUser,
    request_id: Option<String>,
) -> Response {
    // Find or create user
    let user = match state.db.find_user_by_oauth(&oauth_user.provider, &oauth_user.sub) {
        Ok(Some(user)) => user,
        Ok(None) => {
            // Generate new keypair
            let keys = nostr_sdk::Keys::generate();
            let secret_bytes = keys.secret_key().as_secret_bytes().to_vec();
            let user_id = uuid::Uuid::new_v4().to_string();

            let (encrypted, nonce) = match state.crypto.encrypt_nsec(&user_id, &secret_bytes) {
                Ok(result) => result,
                Err(e) => {
                    tracing::error!(error = %e, "Failed to encrypt nsec");
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Internal error").into_response();
                }
            };

            let user = User {
                id: user_id,
                oauth_provider: oauth_user.provider.clone(),
                oauth_sub: oauth_user.sub.clone(),
                encrypted_nsec: encrypted,
                nonce,
                pubkey: keys.public_key().to_hex(),
                created_at: chrono::Utc::now().timestamp(),
            };

            if let Err(e) = state.db.create_user(&user) {
                tracing::error!(error = %e, "Failed to create user");
                return (StatusCode::INTERNAL_SERVER_ERROR, "Internal error").into_response();
            }

            tracing::info!(pubkey = %user.pubkey, provider = %oauth_user.provider, "New user created");
            user
        }
        Err(e) => {
            tracing::error!(error = %e, "Database error");
            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal error").into_response();
        }
    };

    // Create web session
    let session_token = hex::encode(rand::random::<[u8; 32]>());
    let session = Session {
        token: session_token.clone(),
        user_id: user.id.clone(),
        expires_at: chrono::Utc::now().timestamp() + 86400, // 24 hours
    };

    if let Err(e) = state.db.create_session(&session) {
        tracing::error!(error = %e, "Failed to create session");
        return (StatusCode::INTERNAL_SERVER_ERROR, "Internal error").into_response();
    }

    // If this was triggered by a NIP-46 auth_url flow, handle the pending auth
    if let Some(ref req_id) = request_id {
        if !req_id.is_empty() {
            if let Ok(Some(pending)) = state.db.find_pending_auth(req_id) {
                // Store the connection
                let conn = NipConnection {
                    id: uuid::Uuid::new_v4().to_string(),
                    user_id: user.id.clone(),
                    client_pubkey: pending.client_pubkey.clone(),
                    relay_url: pending.relay_url.clone(),
                    created_at: chrono::Utc::now().timestamp(),
                    last_used_at: chrono::Utc::now().timestamp(),
                };
                let _ = state.db.create_connection(&conn);
                let _ = state.db.delete_pending_auth(req_id);

                tracing::info!(
                    user_pubkey = %user.pubkey,
                    client_pubkey = %pending.client_pubkey,
                    "NIP-46 connection approved via OAuth"
                );

                // Return HTML that closes the popup and signals success
                let html = format!(
                    r#"<!DOCTYPE html>
<html><body><script>
window.opener && window.opener.postMessage({{ type: "nip46-auth-complete", pubkey: "{}" }}, "{}");
window.close();
</script><p>Authentication complete. You can close this window.</p></body></html>"#,
                    user.pubkey,
                    state.config.public_url,
                );
                return (StatusCode::OK, [("content-type", "text/html")], html).into_response();
            }
        }
    }

    // Regular web login — redirect to dashboard with session cookie
    let cookie = format!(
        "session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400",
        session_token
    );
    (
        StatusCode::SEE_OTHER,
        [
            ("location", "/dashboard"),
            ("set-cookie", &cookie),
        ],
        "",
    )
        .into_response()
}

// --- API Routes (authenticated via session cookie) ---

async fn extract_user(state: &AppState, headers: &axum::http::HeaderMap) -> Result<User, StatusCode> {
    let cookie = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let token = cookie
        .split(';')
        .find_map(|c| {
            let c = c.trim();
            c.strip_prefix("session=")
        })
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let session = state
        .db
        .find_session(token)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

    state
        .db
        .find_user_by_id(&session.user_id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)
}

#[derive(Serialize)]
struct MeResponse {
    pubkey: String,
    npub: String,
    oauth_provider: String,
    created_at: i64,
}

async fn api_me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<MeResponse>, StatusCode> {
    let user = extract_user(&state, &headers).await?;
    let npub = nostr_sdk::PublicKey::from_hex(&user.pubkey)
        .map(|pk| pk.to_bech32().unwrap_or_default())
        .unwrap_or_default();

    Ok(Json(MeResponse {
        pubkey: user.pubkey,
        npub,
        oauth_provider: user.oauth_provider,
        created_at: user.created_at,
    }))
}

#[derive(Serialize)]
struct ConnectionResponse {
    id: String,
    client_pubkey: String,
    relay_url: String,
    created_at: i64,
    last_used_at: i64,
}

async fn api_connections(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<ConnectionResponse>>, StatusCode> {
    let user = extract_user(&state, &headers).await?;
    let conns = state
        .db
        .list_connections(&user.id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(
        conns
            .into_iter()
            .map(|c| ConnectionResponse {
                id: c.id,
                client_pubkey: c.client_pubkey,
                relay_url: c.relay_url,
                created_at: c.created_at,
                last_used_at: c.last_used_at,
            })
            .collect(),
    ))
}

async fn api_delete_connection(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let user = extract_user(&state, &headers).await?;
    let deleted = state
        .db
        .delete_connection(&id, &user.id)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

#[derive(Deserialize)]
struct ImportKeyRequest {
    nsec: String,
}

async fn api_import_key(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<ImportKeyRequest>,
) -> Result<Json<MeResponse>, StatusCode> {
    let user = extract_user(&state, &headers).await?;

    let keys = nostr_sdk::Keys::parse(&body.nsec)
        .map_err(|_| StatusCode::BAD_REQUEST)?;

    let secret_bytes = keys.secret_key().as_secret_bytes().to_vec();
    let (encrypted, nonce) = state
        .crypto
        .encrypt_nsec(&user.id, &secret_bytes)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let new_pubkey = keys.public_key().to_hex();

    state
        .db
        .update_user_key(&user.id, &encrypted, &nonce, &new_pubkey)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let npub = keys.public_key().to_bech32().unwrap_or_default();

    tracing::info!(user_id = %user.id, new_pubkey = %new_pubkey, "User imported key");

    Ok(Json(MeResponse {
        pubkey: new_pubkey,
        npub,
        oauth_provider: user.oauth_provider,
        created_at: user.created_at,
    }))
}

// --- Router ---

pub fn router() -> Router<AppState> {
    Router::new()
        // Well-known
        .route("/.well-known/nostr.json", get(well_known_nostr))
        // Health
        .route("/health", get(health))
        // OAuth
        .route("/auth/google", get(auth_google))
        .route("/auth/github", get(auth_github))
        .route("/auth/google/callback", get(auth_google_callback))
        .route("/auth/github/callback", get(auth_github_callback))
        // API
        .route("/api/me", get(api_me))
        .route("/api/connections", get(api_connections))
        .route("/api/connections/{id}", delete(api_delete_connection))
        .route("/api/import-key", post(api_import_key))
}
```

**Step 3: Create src/state.rs**

As shown in Step 1 above.

**Step 4: Wire everything together in src/main.rs**

```rust
mod config;
mod crypto;
mod db;
mod oauth;
mod state;
mod web;

use std::sync::Arc;

use config::Config;
use crypto::KeyEncryptor;
use db::Database;
use oauth::OAuthManager;
use state::AppState;
use tracing_subscriber::{fmt, EnvFilter};

#[tokio::main]
async fn main() {
    fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .json()
        .init();

    let config = Config::from_env().unwrap_or_else(|e| {
        eprintln!("Configuration error: {e}");
        std::process::exit(1);
    });

    let db = Database::new(&config.database_url).unwrap_or_else(|e| {
        eprintln!("Database error: {e}");
        std::process::exit(1);
    });

    let crypto = Arc::new(
        KeyEncryptor::new(config.master_key.clone()).unwrap_or_else(|e| {
            eprintln!("Crypto error: {e}");
            std::process::exit(1);
        }),
    );

    let oauth = Arc::new(OAuthManager::new(&config).unwrap_or_else(|e| {
        eprintln!("OAuth error: {e}");
        std::process::exit(1);
    }));

    let state = AppState {
        config: config.clone(),
        db,
        crypto,
        oauth,
    };

    let app = web::router().with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    tracing::info!(addr = %addr, "Server starting");

    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

**Step 5: Verify it compiles**

```bash
cargo check
```

**Step 6: Commit**

```bash
git add src/state.rs src/web.rs src/main.rs
git commit -m "feat: Axum web server with OAuth routes and API endpoints"
```

---

## Task 6: NIP-46 Bunker Integration

**Files:**
- Create: `src/bunker.rs`
- Modify: `src/main.rs`
- Modify: `src/web.rs` (update well-known endpoint)

**Step 1: Create src/bunker.rs**

This is the core NIP-46 bunker. Since `nostr-connect` provides `NostrConnectRemoteSigner`, we need to adapt it to our multi-user OAuth model. The `nostr-connect` crate's `NostrConnectRemoteSigner` is designed for a single user's key. For a multi-user bunker, we'll need to implement the NIP-46 protocol directly using `nostr-sdk` relay subscriptions.

```rust
use std::sync::Arc;

use nostr_sdk::prelude::*;
use tokio::sync::RwLock;

use crate::crypto::KeyEncryptor;
use crate::db::{Database, NipConnection, PendingAuth};
use crate::config::Config;

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
        let signer_keys = Keys::generate();

        let client = Client::builder()
            .signer(signer_keys.clone())
            .build();

        for relay in &config.nostr_relays {
            client
                .add_relay(relay)
                .await
                .map_err(|e| format!("Failed to add relay {relay}: {e}"))?;
        }

        client.connect().await;

        tracing::info!(
            bunker_pubkey = %signer_keys.public_key().to_hex(),
            relays = ?config.nostr_relays,
            "Bunker initialized"
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
        self.signer_keys.public_key()
    }

    pub async fn run(&self) -> Result<(), String> {
        // Subscribe to NIP-46 events addressed to us
        let filter = Filter::new()
            .kind(Kind::NostrConnect)
            .pubkey(self.signer_keys.public_key());

        self.client
            .subscribe(filter, None)
            .await
            .map_err(|e| format!("Failed to subscribe: {e}"))?;

        tracing::info!("Bunker listening for NIP-46 requests");

        self.client
            .handle_notifications(|notification| async {
                if let RelayPoolNotification::Event { event, .. } = notification {
                    if event.kind() == Kind::NostrConnect {
                        if let Err(e) = self.handle_nip46_event(&event).await {
                            tracing::error!(error = %e, event_id = %event.id(), "Failed to handle NIP-46 event");
                        }
                    }
                }
                Ok(false) // keep listening
            })
            .await
            .map_err(|e| format!("Notification handler error: {e}"))?;

        Ok(())
    }

    async fn handle_nip46_event(&self, event: &Event) -> Result<(), String> {
        // Decrypt the request (try NIP-44 first, fall back to NIP-04)
        let content = self.decrypt_content(event).await?;

        let request: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Invalid NIP-46 request JSON: {e}"))?;

        let id = request["id"].as_str().unwrap_or("").to_string();
        let method = request["method"].as_str().unwrap_or("");
        let params = request["params"].as_array();

        tracing::debug!(
            method = %method,
            request_id = %id,
            client_pubkey = %event.author().to_hex(),
            "NIP-46 request received"
        );

        let response = match method {
            "connect" => self.handle_connect(&id, event.author(), params).await,
            "get_public_key" => self.handle_get_public_key(event.author()).await,
            "sign_event" => self.handle_sign_event(event.author(), params).await,
            "ping" => Ok(nip46_result(&id, "pong")),
            "nip44_encrypt" => self.handle_nip44_encrypt(event.author(), params).await,
            "nip44_decrypt" => self.handle_nip44_decrypt(event.author(), params).await,
            "nip04_encrypt" => self.handle_nip04_encrypt(event.author(), params).await,
            "nip04_decrypt" => self.handle_nip04_decrypt(event.author(), params).await,
            _ => Ok(nip46_error(&id, &format!("Unknown method: {method}"))),
        };

        let response_json = match response {
            Ok(json) => json,
            Err(e) => nip46_error(&id, &e),
        };

        // Encrypt and send response back to the client
        self.send_response(event.author(), &response_json).await?;

        Ok(())
    }

    async fn decrypt_content(&self, event: &Event) -> Result<String, String> {
        // Try NIP-44 first
        if let Ok(content) = nip44::decrypt(
            self.signer_keys.secret_key(),
            &event.author(),
            event.content(),
        ) {
            return Ok(content);
        }

        // Fall back to NIP-04
        nostr_sdk::nips::nip04::decrypt(
            self.signer_keys.secret_key(),
            &event.author(),
            event.content(),
        )
        .map_err(|e| format!("Failed to decrypt NIP-46 message: {e}"))
    }

    async fn send_response(&self, to: PublicKey, content: &str) -> Result<(), String> {
        // Encrypt with NIP-44 (always respond with modern encryption)
        let encrypted = nip44::encrypt(
            self.signer_keys.secret_key(),
            &to,
            content,
            nip44::Version::V2,
        )
        .map_err(|e| format!("NIP-44 encrypt failed: {e}"))?;

        let event = EventBuilder::new(Kind::NostrConnect, encrypted)
            .tag(Tag::public_key(to))
            .sign_with_keys(&self.signer_keys)
            .map_err(|e| format!("Failed to sign response event: {e}"))?;

        self.client
            .send_event(event)
            .await
            .map_err(|e| format!("Failed to send response: {e}"))?;

        Ok(())
    }

    async fn handle_connect(
        &self,
        request_id: &str,
        client_pubkey: PublicKey,
        params: Option<&Vec<serde_json::Value>>,
    ) -> Result<String, String> {
        let client_hex = client_pubkey.to_hex();

        // Check if there's already an approved connection for this client
        // by looking through all users' connections
        // For now, check if we have a pending auth that was completed
        if let Ok(conns) = self.db.list_connections_by_client_pubkey(&client_hex) {
            if !conns.is_empty() {
                tracing::info!(client_pubkey = %client_hex, "Returning ack for existing connection");
                return Ok(nip46_result(request_id, "ack"));
            }
        }

        // No existing connection — create a pending auth and return auth_url
        let pending = PendingAuth {
            request_id: request_id.to_string(),
            client_pubkey: client_hex.clone(),
            relay_url: self.config.nostr_relays.first().cloned().unwrap_or_default(),
            secret: params
                .and_then(|p| p.get(1))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            created_at: chrono::Utc::now().timestamp(),
            expires_at: chrono::Utc::now().timestamp() + 600, // 10 minutes
        };

        self.db
            .create_pending_auth(&pending)
            .map_err(|e| format!("Failed to store pending auth: {e}"))?;

        let auth_url = format!("{}/auth/{}",
            self.config.public_url,
            request_id,
        );

        tracing::info!(
            client_pubkey = %client_hex,
            auth_url = %auth_url,
            "Returning auth_url for new connection"
        );

        // Return auth_url as error per NIP-46 spec
        Ok(format!(
            r#"{{"id":"{}","result":"auth_url","error":"{}"}}"#,
            request_id, auth_url
        ))
    }

    async fn handle_get_public_key(&self, client_pubkey: PublicKey) -> Result<String, String> {
        let user = self.find_user_by_client(&client_pubkey).await?;
        Ok(nip46_result("", &user.pubkey))
    }

    async fn handle_sign_event(
        &self,
        client_pubkey: PublicKey,
        params: Option<&Vec<serde_json::Value>>,
    ) -> Result<String, String> {
        let user = self.find_user_by_client(&client_pubkey).await?;

        let event_json = params
            .and_then(|p| p.first())
            .and_then(|v| v.as_str())
            .ok_or("Missing event parameter")?;

        // Decrypt the user's key
        let mut secret_bytes = self.crypto.decrypt_nsec(
            &user.id,
            &user.encrypted_nsec,
            &user.nonce,
        )?;

        let keys = Keys::from_secret_key_bytes(&secret_bytes)
            .map_err(|e| format!("Invalid key: {e}"))?;

        // Zeroize secret bytes
        zeroize::Zeroize::zeroize(&mut secret_bytes);

        // Parse the unsigned event and sign it
        let unsigned: UnsignedEvent = serde_json::from_str(event_json)
            .map_err(|e| format!("Invalid event JSON: {e}"))?;

        let signed = unsigned.sign_with_keys(&keys)
            .map_err(|e| format!("Signing failed: {e}"))?;

        let signed_json = serde_json::to_string(&signed)
            .map_err(|e| format!("Failed to serialize signed event: {e}"))?;

        tracing::info!(
            user_pubkey = %user.pubkey,
            event_kind = %signed.kind().as_u16(),
            "Event signed"
        );

        Ok(nip46_result("", &signed_json))
    }

    async fn handle_nip44_encrypt(
        &self,
        client_pubkey: PublicKey,
        params: Option<&Vec<serde_json::Value>>,
    ) -> Result<String, String> {
        let user = self.find_user_by_client(&client_pubkey).await?;
        let (third_party_pk, plaintext) = extract_encrypt_params(params)?;

        let mut secret_bytes = self.crypto.decrypt_nsec(&user.id, &user.encrypted_nsec, &user.nonce)?;
        let keys = Keys::from_secret_key_bytes(&secret_bytes).map_err(|e| format!("Invalid key: {e}"))?;
        zeroize::Zeroize::zeroize(&mut secret_bytes);

        let pk = PublicKey::from_hex(&third_party_pk).map_err(|e| format!("Invalid pubkey: {e}"))?;
        let ciphertext = nip44::encrypt(keys.secret_key(), &pk, &plaintext, nip44::Version::V2)
            .map_err(|e| format!("NIP-44 encrypt failed: {e}"))?;

        Ok(nip46_result("", &ciphertext))
    }

    async fn handle_nip44_decrypt(
        &self,
        client_pubkey: PublicKey,
        params: Option<&Vec<serde_json::Value>>,
    ) -> Result<String, String> {
        let user = self.find_user_by_client(&client_pubkey).await?;
        let (third_party_pk, ciphertext) = extract_encrypt_params(params)?;

        let mut secret_bytes = self.crypto.decrypt_nsec(&user.id, &user.encrypted_nsec, &user.nonce)?;
        let keys = Keys::from_secret_key_bytes(&secret_bytes).map_err(|e| format!("Invalid key: {e}"))?;
        zeroize::Zeroize::zeroize(&mut secret_bytes);

        let pk = PublicKey::from_hex(&third_party_pk).map_err(|e| format!("Invalid pubkey: {e}"))?;
        let plaintext = nip44::decrypt(keys.secret_key(), &pk, &ciphertext)
            .map_err(|e| format!("NIP-44 decrypt failed: {e}"))?;

        Ok(nip46_result("", &plaintext))
    }

    async fn handle_nip04_encrypt(
        &self,
        client_pubkey: PublicKey,
        params: Option<&Vec<serde_json::Value>>,
    ) -> Result<String, String> {
        let user = self.find_user_by_client(&client_pubkey).await?;
        let (third_party_pk, plaintext) = extract_encrypt_params(params)?;

        let mut secret_bytes = self.crypto.decrypt_nsec(&user.id, &user.encrypted_nsec, &user.nonce)?;
        let keys = Keys::from_secret_key_bytes(&secret_bytes).map_err(|e| format!("Invalid key: {e}"))?;
        zeroize::Zeroize::zeroize(&mut secret_bytes);

        let pk = PublicKey::from_hex(&third_party_pk).map_err(|e| format!("Invalid pubkey: {e}"))?;
        let ciphertext = nostr_sdk::nips::nip04::encrypt(keys.secret_key(), &pk, &plaintext)
            .map_err(|e| format!("NIP-04 encrypt failed: {e}"))?;

        Ok(nip46_result("", &ciphertext))
    }

    async fn handle_nip04_decrypt(
        &self,
        client_pubkey: PublicKey,
        params: Option<&Vec<serde_json::Value>>,
    ) -> Result<String, String> {
        let user = self.find_user_by_client(&client_pubkey).await?;
        let (third_party_pk, ciphertext) = extract_encrypt_params(params)?;

        let mut secret_bytes = self.crypto.decrypt_nsec(&user.id, &user.encrypted_nsec, &user.nonce)?;
        let keys = Keys::from_secret_key_bytes(&secret_bytes).map_err(|e| format!("Invalid key: {e}"))?;
        zeroize::Zeroize::zeroize(&mut secret_bytes);

        let pk = PublicKey::from_hex(&third_party_pk).map_err(|e| format!("Invalid pubkey: {e}"))?;
        let plaintext = nostr_sdk::nips::nip04::decrypt(keys.secret_key(), &pk, &ciphertext)
            .map_err(|e| format!("NIP-04 decrypt failed: {e}"))?;

        Ok(nip46_result("", &plaintext))
    }

    async fn find_user_by_client(&self, client_pubkey: &PublicKey) -> Result<crate::db::User, String> {
        let client_hex = client_pubkey.to_hex();
        let conns = self.db.list_connections_by_client_pubkey(&client_hex)
            .map_err(|e| format!("Database error: {e}"))?;

        let conn = conns.first().ok_or("No authorized connection found")?;

        self.db
            .find_user_by_id(&conn.user_id)
            .map_err(|e| format!("Database error: {e}"))?
            .ok_or_else(|| "User not found".to_string())
    }
}

fn extract_encrypt_params(params: Option<&Vec<serde_json::Value>>) -> Result<(String, String), String> {
    let params = params.ok_or("Missing parameters")?;
    let third_party_pk = params.get(0).and_then(|v| v.as_str()).ok_or("Missing pubkey parameter")?;
    let content = params.get(1).and_then(|v| v.as_str()).ok_or("Missing content parameter")?;
    Ok((third_party_pk.to_string(), content.to_string()))
}

fn nip46_result(id: &str, result: &str) -> String {
    serde_json::json!({
        "id": id,
        "result": result,
    }).to_string()
}

fn nip46_error(id: &str, error: &str) -> String {
    serde_json::json!({
        "id": id,
        "result": "",
        "error": error,
    }).to_string()
}
```

**Step 2: Add `list_connections_by_client_pubkey` to db.rs**

Add this method to the `Database` impl:

```rust
pub fn list_connections_by_client_pubkey(&self, client_pubkey: &str) -> rusqlite::Result<Vec<NipConnection>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, user_id, client_pubkey, relay_url, created_at, last_used_at
         FROM connections WHERE client_pubkey = ?1"
    )?;
    let rows = stmt.query_map(params![client_pubkey], |row| {
        Ok(NipConnection {
            id: row.get(0)?,
            user_id: row.get(1)?,
            client_pubkey: row.get(2)?,
            relay_url: row.get(3)?,
            created_at: row.get(4)?,
            last_used_at: row.get(5)?,
        })
    })?;
    rows.collect()
}
```

**Step 3: Update well-known endpoint in web.rs**

The well-known endpoint needs access to the bunker's pubkey. Add it to `AppState`:

In `src/state.rs`, add:
```rust
pub bunker_pubkey: Arc<RwLock<Option<String>>>,
```

Update the well_known handler to read from state.

**Step 4: Update main.rs to spawn bunker alongside web server**

```rust
// After creating AppState, spawn bunker
let bunker = Bunker::new(state.db.clone(), state.crypto.clone(), state.config.clone())
    .await
    .unwrap_or_else(|e| {
        eprintln!("Bunker error: {e}");
        std::process::exit(1);
    });

// Store bunker pubkey in state for well-known endpoint
// (update AppState to include this)

let bunker_handle = tokio::spawn(async move {
    if let Err(e) = bunker.run().await {
        tracing::error!(error = %e, "Bunker stopped");
    }
});

// Run web server
let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
tokio::select! {
    result = axum::serve(listener, app) => {
        if let Err(e) = result {
            tracing::error!(error = %e, "Web server error");
        }
    }
    _ = bunker_handle => {
        tracing::error!("Bunker task ended unexpectedly");
    }
}
```

**Step 5: Verify it compiles**

```bash
cargo check
```

Note: There will likely be API mismatches with `nostr-sdk` that need to be resolved during implementation. The `Keys::from_secret_key_bytes`, `UnsignedEvent`, event building APIs may differ from what's shown. Consult `docs.rs/nostr-sdk/0.44` and `docs.rs/nostr/0.44` during implementation.

**Step 6: Commit**

```bash
git add src/bunker.rs src/db.rs src/state.rs src/web.rs src/main.rs
git commit -m "feat: NIP-46 bunker with OAuth auth_url flow"
```

---

## Task 7: React + Shadcn Web UI

**Files:**
- Create: `web-ui/` (React project)
- Modify: `Cargo.toml` (build script)
- Create: `build.rs`

**Step 1: Scaffold React project**

```bash
cd /Users/flox/dev/nostr/oauth-signer
npm create vite@latest web-ui -- --template react-ts
cd web-ui
npm install
npx shadcn@latest init
npx shadcn@latest add button card input label separator badge dialog alert-dialog
npm install lucide-react
```

**Step 2: Create web-ui/src/pages/Landing.tsx**

Landing page with OAuth login buttons. Clean, minimal design.

- Header with project name
- Brief description of what the service does
- Two buttons: "Sign in with Google", "Sign in with GitHub"
- Both link to `/auth/google?request_id=` and `/auth/github?request_id=`

**Step 3: Create web-ui/src/pages/Dashboard.tsx**

Dashboard showing:
- User's npub with copy button
- Connection domain with copy button
- Connected apps list with revoke buttons
- Import key section (collapsible)

Calls `/api/me`, `/api/connections`, `DELETE /api/connections/:id`, `POST /api/import-key`.

**Step 4: Create web-ui/src/pages/AuthPopup.tsx**

Auth popup page for NIP-46 flow:
- Extracts `request_id` from URL path
- Shows OAuth buttons that pass `request_id` through the flow
- On success, closes popup window

**Step 5: Set up routing in web-ui/src/App.tsx**

```bash
cd web-ui && npm install react-router-dom
```

Routes:
- `/` → Landing
- `/dashboard` → Dashboard
- `/auth/:requestId` → AuthPopup

**Step 6: Build and verify**

```bash
cd web-ui && npm run build
```

**Step 7: Embed in Rust binary**

Create `build.rs`:
```rust
fn main() {
    // Build web UI if web-ui/dist doesn't exist or source changed
    println!("cargo:rerun-if-changed=web-ui/src");
    println!("cargo:rerun-if-changed=web-ui/index.html");
}
```

Add to `src/main.rs` or a new `src/static_files.rs`:
```rust
use rust_embed::RustEmbed;
use axum_embed::ServeEmbed;

#[derive(RustEmbed, Clone)]
#[folder = "web-ui/dist/"]
struct Assets;

// In router setup:
let serve_assets = ServeEmbed::<Assets>::with_fallback("index.html");
let app = web::router()
    .with_state(state)
    .fallback_service(serve_assets);
```

The `with_fallback("index.html")` ensures client-side routing works (all unmatched routes serve index.html).

**Step 8: Commit**

```bash
git add web-ui/ build.rs src/
git commit -m "feat: React + Shadcn web UI with landing, dashboard, and auth popup"
```

---

## Task 8: Integration Testing & Polish

**Files:**
- Modify: various files for fixes found during testing
- Create: `README.md` (minimal, just setup instructions)

**Step 1: Set up environment for testing**

Create a `.env` file from `.env.example` with:
- Generate master key: `openssl rand -hex 32`
- Set up Google OAuth credentials (console.cloud.google.com)
- Set up GitHub OAuth credentials (github.com/settings/developers)
- Set `PUBLIC_URL` to `http://localhost:3000`

**Step 2: Build and run**

```bash
cd web-ui && npm run build && cd ..
cargo build
cargo run
```

**Step 3: Test the web UI**

- Visit `http://localhost:3000` — landing page should load
- Visit `http://localhost:3000/.well-known/nostr.json` — should return bunker pubkey + relays
- Visit `http://localhost:3000/health` — should return status
- Click OAuth buttons — should redirect to Google/GitHub

**Step 4: Test NIP-46 flow**

- Open a NIP-46 compatible client (e.g., Coracle)
- Enter `localhost:3000` as the remote signer
- Should trigger auth_url → OAuth popup
- After OAuth, connection should be approved
- Try posting a note — should be signed by the bunker

**Step 5: Fix any issues found during testing**

Common things to fix:
- CORS headers for API routes
- Cookie handling (Secure flag in production, not in dev)
- NIP-46 message format compatibility
- `nostr-sdk` API differences from docs

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: integration testing fixes and polish"
```

---

## Task Order & Dependencies

```
Task 1: Scaffolding          ← no deps
Task 2: Database             ← depends on 1
Task 3: Key Encryption       ← depends on 1
Task 4: OAuth Module         ← depends on 1
Task 5: Web Server + API     ← depends on 2, 3, 4
Task 6: NIP-46 Bunker        ← depends on 2, 3, 5
Task 7: React Web UI         ← depends on 5
Task 8: Integration Testing  ← depends on all
```

Tasks 2, 3, 4 can be done in parallel. Task 7 can be done in parallel with Task 6.
