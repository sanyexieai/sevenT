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
  saveBtn: document.getElementById("saveBtn"),
  translateBtn: document.getElementById("translateBtn"),
  restoreBtn: document.getElementById("restoreBtn"),
  status: document.getElementById("status")
};

let busy = false;
let savedFormState = "";
let translatedInCurrentTab = false;

init().catch((error) => {
  setStatus(error.message || String(error), true);
});

async function init() {
  const saved = globalThis.NASTranslators.normalizeConfig(await chrome.storage.sync.get(DEFAULTS));
  writeForm(saved);
  savedFormState = serializeConfig(saved);

  bindFormEvents();
  elements.saveBtn.addEventListener("click", saveOptions);
  elements.translateBtn.addEventListener("click", () => runAction("translate"));
  elements.restoreBtn.addEventListener("click", () => runAction("restore"));
  elements.providerType.addEventListener("change", updateFieldHints);

  updateFieldHints();
  syncButtons();
  await refreshTabState();
}

async function saveOptions() {
  setBusy(true);
  try {
    await persistFormIfNeeded({ showNoChangeMessage: true });
  } catch (error) {
    setStatus(error.message || String(error), true);
  } finally {
    setBusy(false);
  }
}

async function runAction(action) {
  setBusy(true);
  try {
    const payload = await persistFormIfNeeded();
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

async function persistFormIfNeeded(options = {}) {
  const { showNoChangeMessage = false } = options;
  const payload = readForm();
  const serialized = serializeConfig(payload);

  if (serialized === savedFormState) {
    if (showNoChangeMessage) {
      setStatus("配置未修改，无需保存。");
    }
    syncButtons();
    return payload;
  }

  await chrome.storage.sync.set(payload);
  savedFormState = serialized;
  syncButtons();
  setStatus("配置已保存。");
  return payload;
}

function readForm() {
  const config = globalThis.NASTranslators.normalizeConfig({
    providerType: elements.providerType.value.trim() || DEFAULTS.providerType,
    endpoint: elements.endpoint.value.trim(),
    renderMode: elements.renderMode.value.trim() || DEFAULTS.renderMode,
    model: elements.model.value.trim(),
    apiKey: elements.apiKey.value.trim(),
    sourceLang: elements.sourceLang.value.trim() || DEFAULTS.sourceLang,
    targetLang: elements.targetLang.value.trim() || DEFAULTS.targetLang,
    maxTargets: Math.max(1, Number(elements.maxTargets.value) || DEFAULTS.maxTargets),
    customSkipPatterns: elements.customSkipPatterns.value
  });

  validateConfig(config);
  return config;
}

function writeForm(config) {
  elements.providerType.value = config.providerType;
  elements.endpoint.value = config.endpoint;
  elements.renderMode.value = config.renderMode;
  elements.model.value = config.model;
  elements.apiKey.value = config.apiKey;
  elements.sourceLang.value = config.sourceLang;
  elements.targetLang.value = config.targetLang;
  elements.maxTargets.value = String(config.maxTargets);
  elements.customSkipPatterns.value = config.customSkipPatterns;
}

function bindFormEvents() {
  const fields = [
    elements.providerType,
    elements.endpoint,
    elements.renderMode,
    elements.model,
    elements.apiKey,
    elements.sourceLang,
    elements.targetLang,
    elements.maxTargets,
    elements.customSkipPatterns
  ];

  for (const field of fields) {
    field.addEventListener("input", handleFormEdited);
    field.addEventListener("change", handleFormEdited);
  }
}

function handleFormEdited() {
  if (!busy) {
    setStatus(isDirty() ? "检测到未保存修改。" : "配置已与已保存版本一致。");
  }
  syncButtons();
}

function isDirty() {
  return serializeConfig(readForm()) !== savedFormState;
}

function serializeConfig(config) {
  return JSON.stringify(globalThis.NASTranslators.normalizeConfig(config));
}

function setBusy(nextBusy) {
  busy = Boolean(nextBusy);
  syncButtons();
}

function syncButtons() {
  const dirty = isDirty();
  elements.saveBtn.disabled = busy || !dirty;
  elements.translateBtn.disabled = busy;
  elements.restoreBtn.disabled = busy || !translatedInCurrentTab;
  elements.translateBtn.textContent = dirty ? "保存并翻译" : (translatedInCurrentTab ? "重新翻译整页" : "翻译整页");
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.style.color = isError ? "#a12626" : "#43564d";
}

function validateConfig(config) {
  if (!config.endpoint) {
    throw new Error("请填写接口地址，当前不再自动回退到默认地址。");
  }

  try {
    new URL(config.endpoint);
  } catch (_error) {
    throw new Error(`接口地址格式不正确：${config.endpoint}`);
  }
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

  syncButtons();
}

async function refreshTabState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    translatedInCurrentTab = false;
    syncButtons();
    return;
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: "NAS_PING" })
    .catch(() => null);

  const state = await chrome.runtime.sendMessage({
    type: "NAS_GET_TAB_STATE_FOR_TAB",
    payload: { tabId: tab.id }
  }).catch(() => null);

  if (!state?.ok) {
    translatedInCurrentTab = false;
    syncButtons();
    return;
  }

  translatedInCurrentTab = Boolean(state.translated);
  elements.restoreBtn.textContent = "显示原文";
  syncButtons();

  if (!response?.ok) {
    setStatus("当前页面需要先刷新，整页翻译和侧边快捷按钮才会生效。");
    return;
  }

  setStatus(`当前接口地址：${state.endpoint || "未设置"}`);
}
