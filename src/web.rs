use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Redirect, Response},
    routing::{delete, get, post},
    Router,
};
use chrono::Utc;
use nostr_sdk::{FromBech32, Keys, ToBech32};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::{NipConnection, Session, User};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Query parameter structs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct AuthQuery {
    pub request_id: Option<String>,
}

#[derive(Deserialize)]
pub struct CallbackQuery {
    pub code: String,
    pub state: Option<String>,
}

#[derive(Deserialize)]
pub struct ImportKeyBody {
    pub nsec: String,
}

// ---------------------------------------------------------------------------
// Response structs
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    database: bool,
}

#[derive(Serialize)]
struct MeResponse {
    pubkey: String,
    npub: String,
    oauth_provider: String,
    created_at: i64,
}

#[derive(Serialize)]
struct ConnectionResponse {
    id: String,
    client_pubkey: String,
    relay_url: String,
    created_at: i64,
    last_used_at: i64,
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/.well-known/nostr.json", get(well_known_nostr))
        .route("/health", get(health))
        .route("/auth/google", get(auth_google))
        .route("/auth/github", get(auth_github))
        .route("/auth/microsoft", get(auth_microsoft))
        .route("/auth/google/callback", get(auth_google_callback))
        .route("/auth/github/callback", get(auth_github_callback))
        .route("/auth/microsoft/callback", get(auth_microsoft_callback))
        .route("/auth/{request_id}", get(auth_popup))
        .route("/api/me", get(api_me))
        .route("/api/connections", get(api_connections))
        .route("/api/connections/{id}", delete(api_delete_connection))
        .route("/api/import-key", post(api_import_key))
}

// ---------------------------------------------------------------------------
// Session extraction helper
// ---------------------------------------------------------------------------

fn extract_session_token(headers: &HeaderMap) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    for part in cookie_header.split(';') {
        let part = part.trim();
        if let Some(token) = part.strip_prefix("session=") {
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    None
}

fn get_authenticated_user(state: &AppState, headers: &HeaderMap) -> Result<User, Response> {
    let token = extract_session_token(headers).ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Not authenticated"}))).into_response()
    })?;

    let session = state
        .db
        .find_session(&token)
        .map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Database error"}))).into_response()
        })?
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Invalid or expired session"}))).into_response()
        })?;

    let user = state
        .db
        .find_user_by_id(&session.user_id)
        .map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Database error"}))).into_response()
        })?
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "User not found"}))).into_response()
        })?;

    Ok(user)
}

// ---------------------------------------------------------------------------
// Well-known
// ---------------------------------------------------------------------------

async fn well_known_nostr(State(state): State<AppState>) -> impl IntoResponse {
    let bunker_pubkey = state.bunker_pubkey.read().await;
    let pubkey = bunker_pubkey.clone().unwrap_or_default();

    let relays: Vec<String> = state.config.nostr_relays.clone();
    let relays_json: Vec<serde_json::Value> = relays.into_iter().map(serde_json::Value::String).collect();

    let body = serde_json::json!({
        "names": {
            "_": pubkey,
        },
        "relays": {
            pubkey: relays_json,
        },
    });

    Json(body)
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

async fn health() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok".to_string(),
        database: true,
    })
}

// ---------------------------------------------------------------------------
// OAuth initiation
// ---------------------------------------------------------------------------

async fn auth_google(
    State(state): State<AppState>,
    Query(params): Query<AuthQuery>,
) -> impl IntoResponse {
    let request_id = params.request_id.unwrap_or_default();
    let url = state.oauth.google_auth_url(&request_id);
    Redirect::temporary(&url)
}

async fn auth_github(
    State(state): State<AppState>,
    Query(params): Query<AuthQuery>,
) -> impl IntoResponse {
    let request_id = params.request_id.unwrap_or_default();
    let url = state.oauth.github_auth_url(&request_id);
    Redirect::temporary(&url)
}

async fn auth_microsoft(
    State(state): State<AppState>,
    Query(params): Query<AuthQuery>,
) -> impl IntoResponse {
    let request_id = params.request_id.unwrap_or_default();
    let url = state.oauth.microsoft_auth_url(&request_id);
    Redirect::temporary(&url)
}

// ---------------------------------------------------------------------------
// OAuth callbacks
// ---------------------------------------------------------------------------

async fn auth_google_callback(
    State(state): State<AppState>,
    Query(params): Query<CallbackQuery>,
) -> Result<Response, Response> {
    let oauth_user = state
        .oauth
        .exchange_google_code(&params.code)
        .await
        .map_err(|e| {
            tracing::error!("Google OAuth exchange failed: {e}");
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response()
        })?;

    handle_oauth_complete(&state, oauth_user, params.state).await
}

async fn auth_github_callback(
    State(state): State<AppState>,
    Query(params): Query<CallbackQuery>,
) -> Result<Response, Response> {
    let oauth_user = state
        .oauth
        .exchange_github_code(&params.code)
        .await
        .map_err(|e| {
            tracing::error!("GitHub OAuth exchange failed: {e}");
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response()
        })?;

    handle_oauth_complete(&state, oauth_user, params.state).await
}

async fn auth_microsoft_callback(
    State(state): State<AppState>,
    Query(params): Query<CallbackQuery>,
) -> Result<Response, Response> {
    let oauth_user = state
        .oauth
        .exchange_microsoft_code(&params.code)
        .await
        .map_err(|e| {
            tracing::error!("Microsoft OAuth exchange failed: {e}");
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response()
        })?;

    handle_oauth_complete(&state, oauth_user, params.state).await
}

