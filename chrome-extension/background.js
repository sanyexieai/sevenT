importScripts("translators.js");

const DEFAULTS = globalThis.NASTranslators.DEFAULTS;

const MENU_ID = "nas-translate-page-zh";
const translatedTabs = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "翻译整页为中文",
    contexts: ["page"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) {
    return;
  }

  try {
    const options = globalThis.NASTranslators.normalizeConfig(await chrome.storage.sync.get(DEFAULTS));
    await waitForTabComplete(tab.id);
    await ensureContentScript(tab.id);

    const shouldRestore = translatedTabs.has(tab.id);

    if (shouldRestore) {
      const restoreResponse = await safeSendMessage(tab.id, {
        type: "NAS_RESTORE_PAGE",
        payload: {}
      });

      if (!restoreResponse?.ok) {
        throw new Error(restoreResponse?.error || "恢复原文失败。");
      }

      translatedTabs.delete(tab.id);
      await updateMenuTitle(tab.id);
      await clearBadge();
      return;
    }

    const response = await safeSendMessage(tab.id, {
      type: "NAS_TRANSLATE_PAGE",
      payload: {
        providerType: options.providerType,
        endpoint: options.endpoint,
        renderMode: options.renderMode,
        model: options.model,
        apiKey: options.apiKey,
        sourceLang: options.sourceLang,
        targetLang: options.targetLang,
        maxTargets: options.maxTargets,
        serviceUrl: options.endpoint,
        maxNodes: options.maxTargets
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "整页翻译失败。");
    }

    translatedTabs.add(tab.id);
    await updateMenuTitle(tab.id);
    await clearBadge();
  } catch (error) {
    try {
      await safeSendMessage(tab.id, {
        type: "NAS_SHOW_SELECTION_TRANSLATION",
        payload: {
          sourceText: "整页翻译失败",
          translatedText: "",
          sourceLang: DEFAULTS.sourceLang,
          targetLang: DEFAULTS.targetLang,
          error: error.message || String(error)
        }
      });
    } catch (_innerError) {
      await showFallbackNotification(error.message || String(error));
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  translatedTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    translatedTabs.delete(tabId);
    void updateMenuTitle(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "NAS_TRANSLATE_TEXT") {
    translateViaService(message.payload)
      .then((translatedText) => sendResponse({ ok: true, translatedText }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  if (message?.type === "NAS_GET_TAB_STATE") {
    const tabId = _sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "未找到标签页状态。" });
      return false;
    }
    chrome.storage.sync.get(DEFAULTS).then((saved) => {
      const options = globalThis.NASTranslators.normalizeConfig(saved);
      sendResponse({
        ok: true,
        translated: translatedTabs.has(tabId),
        renderMode: options.renderMode,
        targetLang: options.targetLang
      });
    });
    return true;
  }

  if (message?.type === "NAS_GET_TAB_STATE_FOR_TAB") {
    const tabId = message?.payload?.tabId;
    if (!tabId) {
      sendResponse({ ok: false, error: "未找到目标标签页。" });
      return false;
    }
    chrome.storage.sync.get(DEFAULTS).then((saved) => {
      const options = globalThis.NASTranslators.normalizeConfig(saved);
      sendResponse({
        ok: true,
        translated: translatedTabs.has(tabId),
        renderMode: options.renderMode,
        targetLang: options.targetLang
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }

  if (message?.type === "NAS_TOGGLE_PAGE_TRANSLATION") {
    const tabId = _sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "未找到当前标签页。" });
      return false;
    }
    handleToggleTranslation(tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "NAS_SET_PAGE_TRANSLATION") {
    const tabId = message?.payload?.tabId;
    const action = message?.payload?.action;
    const options = message?.payload?.options;
    if (!tabId || !action) {
      sendResponse({ ok: false, error: "缺少页面操作参数。" });
      return false;
    }
    handleSetTranslation(tabId, action, options)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "NAS_TOGGLE_RENDER_MODE") {
    const tabId = _sender?.tab?.id;
    chrome.storage.sync.get(DEFAULTS).then(async (saved) => {
      const options = globalThis.NASTranslators.normalizeConfig(saved);
      const nextMode = options.renderMode === "compare" ? "replace" : "compare";
      await chrome.storage.sync.set({ ...options, renderMode: nextMode });
      if (tabId && translatedTabs.has(tabId)) {
        await handleSetTranslation(tabId, "restore", options);
        await handleSetTranslation(tabId, "translate", { ...options, renderMode: nextMode });
      }
      sendResponse({ ok: true, renderMode: nextMode });
    }).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  }

  return false;
});

async function handleToggleTranslation(tabId) {
  const options = globalThis.NASTranslators.normalizeConfig(await chrome.storage.sync.get(DEFAULTS));
  await waitForTabComplete(tabId);
  await ensureContentScript(tabId);

  if (translatedTabs.has(tabId)) {
    const restoreResponse = await safeSendMessage(tabId, {
      type: "NAS_RESTORE_PAGE",
      payload: {}
    });

    if (!restoreResponse?.ok) {
      throw new Error(restoreResponse?.error || "显示原文失败。");
    }

    translatedTabs.delete(tabId);
    await updateMenuTitle(tabId);
    await clearBadge();
    return { translated: false, message: restoreResponse.message || "已显示原文。" };
  }

  const response = await safeSendMessage(tabId, {
    type: "NAS_TRANSLATE_PAGE",
    payload: {
      providerType: options.providerType,
      endpoint: options.endpoint,
      renderMode: options.renderMode,
      model: options.model,
      apiKey: options.apiKey,
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      maxTargets: options.maxTargets,
      serviceUrl: options.endpoint,
      maxNodes: options.maxTargets
    }
  });

  if (!response?.ok) {
    throw new Error(response?.error || "整页翻译失败。");
  }

  translatedTabs.add(tabId);
  await updateMenuTitle(tabId);
  await clearBadge();
  return { translated: true, message: response.message || "整页翻译完成。" };
}

async function handleSetTranslation(tabId, action, optionsOverride) {
  const saved = globalThis.NASTranslators.normalizeConfig(await chrome.storage.sync.get(DEFAULTS));
  const options = globalThis.NASTranslators.normalizeConfig({ ...saved, ...(optionsOverride || {}) });
  await waitForTabComplete(tabId);
  await ensureContentScript(tabId);

  if (action === "restore") {
    const restoreResponse = await safeSendMessage(tabId, {
      type: "NAS_RESTORE_PAGE",
      payload: {}
    });

    if (!restoreResponse?.ok) {
      throw new Error(restoreResponse?.error || "显示原文失败。");
    }

    translatedTabs.delete(tabId);
    await updateMenuTitle(tabId);
    await clearBadge();
    return { translated: false, message: "已显示原文。" };
  }

  const response = await safeSendMessage(tabId, {
    type: "NAS_TRANSLATE_PAGE",
    payload: {
      providerType: options.providerType,
      endpoint: options.endpoint,
      renderMode: options.renderMode,
      model: options.model,
      apiKey: options.apiKey,
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      maxTargets: options.maxTargets,
      serviceUrl: options.endpoint,
      maxNodes: options.maxTargets
    }
  });

  if (!response?.ok) {
    throw new Error(response?.error || "整页翻译失败。");
  }

  translatedTabs.add(tabId);
  await updateMenuTitle(tabId);
  await clearBadge();
  return { translated: true, message: "整页翻译完成。" };
}

async function ensureContentScript(tabId) {
  try {
    await safeSendMessage(tabId, { type: "NAS_PING" });
  } catch (_error) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    await safeSendMessage(tabId, { type: "NAS_PING" });
  }
}

async function waitForTabComplete(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    return;
  }

  await new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function safeSendMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    if (text.includes("Receiving end does not exist")) {
      throw new Error("当前页面不支持注入扩展脚本，或者扩展刚更新后页面还没刷新。请先刷新页面后重试。");
    }
    if (text.includes("Cannot access a chrome:// URL")) {
      throw new Error("Chrome 内置页面不支持全文翻译，请在普通网页里使用。");
    }
    throw error;
  }
}

async function showFallbackNotification(message) {
  await chrome.action.setBadgeBackgroundColor({ color: "#a12626" });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setTitle({
    title: `NAS 页面翻译\n${message}`
  });
}

async function clearBadge() {
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({
    title: "NAS 页面翻译"
  });
}

async function updateMenuTitle(tabId) {
  await chrome.contextMenus.update(MENU_ID, {
    title: translatedTabs.has(tabId) ? "显示原文" : "翻译整页为中文"
  });
}

async function translateViaService(payload) {
  return globalThis.NASTranslators.translate(
    {
      text: payload.text,
      sourceLang: payload.sourceLang,
      targetLang: payload.targetLang
    },
    payload
  );
}
