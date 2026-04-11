use std::{env, net::SocketAddr, path::Path, path::PathBuf};

use anyhow::{anyhow, Context, Result};
use ct2rs::{ComputeType, Config, Device, TranslationOptions};

#[derive(Clone)]
pub struct AppConfig {
    pub bind_addr: SocketAddr,
    pub model_dir: PathBuf,
    pub request_log_path: PathBuf,
    pub default_source_lang: String,
    pub default_target_lang: String,
    pub ct2_device: String,
    pub ct2_compute_type: String,
    pub ct2_threads: usize,
    pub translation_beam_size: usize,
    pub translation_max_input_length: usize,
    pub translation_max_decoding_length: usize,
}

impl AppConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            bind_addr: env_var("APP_BIND", "0.0.0.0:18080")?
                .parse()
                .context("APP_BIND must be a valid socket address")?,
            model_dir: PathBuf::from(env_var("MODEL_DIR", "models/nllb-200-distilled-600M")?),
            request_log_path: PathBuf::from(env_var("REQUEST_LOG_PATH", "logs/requests.jsonl")?),
            default_source_lang: env_var("DEFAULT_SOURCE_LANG", "eng_Latn")?,
            default_target_lang: env_var("DEFAULT_TARGET_LANG", "zho_Hans")?,
            ct2_device: resolve_device(env_var("CT2_DEVICE", "auto")?),
            ct2_compute_type: env_var("CT2_COMPUTE_TYPE", "default")?,
            ct2_threads: env_usize("CT2_THREADS", 0)?,
            translation_beam_size: env_usize("TRANSLATION_BEAM_SIZE", 4)?,
            translation_max_input_length: env_usize("TRANSLATION_MAX_INPUT_LENGTH", 512)?,
            translation_max_decoding_length: env_usize("TRANSLATION_MAX_DECODING_LENGTH", 256)?,
        })
    }

    pub fn ct2_config(&self) -> Result<Config> {
        Ok(Config {
            device: parse_device(&self.ct2_device)?,
            compute_type: parse_compute_type(&self.ct2_compute_type)?,
            num_threads_per_replica: self.ct2_threads,
            ..Default::default()
        })
    }

    pub fn translation_options(&self) -> TranslationOptions<String, String> {
        TranslationOptions {
            beam_size: self.translation_beam_size,
            max_input_length: self.translation_max_input_length,
            max_decoding_length: self.translation_max_decoding_length,
            ..Default::default()
        }
    }
}

fn env_var(key: &str, default: &str) -> Result<String> {
    Ok(env::var(key).unwrap_or_else(|_| default.to_owned()))
}

fn env_usize(key: &str, default: usize) -> Result<usize> {
    env::var(key)
        .unwrap_or_else(|_| default.to_string())
        .parse()
        .with_context(|| format!("{key} must be a valid usize"))
}

fn parse_device(input: &str) -> Result<Device> {
    match input.to_ascii_lowercase().as_str() {
        "cpu" => Ok(Device::CPU),
        "cuda" | "gpu" => Ok(Device::CUDA),
        other => Err(anyhow!("unsupported CT2_DEVICE: {other}")),
    }
}

fn resolve_device(input: String) -> String {
    match input.to_ascii_lowercase().as_str() {
        "auto" | "gpu_preferred" | "prefer_gpu" => {
            if has_nvidia_gpu() {
                "cuda".to_string()
            } else {
                "cpu".to_string()
            }
        }
        "cpu" | "cuda" | "gpu" => input,
        _ => input,
    }
}

fn has_nvidia_gpu() -> bool {
    [
        "/dev/nvidiactl",
        "/dev/nvidia0",
        "/proc/driver/nvidia/version",
    ]
    .iter()
    .any(|path| Path::new(path).exists())
}

fn parse_compute_type(input: &str) -> Result<ComputeType> {
    match input.to_ascii_lowercase().as_str() {
        "default" => Ok(ComputeType::DEFAULT),
        "auto" => Ok(ComputeType::AUTO),
        "float32" => Ok(ComputeType::FLOAT32),
        "int8" => Ok(ComputeType::INT8),
        "int8_float32" => Ok(ComputeType::INT8_FLOAT32),
        "int8_float16" => Ok(ComputeType::INT8_FLOAT16),
        "int8_bfloat16" => Ok(ComputeType::INT8_BFLOAT16),
        "int16" => Ok(ComputeType::INT16),
        "float16" => Ok(ComputeType::FLOAT16),
        "bfloat16" => Ok(ComputeType::BFLOAT16),
        other => Err(anyhow!("unsupported CT2_COMPUTE_TYPE: {other}")),
    }
}
