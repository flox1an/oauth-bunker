mod bunker;
mod config;
mod crypto;
mod db;
mod oauth;
mod state;
mod static_files;
mod web;

use std::sync::Arc;

use bunker::Bunker;
use config::Config;
use crypto::KeyEncryptor;
use db::Database;
use oauth::OAuthManager;
use state::AppState;
use tokio::sync::RwLock;
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

    // Database
    let db = Database::new(&config.database_url).unwrap_or_else(|e| {
        eprintln!("Database error: {e}");
        std::process::exit(1);
    });

    // Key encryption
    let crypto = Arc::new(KeyEncryptor::new(config.master_key.clone()).unwrap_or_else(|e| {
        eprintln!("Crypto error: {e}");
        std::process::exit(1);
    }));

    // OAuth manager
    let oauth = Arc::new(OAuthManager::new(&config).unwrap_or_else(|e| {
        eprintln!("OAuth error: {e}");
        std::process::exit(1);
    }));

    // Create bunker
    let bunker = Bunker::new(db.clone(), crypto.clone(), config.clone())
        .await
        .unwrap_or_else(|e| {
            eprintln!("Bunker error: {e}");
            std::process::exit(1);
        });

    let bunker_pubkey = Arc::new(RwLock::new(Some(bunker.pubkey().to_hex())));

    // Shared application state
    let state = AppState {
        config: config.clone(),
        db,
        crypto,
        oauth,
        bunker_pubkey,
    };

    // Build router with embedded static assets
    let serve_assets = static_files::serve_assets();
    let app = web::router()
        .with_state(state)
        .fallback_service(serve_assets);

    // Start server
    let bind_addr = format!("{}:{}", config.host, config.port);
    tracing::info!("Listening on {bind_addr}");

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .unwrap_or_else(|e| {
            eprintln!("Failed to bind to {bind_addr}: {e}");
            std::process::exit(1);
        });

    // Run web server and bunker concurrently
    tokio::select! {
        result = axum::serve(listener, app) => {
            if let Err(e) = result {
                eprintln!("Server error: {e}");
            }
        }
        _ = bunker.run() => {
            eprintln!("Bunker stopped unexpectedly");
        }
    }
}
