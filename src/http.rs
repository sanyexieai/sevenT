use std::sync::Arc;

use axum::{
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::{
    config::AppConfig,
    model::TranslateParams,
    model::TranslationService,
    request_log::{RequestLogEntry, RequestLogger},
};

#[derive(Clone)]
pub struct AppState {
    pub config: AppConfig,
    pub service: Arc<TranslationService>,
    pub request_logger: Arc<RequestLogger>,
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

pub fn build_router(
    config: AppConfig,
    service: Arc<TranslationService>,
    request_logger: Arc<RequestLogger>,
) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/translate", post(translate))
        .route("/v1/status", get(status))
        .with_state(AppState {
            config,
            service,
            request_logger,
        })
}

async fn healthz() -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true
    }))
}

async fn translate(
    State(state): State<AppState>,
    headers: HeaderMap,
    connect_info: Option<ConnectInfo<std::net::SocketAddr>>,
    Json(payload): Json<TranslateRequest>,
) -> impl IntoResponse {
    let TranslateRequest {
        text,
        source_lang,
        target_lang,
    } = payload;

    let user_agent = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let client_ip = connect_info.map(|info| info.0.ip().to_string());
    let mut log_entry = RequestLogEntry::new(
        "POST",
        "/v1/translate",
        &text,
        source_lang.clone(),
        target_lang.clone(),
        user_agent,
        client_ip,
    );

    let response = match state.service.translate(TranslateParams {
        text,
        source_lang,
        target_lang,
    }) {
        Ok(output) => {
            log_entry.success = true;
            log_entry.elapsed_ms = Some(output.elapsed_ms);
            log_entry.score = output.score;
            (StatusCode::OK, Json(serde_json::json!(output))).into_response()
        }
        Err(err) => {
            log_entry.error = Some(err.to_string());
            (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!(ApiError {
                error: err.to_string()
            })),
        )
                .into_response()
        }
    };

    if let Err(err) = state.request_logger.log(log_entry) {
        warn!(error = %err, "failed to persist request log entry");
    }

    response
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
