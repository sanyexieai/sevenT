(function (global) {
  const DEFAULTS = {
    providerType: "http_nllb",
    endpoint: "http://3ye.co:18080/",
    sourceLang: "eng_Latn",
    targetLang: "zho_Hans",
    maxTargets: 400,
    renderMode: "compare",
    model: "",
    apiKey: "",
    customSkipPatterns: ""
  };

  function normalizeConfig(raw = {}) {
    const config = {
      ...DEFAULTS,
      ...raw
    };

    if (!config.endpoint && raw.serviceUrl) {
      config.endpoint = raw.serviceUrl;
    }
    if (!config.maxTargets && raw.maxNodes) {
      config.maxTargets = raw.maxNodes;
    }

    config.providerType = String(config.providerType || DEFAULTS.providerType);
    config.endpoint = String(config.endpoint || "").trim();
    config.sourceLang = String(config.sourceLang || DEFAULTS.sourceLang).trim();
    config.targetLang = String(config.targetLang || DEFAULTS.targetLang).trim();
    config.maxTargets = Math.max(1, Number(config.maxTargets) || DEFAULTS.maxTargets);
    config.renderMode = String(config.renderMode || DEFAULTS.renderMode).trim();
    config.model = String(config.model || "").trim();
    config.apiKey = String(config.apiKey || "").trim();
    config.customSkipPatterns = String(config.customSkipPatterns || "").trim();

    return config;
  }

  async function translate(payload, rawConfig) {
    const config = normalizeConfig(rawConfig);
    const provider = PROVIDERS[config.providerType];

    if (!provider) {
      throw new Error(`Unsupported translator provider: ${config.providerType}`);
    }

    if (!config.endpoint) {
      throw new Error("Translation endpoint is empty.");
    }

    return provider.translate(payload, config);
  }

  const PROVIDERS = {
    http_nllb: {
      async translate(payload, config) {
        const response = await fetch(resolveHttpNllbEndpoint(config.endpoint), {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: payload.text,
            source_lang: payload.sourceLang,
            target_lang: payload.targetLang
          })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Translation request failed with ${response.status} via ${resolveHttpNllbEndpoint(config.endpoint)}`);
        }
        if (typeof data.text !== "string") {
          throw new Error("Translation response did not contain text.");
        }
        return data.text;
      }
    },
    http_openai_chat: {
      async translate(payload, config) {
        if (!config.model) {
          throw new Error("OpenAI-compatible chat provider requires a model.");
        }

        const response = await fetch(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              {
                role: "system",
                content: "You are a translation engine. Preserve meaning, keep URLs/code/path-like fragments unchanged, and return only the translated text."
              },
              {
                role: "user",
                content: `Translate from ${payload.sourceLang} to ${payload.targetLang}:\n\n${payload.text}`
              }
            ]
          })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error?.message || data.error || `Translation request failed with ${response.status} via ${config.endpoint}`);
        }

        const text = data.choices?.[0]?.message?.content;
        if (typeof text !== "string") {
          throw new Error("Chat completion response did not contain translated text.");
        }
        return text;
      }
    },
    http_openai_responses: {
      async translate(payload, config) {
        if (!config.model) {
          throw new Error("OpenAI-compatible responses provider requires a model.");
        }

        const response = await fetch(config.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
          },
          body: JSON.stringify({
            model: config.model,
            input: `Translate from ${payload.sourceLang} to ${payload.targetLang}. Preserve URLs/code/path-like fragments unchanged. Return only the translated text.\n\n${payload.text}`
          })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error?.message || data.error || `Translation request failed with ${response.status} via ${config.endpoint}`);
        }

        const text =
          data.output_text
          || data.output?.map((item) => item?.content?.map((c) => c?.text).join("")).join("")
          || "";

        if (!text) {
          throw new Error("Responses API result did not contain translated text.");
        }
        return text;
      }
    },
    mcp: {
      async translate() {
        throw new Error("MCP translator provider is reserved for future integration and is not wired in this extension yet.");
      }
    },
    native_app: {
      async translate() {
        throw new Error("Native app translator provider is reserved for future integration and is not wired in this extension yet.");
      }
    }
  };

  global.NASTranslators = {
    DEFAULTS,
    normalizeConfig,
    translate,
    listProviders() {
      return Object.keys(PROVIDERS);
    }
  };

  function resolveHttpNllbEndpoint(endpoint) {
    const url = new URL(endpoint);
    if (url.pathname === "/" || url.pathname === "") {
      url.pathname = "/v1/translate";
    }
    return url.toString();
  }
})(globalThis);
