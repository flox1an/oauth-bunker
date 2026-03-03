use axum_embed::{FallbackBehavior, ServeEmbed};
use rust_embed::RustEmbed;

#[derive(RustEmbed, Clone)]
#[folder = "web-ui/dist/"]
pub struct Assets;

pub fn serve_assets() -> ServeEmbed<Assets> {
    ServeEmbed::<Assets>::with_parameters(
        Some("index.html".to_string()),
        FallbackBehavior::Ok,
        None,
    )
}
