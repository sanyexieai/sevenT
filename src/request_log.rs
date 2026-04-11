use std::{
    fs::{create_dir_all, OpenOptions},
    io::{BufWriter, Write},
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
pub struct RequestLogEntry {
    pub id: String,
    pub timestamp_ms: u128,
    pub method: String,
    pub path: String,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
    pub text_chars: usize,
    pub text_preview: String,
    pub user_agent: Option<String>,
    pub client_ip: Option<String>,
    pub success: bool,
    pub elapsed_ms: Option<u128>,
    pub score: Option<f32>,
    pub error: Option<String>,
}

pub struct RequestLogger {
    writer: Mutex<BufWriter<std::fs::File>>,
}

impl RequestLogger {
    pub fn new(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            create_dir_all(parent)
                .with_context(|| format!("failed to create request log directory {}", parent.display()))?;
        }

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .with_context(|| format!("failed to open request log file {}", path.display()))?;

        Ok(Self {
            writer: Mutex::new(BufWriter::new(file)),
        })
    }

    pub fn log(&self, entry: RequestLogEntry) -> Result<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| anyhow::anyhow!("request log writer lock poisoned"))?;
        serde_json::to_writer(&mut *writer, &entry).context("failed to serialize request log entry")?;
        writer.write_all(b"\n").context("failed to write request log newline")?;
        writer.flush().context("failed to flush request log")?;
        Ok(())
    }
}

impl RequestLogEntry {
    pub fn new(
        method: &str,
        path: &str,
        text: &str,
        source_lang: Option<String>,
        target_lang: Option<String>,
        user_agent: Option<String>,
        client_ip: Option<String>,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            method: method.to_string(),
            path: path.to_string(),
            source_lang,
            target_lang,
            text_chars: text.chars().count(),
            text_preview: truncate_preview(text, 160),
            user_agent,
            client_ip,
            success: false,
            elapsed_ms: None,
            score: None,
            error: None,
        }
    }
}

fn truncate_preview(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    let mut preview = String::new();
    for ch in trimmed.chars().take(max_chars) {
        preview.push(ch);
    }
    preview
}
