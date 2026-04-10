use std::{path::Path, time::Instant};

use anyhow::{anyhow, Context, Result};
use ct2rs::Translator;
use serde::Serialize;

use crate::config::AppConfig;

pub struct TranslationService {
    translator: Translator<ct2rs::tokenizers::auto::Tokenizer>,
    config: AppConfig,
}

#[derive(Debug)]
pub struct TranslateParams {
    pub text: String,
    pub source_lang: Option<String>,
    pub target_lang: Option<String>,
}

#[derive(Serialize)]
pub struct TranslationOutput {
    pub text: String,
    pub detected_source_lang: String,
    pub target_lang: String,
    pub elapsed_ms: u128,
    pub score: Option<f32>,
}

#[derive(Serialize)]
pub struct ModelStatus {
    pub model_dir: String,
    pub default_source_lang: String,
    pub default_target_lang: String,
    pub device: String,
    pub compute_type: String,
    pub replicas: usize,
    pub queued_batches: usize,
    pub active_batches: usize,
}

impl TranslationService {
    pub fn new(config: AppConfig) -> Result<Self> {
        if !Path::new(&config.model_dir).exists() {
            return Err(anyhow!(
                "model directory does not exist: {}",
                config.model_dir.display()
            ));
        }

        let translator = Translator::new(&config.model_dir, &config.ct2_config()?)
            .with_context(|| format!("failed to load model from {}", config.model_dir.display()))?;

        Ok(Self { translator, config })
    }

    pub fn translate(&self, params: TranslateParams) -> Result<TranslationOutput> {
        let source_lang = params
            .source_lang
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| self.config.default_source_lang.clone());
        let target_lang = params
            .target_lang
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| self.config.default_target_lang.clone());

        if params.text.trim().is_empty() {
            return Err(anyhow!("text must not be empty"));
        }

        let started = Instant::now();
        let prefixed_source = format!("{source_lang} {}", params.text.trim());
        let target_prefix = vec![vec![target_lang.clone()]];
        let result = self
            .translator
            .translate_batch_with_target_prefix(
                &[prefixed_source],
                &target_prefix,
                &self.config.translation_options(),
                None,
            )
            .context("translation failed")?;

        let (text, score) = result
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("translation returned no result"))?;

        Ok(TranslationOutput {
            text,
            detected_source_lang: source_lang,
            target_lang,
            elapsed_ms: started.elapsed().as_millis(),
            score,
        })
    }

    pub fn status(&self) -> Result<ModelStatus> {
        Ok(ModelStatus {
            model_dir: self.config.model_dir.display().to_string(),
            default_source_lang: self.config.default_source_lang.clone(),
            default_target_lang: self.config.default_target_lang.clone(),
            device: self.config.ct2_device.clone(),
            compute_type: self.config.ct2_compute_type.clone(),
            replicas: self.translator.num_replicas()?,
            queued_batches: self.translator.num_queued_batches()?,
            active_batches: self.translator.num_active_batches()?,
        })
    }
}
