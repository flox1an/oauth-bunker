use std::sync::Arc;
use tokio::sync::RwLock;

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
    pub bunker_pubkey: Arc<RwLock<Option<String>>>,
}
