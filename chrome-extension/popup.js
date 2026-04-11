const DEFAULTS = globalThis.NASTranslators.DEFAULTS;

const elements = {
  providerType: document.getElementById("providerType"),
  endpoint: document.getElementById("endpoint"),
  renderMode: document.getElementById("renderMode"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("apiKey"),
  sourceLang: document.getElementById("sourceLang"),
  targetLang: document.getElementById("targetLang"),
  maxTargets: document.getElementById("maxTargets"),
  customSkipPatterns: document.getElementById("customSkipPatterns"),
  translateBtn: document.getElementById("translateBtn"),
  restoreBtn: document.getElementById("restoreBtn"),
  status: document.getElementById("status")
};

init().catch((error) => {
  setStatus(error.message || String(error), true);
});

async function init() {
  const saved = globalThis.NASTranslators.normalizeConfig(await chrome.storage.sync.get(DEFAULTS));
  elements.providerType.value = saved.providerType;
  elements.endpoint.value = saved.endpoint;
  elements.renderMode.value = saved.renderMode;
  elements.model.value = saved.model;
  elements.apiKey.value = saved.apiKey;
  elements.sourceLang.value = saved.sourceLang;
  elements.targetLang.value = saved.targetLang;
  elements.maxTargets.value = String(saved.maxTargets);
  elements.customSkipPatterns.value = saved.customSkipPatterns;

  elements.translateBtn.addEventListener("click", () => runAction("translate"));
  elements.restoreBtn.addEventListener("click", () => runAction("restore"));
  elements.providerType.addEventListener("change", updateFieldHints);
  updateFieldHints();
  await refreshTabState();
}

async function runAction(action) {
  setBusy(true);
  try {
    const payload = readForm();
    await chrome.storage.sync.set(payload);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("未找到当前活动标签页。");
    }

    const response = await chrome.runtime.sendMessage({
      type: "NAS_SET_PAGE_TRANSLATION",
      payload: {
        tabId: tab.id,
        action,
        options: payload
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "扩展操作失败。");
    }

    await refreshTabState();
    setStatus(response.message || "操作完成。");
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

function readForm() {
  return globalThis.NASTranslators.normalizeConfig({
    providerType: elements.providerType.value.trim() || DEFAULTS.providerType,
    endpoint: elements.endpoint.value.trim() || DEFAULTS.endpoint,
    renderMode: elements.renderMode.value.trim() || DEFAULTS.renderMode,
    model: elements.model.value.trim(),
    apiKey: elements.apiKey.value.trim(),
    sourceLang: elements.sourceLang.value.trim() || DEFAULTS.sourceLang,
    targetLang: elements.targetLang.value.trim() || DEFAULTS.targetLang,
    maxTargets: Math.max(1, Number(elements.maxTargets.value) || DEFAULTS.maxTargets),
    customSkipPatterns: elements.customSkipPatterns.value
  });
}

function setBusy(busy) {
  elements.translateBtn.disabled = busy;
  elements.restoreBtn.disabled = busy;
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#a12626" : "#43564d";
}

function updateFieldHints() {
  const providerType = elements.providerType.value;

  if (providerType === "http_nllb") {
    elements.endpoint.placeholder = "http://3ye.co:18080/ 或 http://3ye.co:18080/v1/translate";
    elements.model.disabled = true;
    elements.apiKey.disabled = true;
  } else if (providerType === "http_openai_chat") {
    elements.endpoint.placeholder = "https://api.example.com/v1/chat/completions";
    elements.model.disabled = false;
    elements.apiKey.disabled = false;
  } else if (providerType === "http_openai_responses") {
    elements.endpoint.placeholder = "https://api.example.com/v1/responses";
    elements.model.disabled = false;
    elements.apiKey.disabled = false;
  } else {
    elements.endpoint.placeholder = "预留给后续集成";
    elements.model.disabled = false;
    elements.apiKey.disabled = false;
  }
}

async function refreshTabState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: "NAS_PING" })
    .catch(() => null);

  const state = await chrome.runtime.sendMessage({
    type: "NAS_GET_TAB_STATE_FOR_TAB",
    payload: { tabId: tab.id }
  }).catch(() => null);

  if (!state?.ok) {
    return;
  }

  elements.translateBtn.disabled = false;
  elements.restoreBtn.disabled = !state.translated;
  elements.translateBtn.textContent = state.translated ? "重新翻译整页" : "翻译整页";
  elements.restoreBtn.textContent = "显示原文";

  if (!response?.ok) {
    setStatus("当前页面需要先刷新后，整页翻译和侧边快捷按钮才会生效。");
  }
}
