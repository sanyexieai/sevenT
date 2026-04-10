use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{config::AppConfig, model::TranslateParams, model::TranslationService};

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub service: Arc<TranslationService>,
}

#[derive(Deserialize)]
pub struct TranslateRequest {
    pub text: String,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
}

#[derive(Serialize)]
pub struct ApiError {
    pub error: String,
}

pub fn build_router(config: AppConfig, service: Arc<TranslationService>) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/translate", post(translate))
        .route("/v1/status", get(status))
        .with_state(AppState { config, service })
}

async fn healthz() -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true
    }))
}

async fn translate(
    State(state): State<AppState>,
    Json(payload): Json<TranslateRequest>,
) -> impl IntoResponse {
    match state.service.translate(TranslateParams {
        text: payload.text,
        source_lang: payload.source_lang,
        target_lang: payload.target_lang,
    }) {
        Ok(output) => (StatusCode::OK, Json(serde_json::json!(output))).into_response(),
        Err(err) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!(ApiError {
                error: err.to_string()
            })),
        )
            .into_response(),
    }
}

async fn status(State(state): State<AppState>) -> impl IntoResponse {
    match state.service.status() {
        Ok(model_status) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "bind": state.config.bind_addr,
                "model": model_status
            })),
        )
            .into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!(ApiError {
                error: err.to_string()
            })),
        )
            .into_response(),
    }
}
