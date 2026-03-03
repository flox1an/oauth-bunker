use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, ClientId, ClientSecret, CsrfToken, EndpointNotSet, EndpointSet, RedirectUrl, Scope,
    TokenResponse, TokenUrl,
};
use reqwest::redirect;
use serde::Deserialize;

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
    google_client: ConfiguredClient,
    github_client: ConfiguredClient,
    microsoft_client: ConfiguredClient,
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
    name: Option<String>,
    avatar_url: Option<String>,
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
    pub fn new(config: &Config) -> Result<Self, String> {
        let google_client = BasicClient::new(ClientId::new(config.google_client_id.clone()))
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
            );

        let github_client = BasicClient::new(ClientId::new(config.github_client_id.clone()))
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
            );

        let microsoft_client =
            BasicClient::new(ClientId::new(config.microsoft_client_id.clone()))
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
                );

        let http_client = reqwest::Client::builder()
            .redirect(redirect::Policy::none())
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

        Ok(Self {
            google_client,
            github_client,
            microsoft_client,
            http_client,
        })
    }

    pub fn google_auth_url(&self, state: &str) -> String {
        let state = state.to_string();
        let (url, _csrf) = self
            .google_client
            .authorize_url(|| CsrfToken::new(state))
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new("email".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .url();
        url.to_string()
    }

    pub fn github_auth_url(&self, state: &str) -> String {
        let state = state.to_string();
        let (url, _csrf) = self
            .github_client
            .authorize_url(|| CsrfToken::new(state))
            .add_scope(Scope::new("read:user".to_string()))
            .url();
        url.to_string()
    }

    pub fn microsoft_auth_url(&self, state: &str) -> String {
        let state = state.to_string();
        let (url, _csrf) = self
            .microsoft_client
            .authorize_url(|| CsrfToken::new(state))
            .add_scope(Scope::new("openid".to_string()))
            .add_scope(Scope::new("email".to_string()))
            .add_scope(Scope::new("profile".to_string()))
            .add_scope(Scope::new("User.Read".to_string()))
            .url();
        url.to_string()
    }

    pub async fn exchange_google_code(&self, code: &str) -> Result<OAuthUser, String> {
        let token_result = self
            .google_client
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
        let token_result = self
            .github_client
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
            name: user_info.name.or(Some(user_info.login)),
            avatar_url: user_info.avatar_url,
        })
    }

    pub async fn exchange_microsoft_code(&self, code: &str) -> Result<OAuthUser, String> {
        let token_result = self
            .microsoft_client
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
