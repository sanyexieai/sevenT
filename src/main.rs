mod config;
mod http;
mod model;

use std::sync::Arc;

use anyhow::Context;
use axum::Router;
use tokio::{net::TcpListener, signal};
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::{config::AppConfig, http::build_router, model::TranslationService};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    init_tracing();

    let config = AppConfig::from_env().context("failed to load application config")?;
    let service = Arc::new(
        TranslationService::new(config.clone())
            .context("failed to initialize translation service")?,
    );

    let app = build_app(config.clone(), service);
    let listener = TcpListener::bind(config.bind_addr)
        .await
        .with_context(|| format!("failed to bind {}", config.bind_addr))?;

    info!(
        bind = %config.bind_addr,
        model_dir = %config.model_dir.display(),
        device = %config.ct2_device,
        compute_type = %config.ct2_compute_type,
        "translation service started"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("axum server failed")?;

    Ok(())
}

fn build_app(config: AppConfig, service: Arc<TranslationService>) -> Router {
    build_router(config, service).layer(TraceLayer::new_for_http())
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nas_nllb_service=info,tower_http=info".into()),
        )
        .with_target(false)
        .compact()
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{signal, SignalKind};

        if let Ok(mut terminate) = signal(SignalKind::terminate()) {
            terminate.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
