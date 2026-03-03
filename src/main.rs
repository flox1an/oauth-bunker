mod config;
mod db;

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
