use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, ClientId, ClientSecret, CsrfToken, EndpointNotSet, EndpointSet, RedirectUrl, Scope,
    TokenResponse, TokenUrl,
};
use reqwest::redirect;
use serde::Deserialize;

use oauth2::url;

use crate::config::Config;

type ConfiguredClient =
    BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>;

#[derive(Debug, Clone)]
pub struct OAuthUser {
    pub provider: String,
    pub sub: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

pub struct OAuthManager {
    google_client: Option<ConfiguredClient>,
    github_client: Option<ConfiguredClient>,
    microsoft_client: Option<ConfiguredClient>,
    apple_client_id: String,
    apple_client_secret: String,
    apple_redirect_uri: String,
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
    #[allow(dead_code)]
    name: Option<String>,
    avatar_url: Option<String>,
}

/// Apple token response contains an id_token JWT with user claims.
#[derive(Deserialize)]
struct AppleTokenExchangeResponse {
    id_token: String,
}

/// Claims from Apple's id_token JWT payload.
struct AppleIdTokenClaims {
    sub: String,
    email: Option<String>,
}

#[derive(Deserialize)]
struct MicrosoftUserInfo {
    id: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    mail: Option<String>,
    #[serde(rename = "userPrincipalName")]
    user_principal_name: Option<String>,
}

impl OAuthManager {
    fn is_configured(id: &str, secret: &str) -> bool {
        !id.is_empty() && !secret.is_empty()
    }

    pub fn new(config: &Config) -> Result<Self, String> {
        let google_client = if Self::is_configured(&config.google_client_id, &config.google_client_secret) {
            Some(BasicClient::new(ClientId::new(config.google_client_id.clone()))
                .set_client_secret(ClientSecret::new(config.google_client_secret.clone()))
                .set_auth_uri(
                    AuthUrl::new("https://accounts.google.com/o/oauth2/v2/auth".to_string())
                        .map_err(|e| format!("Invalid Google auth URL: {e}"))?,
                )
                .set_token_uri(
                    TokenUrl::new("https://oauth2.googleapis.com/token".to_string())
                        .map_err(|e| format!("Invalid Google token URL: {e}"))?,
                )
                .set_redirect_uri(
                    RedirectUrl::new(format!("{}/auth/google/callback", config.public_url))
                        .map_err(|e| format!("Invalid Google redirect URL: {e}"))?,
                ))
        } else {
            None
        };

        let github_client = if Self::is_configured(&config.github_client_id, &config.github_client_secret) {
            Some(BasicClient::new(ClientId::new(config.github_client_id.clone()))
                .set_client_secret(ClientSecret::new(config.github_client_secret.clone()))
                .set_auth_uri(
                    AuthUrl::new("https://github.com/login/oauth/authorize".to_string())
                        .map_err(|e| format!("Invalid GitHub auth URL: {e}"))?,
                )
                .set_token_uri(
                    TokenUrl::new("https://github.com/login/oauth/access_token".to_string())
                        .map_err(|e| format!("Invalid GitHub token URL: {e}"))?,
                )
                .set_redirect_uri(
                    RedirectUrl::new(format!("{}/auth/github/callback", config.public_url))
                        .map_err(|e| format!("Invalid GitHub redirect URL: {e}"))?,
                ))
        } else {
            None
        };

        let microsoft_client = if Self::is_configured(&config.microsoft_client_id, &config.microsoft_client_secret) {
            Some(BasicClient::new(ClientId::new(config.microsoft_client_id.clone()))
                .set_client_secret(ClientSecret::new(
                    config.microsoft_client_secret.clone(),
                ))
                .set_auth_uri(
                    AuthUrl::new(
                        "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
                            .to_string(),
                    )
                    .map_err(|e| format!("Invalid Microsoft auth URL: {e}"))?,
                )
                .set_token_uri(
                    TokenUrl::new(
                        "https://login.microsoftonline.com/consumers/oauth2/v2.0/token".to_string(),
                    )
                    .map_err(|e| format!("Invalid Microsoft token URL: {e}"))?,
                )
                .set_redirect_uri(
                    RedirectUrl::new(format!("{}/auth/microsoft/callback", config.public_url))
                        .map_err(|e| format!("Invalid Microsoft redirect URL: {e}"))?,
                ))
        } else {
            None
        };

        let http_client = reqwest::Client::builder()
            .redirect(redirect::Policy::none())
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

        Ok(Self {
            google_client,
            github_client,
            microsoft_client,
            apple_client_id: config.apple_client_id.clone(),
            apple_client_secret: config.apple_client_secret.clone(),
            apple_redirect_uri: format!("{}/auth/apple/callback", config.public_url),
            http_client,
        })
    }

    pub fn enabled_providers(&self) -> Vec<&str> {
        let mut providers = Vec::new();
        if self.google_client.is_some() { providers.push("google"); }
        if self.github_client.is_some() { providers.push("github"); }
        if self.microsoft_client.is_some() { providers.push("microsoft"); }
        if Self::is_configured(&self.apple_client_id, &self.apple_client_secret) { providers.push("apple"); }
        providers
    }

