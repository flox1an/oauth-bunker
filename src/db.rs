use chrono::Utc;
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// Data structs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Database wrapper
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Open (or create) the SQLite database at `path`, enable WAL mode and
    /// foreign keys, then run migrations.
    pub fn new(path: &str) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;

        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        Self::run_migrations(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS users (
                id              TEXT    PRIMARY KEY,
                oauth_provider  TEXT    NOT NULL,
                oauth_sub       TEXT    NOT NULL,
                encrypted_nsec  BLOB    NOT NULL,
                nonce           BLOB    NOT NULL,
                pubkey          TEXT    NOT NULL,
                created_at      INTEGER NOT NULL,
                UNIQUE(oauth_provider, oauth_sub)
            );

            CREATE INDEX IF NOT EXISTS idx_users_pubkey ON users(pubkey);

            CREATE TABLE IF NOT EXISTS connections (
                id              TEXT    PRIMARY KEY,
                user_id         TEXT    NOT NULL REFERENCES users(id),
                client_pubkey   TEXT    NOT NULL,
                relay_url       TEXT    NOT NULL,
                created_at      INTEGER NOT NULL,
                last_used_at    INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);

            CREATE TABLE IF NOT EXISTS sessions (
                token       TEXT    PRIMARY KEY,
                user_id     TEXT    NOT NULL REFERENCES users(id),
                expires_at  INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

            CREATE TABLE IF NOT EXISTS pending_auth (
                request_id    TEXT    PRIMARY KEY,
                client_pubkey TEXT    NOT NULL,
                relay_url     TEXT    NOT NULL,
                secret        TEXT,
                created_at    INTEGER NOT NULL,
                expires_at    INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_pending_auth_expires_at ON pending_auth(expires_at);
            ",
        )?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Users
    // -----------------------------------------------------------------------

    pub fn create_user(&self, user: &User) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                user.id,
                user.oauth_provider,
                user.oauth_sub,
                user.encrypted_nsec,
                user.nonce,
                user.pubkey,
                user.created_at,
            ],
        )?;
        Ok(())
    }

    pub fn find_user_by_oauth(
        &self,
        provider: &str,
        sub: &str,
    ) -> rusqlite::Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, created_at
             FROM users WHERE oauth_provider = ?1 AND oauth_sub = ?2",
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
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn find_user_by_id(&self, id: &str) -> rusqlite::Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, created_at
             FROM users WHERE id = ?1",
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
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn update_user_key(
        &self,
        user_id: &str,
        encrypted_nsec: &[u8],
        nonce: &[u8],
        pubkey: &str,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET encrypted_nsec = ?1, nonce = ?2, pubkey = ?3 WHERE id = ?4",
            params![encrypted_nsec, nonce, pubkey, user_id],
        )?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Connections
    // -----------------------------------------------------------------------

    pub fn create_connection(&self, connection: &NipConnection) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO connections (id, user_id, client_pubkey, relay_url, created_at, last_used_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                connection.id,
                connection.user_id,
                connection.client_pubkey,
                connection.relay_url,
                connection.created_at,
                connection.last_used_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_connections(&self, user_id: &str) -> rusqlite::Result<Vec<NipConnection>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, client_pubkey, relay_url, created_at, last_used_at
             FROM connections WHERE user_id = ?1 ORDER BY created_at DESC",
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

    pub fn list_connections_by_client_pubkey(
        &self,
        client_pubkey: &str,
    ) -> rusqlite::Result<Vec<NipConnection>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, client_pubkey, relay_url, created_at, last_used_at
             FROM connections WHERE client_pubkey = ?1 ORDER BY created_at DESC",
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

    pub fn delete_connection(&self, id: &str, user_id: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let affected = conn.execute(
            "DELETE FROM connections WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
        )?;
        Ok(affected > 0)
    }

    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------

    pub fn create_session(&self, session: &Session) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)",
            params![session.token, session.user_id, session.expires_at],
        )?;
        Ok(())
    }

    /// Returns the session only if it has not expired.
    pub fn find_session(&self, token: &str) -> rusqlite::Result<Option<Session>> {
        let now = Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT token, user_id, expires_at FROM sessions
             WHERE token = ?1 AND expires_at > ?2",
        )?;
        let mut rows = stmt.query_map(params![token, now], |row| {
            Ok(Session {
                token: row.get(0)?,
                user_id: row.get(1)?,
                expires_at: row.get(2)?,
            })
        })?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn delete_session(&self, token: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let affected = conn.execute(
            "DELETE FROM sessions WHERE token = ?1",
            params![token],
        )?;
        Ok(affected > 0)
    }

    // -----------------------------------------------------------------------
    // Pending Auth
    // -----------------------------------------------------------------------

    pub fn create_pending_auth(&self, auth: &PendingAuth) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pending_auth (request_id, client_pubkey, relay_url, secret, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                auth.request_id,
                auth.client_pubkey,
                auth.relay_url,
                auth.secret,
                auth.created_at,
                auth.expires_at,
            ],
        )?;
        Ok(())
    }

    /// Returns the pending auth only if it has not expired.
    pub fn find_pending_auth(&self, request_id: &str) -> rusqlite::Result<Option<PendingAuth>> {
        let now = Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT request_id, client_pubkey, relay_url, secret, created_at, expires_at
             FROM pending_auth WHERE request_id = ?1 AND expires_at > ?2",
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
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn delete_pending_auth(&self, request_id: &str) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let affected = conn.execute(
            "DELETE FROM pending_auth WHERE request_id = ?1",
            params![request_id],
        )?;
        Ok(affected > 0)
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    /// Deletes all expired sessions and pending_auth rows. Returns the total
    /// number of rows removed.
    pub fn cleanup_expired(&self) -> rusqlite::Result<usize> {
        let now = Utc::now().timestamp();
        let conn = self.conn.lock().unwrap();
        let sessions = conn.execute(
            "DELETE FROM sessions WHERE expires_at <= ?1",
            params![now],
        )?;
        let pending = conn.execute(
            "DELETE FROM pending_auth WHERE expires_at <= ?1",
            params![now],
        )?;
        Ok(sessions + pending)
    }
}
