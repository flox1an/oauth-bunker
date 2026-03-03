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
    pub email: Option<String>,
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
    pub nip46_id: String,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
pub struct Identity {
    pub id: String,
    pub encrypted_nsec: Vec<u8>,
    pub nonce: Vec<u8>,
    pub pubkey: String,
    pub label: Option<String>,
    pub created_at: i64,
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
        Self::run_alter_migrations(&conn)?;

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
                nip46_id      TEXT    NOT NULL DEFAULT '',
                created_at    INTEGER NOT NULL,
                expires_at    INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_pending_auth_expires_at ON pending_auth(expires_at);

            CREATE TABLE IF NOT EXISTS identities (
                id              TEXT    PRIMARY KEY,
                encrypted_nsec  BLOB    NOT NULL,
                nonce           BLOB    NOT NULL,
                pubkey          TEXT    NOT NULL UNIQUE,
                label           TEXT,
                created_at      INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_identities_pubkey ON identities(pubkey);
            ",
        )?;
        Ok(())
    }

    fn run_alter_migrations(conn: &Connection) -> rusqlite::Result<()> {
        // Add nip46_id column if it doesn't exist (for existing databases)
        let has_nip46_id: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('pending_auth') WHERE name = 'nip46_id'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)?;

        if !has_nip46_id {
            conn.execute_batch(
                "ALTER TABLE pending_auth ADD COLUMN nip46_id TEXT NOT NULL DEFAULT '';"
            )?;
        }

        // Add email column to users table if it doesn't exist
        let has_email: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'email'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)?;

        if !has_email {
            conn.execute_batch("ALTER TABLE users ADD COLUMN email TEXT;")?;
        }

        // Add identity_id column to connections if it doesn't exist
        let has_identity_id: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('connections') WHERE name = 'identity_id'")?
            .query_row([], |row| row.get::<_, i64>(0))
            .map(|count| count > 0)?;
        if !has_identity_id {
            conn.execute_batch("ALTER TABLE connections ADD COLUMN identity_id TEXT REFERENCES identities(id);")?;
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Users
    // -----------------------------------------------------------------------

    pub fn create_user(&self, user: &User) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, email, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                user.id,
                user.oauth_provider,
                user.oauth_sub,
                user.encrypted_nsec,
                user.nonce,
                user.pubkey,
                user.email,
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
            "SELECT id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, email, created_at
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
                email: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn update_user_email(&self, user_id: &str, email: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE users SET email = ?1 WHERE id = ?2",
            params![email, user_id],
        )?;
        Ok(())
    }

    pub fn find_user_by_id(&self, id: &str) -> rusqlite::Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, oauth_provider, oauth_sub, encrypted_nsec, nonce, pubkey, email, created_at
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
                email: row.get(6)?,
                created_at: row.get(7)?,
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

    #[allow(dead_code)]
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

    /// List all connections for users sharing the same pubkey, with owner info.
    pub fn list_connections_by_pubkey(
        &self,
        pubkey: &str,
    ) -> rusqlite::Result<Vec<(NipConnection, String, String, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.user_id, c.client_pubkey, c.relay_url, c.created_at, c.last_used_at,
                    u.oauth_provider, u.oauth_sub, u.email
             FROM connections c
             JOIN users u ON c.user_id = u.id
             WHERE u.pubkey = ?1
             ORDER BY c.created_at DESC",
        )?;
        let rows = stmt.query_map(params![pubkey], |row| {
            Ok((
                NipConnection {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    client_pubkey: row.get(2)?,
                    relay_url: row.get(3)?,
                    created_at: row.get(4)?,
                    last_used_at: row.get(5)?,
                },
                row.get::<_, String>(6)?,         // oauth_provider
                row.get::<_, String>(7)?,         // oauth_sub
                row.get::<_, Option<String>>(8)?, // email
            ))
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

    #[allow(dead_code)]
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
            "INSERT INTO pending_auth (request_id, client_pubkey, relay_url, secret, nip46_id, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                auth.request_id,
                auth.client_pubkey,
                auth.relay_url,
                auth.secret,
                auth.nip46_id,
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
            "SELECT request_id, client_pubkey, relay_url, secret, nip46_id, created_at, expires_at
             FROM pending_auth WHERE request_id = ?1 AND expires_at > ?2",
        )?;
        let mut rows = stmt.query_map(params![request_id, now], |row| {
            Ok(PendingAuth {
                request_id: row.get(0)?,
                client_pubkey: row.get(1)?,
                relay_url: row.get(2)?,
                secret: row.get(3)?,
                nip46_id: row.get(4)?,
                created_at: row.get(5)?,
                expires_at: row.get(6)?,
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
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM connections WHERE identity_id = ?1")?;
        stmt.query_row(params![identity_id], |row| row.get(0))
    }

    pub fn create_connection_with_identity(&self, connection: &NipConnection, identity_id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO connections (id, user_id, client_pubkey, relay_url, created_at, last_used_at, identity_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                connection.id,
                connection.user_id,
                connection.client_pubkey,
                connection.relay_url,
                connection.created_at,
                connection.last_used_at,
                identity_id,
            ],
        )?;
        Ok(())
    }

    pub fn find_identity_by_client_pubkey(&self, client_pubkey: &str) -> rusqlite::Result<Option<Identity>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT i.id, i.encrypted_nsec, i.nonce, i.pubkey, i.label, i.created_at
             FROM identities i
             JOIN connections c ON c.identity_id = i.id
             WHERE c.client_pubkey = ?1
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

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    /// Deletes all expired sessions and pending_auth rows. Returns the total
    /// number of rows removed.
    #[allow(dead_code)]
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
