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