    pub fn google_auth_url(&self, state: &str) -> Option<String> {
        let client = self.google_client.as_ref()?;
        let state = state.to_string();
        let (url, _csrf) = client
            .authorize_url(|| CsrfToken::new(state))
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new("email".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .url();
        Some(url.to_string())
    }

    pub fn github_auth_url(&self, state: &str) -> Option<String> {
        let client = self.github_client.as_ref()?;
        let state = state.to_string();
        let (url, _csrf) = client
            .authorize_url(|| CsrfToken::new(state))
            .add_scope(Scope::new("read:user".to_string()))
            .url();
        Some(url.to_string())
    }

    pub fn microsoft_auth_url(&self, state: &str) -> Option<String> {
        let client = self.microsoft_client.as_ref()?;
        let state = state.to_string();
        let (url, _csrf) = client
            .authorize_url(|| CsrfToken::new(state))
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new("email".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .add_scope(Scope::new("User.Read".to_string()))
            .url();
        Some(url.to_string())
    }

    pub fn apple_auth_url(&self, state: &str) -> Option<String> {
        if !Self::is_configured(&self.apple_client_id, &self.apple_client_secret) {
            return None;
        }
        let mut url = url::Url::parse("https://appleid.apple.com/auth/authorize").unwrap();
        url.query_pairs_mut()
            .append_pair("client_id", &self.apple_client_id)
            .append_pair("redirect_uri", &self.apple_redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", "name email")
            .append_pair("response_mode", "form_post")
            .append_pair("state", state);
        Some(url.to_string())
    }

    pub async fn exchange_google_code(&self, code: &str) -> Result<OAuthUser, String> {
        let client = self.google_client.as_ref().ok_or("Google OAuth not configured")?;
        let token_result = client
            .exchange_code(oauth2::AuthorizationCode::new(code.to_string()))
            .request_async(&self.http_client)
            .await
            .map_err(|e| format!("Google token exchange failed: {e}"))?;

        let access_token = token_result.access_token().secret();

        let user_info: GoogleUserInfo = self
            .http_client
            .get("https://www.googleapis.com/oauth2/v3/userinfo")
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| format!("Google userinfo request failed: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Google userinfo parse failed: {e}"))?;

        Ok(OAuthUser {
            provider: "google".to_string(),
            sub: user_info.sub,
            email: user_info.email,
            name: user_info.name,
            avatar_url: user_info.picture,
        })
    }

    pub async fn exchange_github_code(&self, code: &str) -> Result<OAuthUser, String> {
        let client = self.github_client.as_ref().ok_or("GitHub OAuth not configured")?;
        let token_result = client
            .exchange_code(oauth2::AuthorizationCode::new(code.to_string()))
            .request_async(&self.http_client)
            .await
            .map_err(|e| format!("GitHub token exchange failed: {e}"))?;

        let access_token = token_result.access_token().secret();

        let user_info: GitHubUserInfo = self
            .http_client
            .get("https://api.github.com/user")
            .bearer_auth(access_token)
            .header("User-Agent", "oauth-signer")
            .send()
            .await
            .map_err(|e| format!("GitHub user request failed: {e}"))?
            .json()
            .await
            .map_err(|e| format!("GitHub user parse failed: {e}"))?;

        Ok(OAuthUser {
            provider: "github".to_string(),
            sub: user_info.id.to_string(),
            email: None,
            name: Some(user_info.login),
            avatar_url: user_info.avatar_url,
        })
    }

    pub async fn exchange_apple_code(&self, code: &str) -> Result<OAuthUser, String> {
        // Apple requires a manual token exchange because the standard oauth2 BasicClient
        // doesn't expose the id_token from the response.
        let response: AppleTokenExchangeResponse = self
            .http_client
            .post("https://appleid.apple.com/auth/token")
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("client_id", self.apple_client_id.as_str()),
                ("client_secret", self.apple_client_secret.as_str()),
                ("redirect_uri", self.apple_redirect_uri.as_str()),
            ])
            .send()
            .await
            .map_err(|e| format!("Apple token exchange failed: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Apple token response parse failed: {e}"))?;

        // Decode JWT payload (base64 middle segment) — no signature verification needed
        // since we just received this directly from Apple's token endpoint over HTTPS
        let claims = decode_jwt_payload(&response.id_token)?;

        Ok(OAuthUser {
            provider: "apple".to_string(),
            sub: claims.sub,
            email: claims.email,
            name: None, // Apple only sends name on first auth via the form_post body
            avatar_url: None,
        })
    }

    pub async fn exchange_microsoft_code(&self, code: &str) -> Result<OAuthUser, String> {
        let client = self.microsoft_client.as_ref().ok_or("Microsoft OAuth not configured")?;
        let token_result = client
            .exchange_code(oauth2::AuthorizationCode::new(code.to_string()))
            .request_async(&self.http_client)
            .await
            .map_err(|e| format!("Microsoft token exchange failed: {e}"))?;

        let access_token = token_result.access_token().secret();

        let user_info: MicrosoftUserInfo = self
            .http_client
            .get("https://graph.microsoft.com/v1.0/me")
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| format!("Microsoft user request failed: {e}"))?
            .json()
            .await
            .map_err(|e| format!("Microsoft user parse failed: {e}"))?;

        Ok(OAuthUser {
            provider: "microsoft".to_string(),
            sub: user_info.id,
            email: user_info.mail.or(user_info.user_principal_name),
            name: user_info.display_name,
            avatar_url: None,
        })
    }
}

/// Decode Apple id_token JWT payload without signature verification.
/// Safe when the JWT was just received from Apple's token endpoint over HTTPS.
fn decode_jwt_payload(jwt: &str) -> Result<AppleIdTokenClaims, String> {
    let parts: Vec<&str> = jwt.split('.').collect();
    if parts.len() != 3 {
        return Err("Invalid JWT format".into());
    }
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|e| format!("JWT base64 decode failed: {e}"))?;

    #[derive(Deserialize)]
    struct Claims {
        sub: String,
        email: Option<String>,
    }

    let claims: Claims =
        serde_json::from_slice(&payload_bytes).map_err(|e| format!("JWT payload parse failed: {e}"))?;

    Ok(AppleIdTokenClaims {
        sub: claims.sub,
        email: claims.email,
    })
}
