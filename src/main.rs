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
        nostr_client: bunker.client(),
        signer_keys: bunker.keys(),
    };

    // Spawn background task to cleanup expired assignments
    let cleanup_db = state.db.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300)); // 5 minutes
        loop {
            interval.tick().await;
            match cleanup_db.cleanup_expired_assignments() {
                Ok(deleted) => {
                    if deleted > 0 {
                        tracing::info!(connections_revoked = deleted, "Cleaned up expired assignments");
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "Failed to cleanup expired assignments");
                }
            }
        }
    });

    // Build router with embedded static assets + cache headers
    let serve_assets = static_files::serve_assets();
    let app = web::router()
        .with_state(state)
        .fallback_service(serve_assets)
        .layer(axum::middleware::map_response(
            |uri: axum::http::Uri, mut response: axum::response::Response| async move {
                let path = uri.path();
                let cache_value = if path.starts_with("/assets/") {
                    // Hashed assets (e.g. index-BrA8W7_9.js) — cache forever
                    "public, max-age=31536000, immutable"
                } else {
                    // HTML and everything else — always revalidate
                    "no-cache"
                };
                response.headers_mut().insert(
                    axum::http::header::CACHE_CONTROL,
                    cache_value.parse().unwrap(),
                );
                response
            },
        ));

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