async fn handle_oauth_complete(
    state: &AppState,
    oauth_user: crate::oauth::OAuthUser,
    request_id: Option<String>,
) -> Result<Response, Response> {
    // 1. Find or create user
    let user = match state
        .db
        .find_user_by_oauth(&oauth_user.provider, &oauth_user.sub)
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
        })? {
        Some(user) => user,
        None => {
            // Generate new Nostr keys
            let keys = Keys::generate();
            let pubkey = keys.public_key().to_hex();
            let secret_key_bytes = keys.secret_key().as_secret_bytes().to_vec();

            let user_id = Uuid::new_v4().to_string();

            let (encrypted_nsec, nonce) = state
                .crypto
                .encrypt_nsec(&user_id, &secret_key_bytes)
                .map_err(|e| {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Encryption error: {e}")}))).into_response()
                })?;

            let now = Utc::now().timestamp();
            let user = User {
                id: user_id,
                oauth_provider: oauth_user.provider.clone(),
                oauth_sub: oauth_user.sub.clone(),
                encrypted_nsec,
                nonce,
                pubkey,
                created_at: now,
            };

            state.db.create_user(&user).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
            })?;

            user
        }
    };

    // 2. Create web session
    let session_token = hex::encode(rand::random::<[u8; 32]>());
    let expires_at = Utc::now().timestamp() + 86400; // 24 hours
    let session = Session {
        token: session_token.clone(),
        user_id: user.id.clone(),
        expires_at,
    };
    state.db.create_session(&session).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Session error: {e}")}))).into_response()
    })?;

    let cookie = format!(
        "session={session_token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400"
    );

    // 3. If request_id present, handle pending auth flow
    let request_id_str = request_id.unwrap_or_default();
    if !request_id_str.is_empty() {
        // Find pending_auth by request_id
        if let Some(pending) = state
            .db
            .find_pending_auth(&request_id_str)
            .map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
            })?
        {
            // Create NIP connection linking client_pubkey to user
            let now = Utc::now().timestamp();
            let connection = NipConnection {
                id: Uuid::new_v4().to_string(),
                user_id: user.id.clone(),
                client_pubkey: pending.client_pubkey.clone(),
                relay_url: pending.relay_url.clone(),
                created_at: now,
                last_used_at: now,
            };
            state.db.create_connection(&connection).map_err(|e| {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Connection error: {e}")}))).into_response()
            })?;

            // Delete pending auth
            let _ = state.db.delete_pending_auth(&request_id_str);
        }

        // Return HTML that closes popup
        let html = r#"<!DOCTYPE html>
<html><head><title>Authentication Complete</title></head>
<body>
<p>Authentication complete. This window will close automatically.</p>
<script>window.close();</script>
</body></html>"#;

        Ok((
            StatusCode::OK,
            [(header::SET_COOKIE, cookie), (header::CONTENT_TYPE, "text/html".to_string())],
            html.to_string(),
        )
            .into_response())
    } else {
        // 4. No request_id: redirect to dashboard
        Ok((
            StatusCode::SEE_OTHER,
            [
                (header::SET_COOKIE, cookie),
                (header::LOCATION, "/dashboard".to_string()),
            ],
        )
            .into_response())
    }
}

// ---------------------------------------------------------------------------
// Auth popup redirect
// ---------------------------------------------------------------------------

async fn auth_popup(Path(request_id): Path<String>) -> impl IntoResponse {
    Redirect::temporary(&format!("/auth/google?request_id={request_id}"))
}

// ---------------------------------------------------------------------------
// API: /api/me
// ---------------------------------------------------------------------------

async fn api_me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    let user = get_authenticated_user(&state, &headers)?;

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

// ---------------------------------------------------------------------------
// API: /api/connections
// ---------------------------------------------------------------------------

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
        })
        .collect();

    Ok(Json(response))
}

// ---------------------------------------------------------------------------
// API: DELETE /api/connections/{id}
// ---------------------------------------------------------------------------

async fn api_delete_connection(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    let user = get_authenticated_user(&state, &headers)?;

    let deleted = state.db.delete_connection(&id, &user.id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    if deleted {
        Ok(Json(serde_json::json!({"deleted": true})))
    } else {
        Err((StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Connection not found"}))).into_response())
    }
}

// ---------------------------------------------------------------------------
// API: POST /api/import-key
// ---------------------------------------------------------------------------

async fn api_import_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ImportKeyBody>,
) -> Result<impl IntoResponse, Response> {
    let user = get_authenticated_user(&state, &headers)?;

    // Parse the nsec bech32 string to get the secret key
    let secret_key = nostr_sdk::SecretKey::from_bech32(&body.nsec).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("Invalid nsec: {e}")}))).into_response()
    })?;

    let keys = Keys::new(secret_key);
    let pubkey = keys.public_key().to_hex();
    let secret_key_bytes = keys.secret_key().as_secret_bytes().to_vec();

    let (encrypted_nsec, nonce) = state
        .crypto
        .encrypt_nsec(&user.id, &secret_key_bytes)
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Encryption error: {e}")}))).into_response()
        })?;

    state
        .db
        .update_user_key(&user.id, &encrypted_nsec, &nonce, &pubkey)
        .map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
        })?;

    let npub = nostr_sdk::PublicKey::from_hex(&pubkey)
        .map(|pk| pk.to_bech32().unwrap_or_default())
        .unwrap_or_default();

    Ok(Json(serde_json::json!({
        "pubkey": pubkey,
        "npub": npub,
    })))
}
