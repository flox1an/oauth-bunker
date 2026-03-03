use axum::{
    extract::{Form, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Redirect, Response},
    routing::{delete, get, post},
    Router,
};
use chrono::Utc;
use nostr_sdk::prelude::*;
use nostr_sdk::{FromBech32, ToBech32};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db::{Identity, NipConnection, Session, User};
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
pub struct AddIdentityBody {
    pub nsec: String,
    pub label: Option<String>,
}

#[derive(Deserialize)]
pub struct SelectIdentityBody {
    pub request_id: String,
    pub identity_id: String,
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
    user_id: String,
    oauth_provider: String,
    email: Option<String>,
    created_at: i64,
    bunker_url: String,
}

#[derive(Serialize)]
struct ConnectionResponse {
    id: String,
    client_pubkey: String,
    relay_url: String,
    created_at: i64,
    last_used_at: i64,
    oauth_provider: String,
    oauth_sub: String,
    created_by_email: Option<String>,
    is_own: bool,
}

#[derive(Serialize)]
struct IdentityResponse {
    id: String,
    pubkey: String,
    label: Option<String>,
    created_at: i64,
    active_connections: i64,
}

/// Obfuscate an email: show first 4 chars + "..." + domain.
/// e.g. "john.doe@example.com" → "john...@example.com"
fn obfuscate_email(email: &str) -> String {
    match email.split_once('@') {
        Some((local, domain)) => {
            let visible: String = local.chars().take(4).collect();
            format!("{visible}...@{domain}")
        }
        None => "****".to_string(),
    }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/.well-known/nostr.json", get(well_known_nostr).options(well_known_nostr_options))
        .route("/health", get(health))
        .route("/auth/google", get(auth_google))
        .route("/auth/github", get(auth_github))
        .route("/auth/microsoft", get(auth_microsoft))
        .route("/auth/apple", get(auth_apple))
        .route("/auth/google/callback", get(auth_google_callback))
        .route("/auth/github/callback", get(auth_github_callback))
        .route("/auth/microsoft/callback", get(auth_microsoft_callback))
        .route("/auth/apple/callback", post(auth_apple_callback))
        .route("/auth/{request_id}", get(auth_popup))
        .route("/api/bunker-url", get(api_bunker_url))
        .route("/api/me", get(api_me))
        .route("/api/connections", get(api_connections))
        .route("/api/connections/{id}", delete(api_delete_connection))
        .route("/api/identities", get(api_list_identities))
        .route("/api/admin/identities", post(api_add_identity))
        .route("/api/admin/identities/{id}", delete(api_delete_identity))
        .route("/api/select-identity", post(api_select_identity))
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

async fn well_known_nostr_options() -> impl IntoResponse {
    (
        StatusCode::NO_CONTENT,
        [
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
            (header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS"),
            (header::ACCESS_CONTROL_ALLOW_HEADERS, "*"),
        ],
    )
}

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

    (
        [
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"),
            (header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS"),
            (header::ACCESS_CONTROL_ALLOW_HEADERS, "*"),
        ],
        Json(body),
    )
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

async fn auth_apple(
    State(state): State<AppState>,
    Query(params): Query<AuthQuery>,
) -> impl IntoResponse {
    let request_id = params.request_id.unwrap_or_default();
    let url = state.oauth.apple_auth_url(&request_id);
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

/// Apple uses response_mode=form_post, so the callback comes as a POST with form data
async fn auth_apple_callback(
    State(state): State<AppState>,
    Form(params): Form<CallbackQuery>,
) -> Result<Response, Response> {
    let oauth_user = state
        .oauth
        .exchange_apple_code(&params.code)
        .await
        .map_err(|e| {
            tracing::error!("Apple OAuth exchange failed: {e}");
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
        Some(mut user) => {
            // Backfill email if missing (e.g. user created before email column existed)
            if user.email.is_none() {
                if let Some(ref email) = oauth_user.email {
                    let _ = state.db.update_user_email(&user.id, email);
                    user.email = Some(email.clone());
                }
            }
            user
        }
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

    // 3. If request_id present, redirect back to auth-popup for identity selection
    let request_id_str = request_id.unwrap_or_default();
    if !request_id_str.is_empty() {
        let redirect_url = format!("/auth-popup/{}?authenticated=true", request_id_str);
        Ok((
            StatusCode::SEE_OTHER,
            [
                (header::SET_COOKIE, cookie),
                (header::LOCATION, redirect_url),
            ],
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
    Redirect::temporary(&format!("/auth-popup/{request_id}"))
}

// ---------------------------------------------------------------------------
// API: /api/bunker-url (public, no auth required)
// ---------------------------------------------------------------------------

async fn api_bunker_url(State(state): State<AppState>) -> impl IntoResponse {
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

    Json(serde_json::json!({ "bunker_url": bunker_url }))
}

// ---------------------------------------------------------------------------
// API: /api/me
// ---------------------------------------------------------------------------

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
            is_own: true,
            id: c.id,
            client_pubkey: c.client_pubkey,
            relay_url: c.relay_url,
            created_at: c.created_at,
            last_used_at: c.last_used_at,
            oauth_provider: user.oauth_provider.clone(),
            oauth_sub: user.oauth_sub.clone(),
            created_by_email: user.email.as_deref().map(obfuscate_email),
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
// API: GET /api/identities
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// API: POST /api/admin/identities
// ---------------------------------------------------------------------------

async fn api_add_identity(
    State(state): State<AppState>,
    Json(body): Json<AddIdentityBody>,
) -> Result<impl IntoResponse, Response> {
    // Parse the nsec bech32 string to get the secret key
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
        id: identity_id.clone(),
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
            "id": identity_id,
            "pubkey": pubkey,
            "npub": npub,
        })),
    ))
}

// ---------------------------------------------------------------------------
// API: DELETE /api/admin/identities/{id}
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// API: POST /api/select-identity
// ---------------------------------------------------------------------------

async fn api_select_identity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SelectIdentityBody>,
) -> Result<impl IntoResponse, Response> {
    let user = get_authenticated_user(&state, &headers)?;

    // Validate identity exists
    let identity = state.db.find_identity_by_id(&body.identity_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?.ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Identity not found"}))).into_response()
    })?;

    // Find pending auth
    let pending = state.db.find_pending_auth(&body.request_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?.ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Pending auth not found or expired"}))).into_response()
    })?;

    // Create connection with identity_id
    let now = Utc::now().timestamp();
    let connection = NipConnection {
        id: Uuid::new_v4().to_string(),
        user_id: user.id.clone(),
        client_pubkey: pending.client_pubkey.clone(),
        relay_url: pending.relay_url.clone(),
        created_at: now,
        last_used_at: now,
    };
    state.db.create_connection_with_identity(&connection, &body.identity_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Connection error: {e}")}))).into_response()
    })?;

    // Send NIP-46 ack response to the waiting client
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
