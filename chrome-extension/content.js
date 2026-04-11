(function () {
  const DEBUG_TRANSLATION = false;
  const BUILTIN_SKIP_RULES = [
    {
      name: "url",
      test: (text) => /^(https?:\/\/|www\.)\S+$/i.test(text)
    },
    {
      name: "email",
      test: (text) => /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/i.test(text)
    },
    {
      name: "absolute-path",
      test: (text) => /^\/(?:[A-Za-z0-9._-]+\/){1,}[A-Za-z0-9._-]+\/?$/.test(text)
    },
    {
      name: "windows-path",
      test: (text) => /^[A-Za-z]:\\[^\s]+$/.test(text)
    },
    {
      name: "html-tag",
      test: (text) => /^<\/?[a-z][a-z0-9-]*[^>]*>$/i.test(text)
    },
    {
      name: "html-entity",
      test: (text) => /^&[a-z0-9#]+;$/i.test(text)
    },
    {
      name: "domain",
      test: (text) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(text)
    },
    {
      name: "version",
      test: (text) => /^v?\d+\.\d+(?:\.\d+){0,3}$/i.test(text)
    },
    {
      name: "hash",
      test: (text) => /^(?:0x)?[a-f0-9]{8,}$/i.test(text)
    }
  ];
  const state = {
    translating: false,
    observerMuted: false,
    originals: new WeakMap(),
    translatedNodes: new Set(),
    translatedAttributes: [],
    compareBlocks: [],
    compareBlockByRoot: new WeakMap(),
    liveObserver: null,
    liveTranslateEnabled: false,
    liveOptions: null,
    livePendingRoots: new Set(),
    liveFlushTimer: null,
    selectionCard: null,
    sidebar: null
  };

  initSidebar();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "NAS_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "NAS_TRANSLATE_PAGE") {
      translatePage(message.payload)
        .then((result) => sendResponse({ ok: true, message: result }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message?.type === "NAS_RESTORE_PAGE") {
      try {
        const restored = restorePage();
        refreshSidebarState().catch(() => {});
        sendResponse({ ok: true, message: `已恢复 ${restored} 处内容。` });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
    }

    if (message?.type === "NAS_SHOW_SELECTION_TRANSLATION") {
      showSelectionTranslation(message.payload);
      sendResponse({ ok: true, message: "已显示提示。" });
    }

    return false;
  });

  async function initSidebar() {
    if (window.top !== window.self) {
      return;
    }

    if (state.sidebar?.root?.isConnected) {
      return;
    }

    const existing = document.querySelector(".nas-translation-sidebar");
    if (existing) {
      existing.remove();
    }

    const sidebar = document.createElement("div");
    sidebar.className = "nas-translation-sidebar";
    sidebar.style.cssText = [
      "position:fixed",
      "right:18px",
      "top:50%",
      "transform:translateY(-50%)",
      "z-index:2147483647",
      "display:flex",
      "flex-direction:column",
      "gap:10px",
      "padding:10px",
      "border-radius:16px",
      "background:rgba(248,244,236,0.96)",
      "box-shadow:0 10px 28px rgba(0,0,0,0.18)",
      "border:1px solid rgba(24,49,38,0.08)",
      "font:12px/1.2 sans-serif"
    ].join(";");

    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.style.cssText = buttonStyle("#1f7a57", "#fff");
    actionButton.textContent = "翻译整页";
    actionButton.dataset.labelIdle = "翻译整页";
    actionButton.dataset.labelBusy = "处理中";

    const modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.style.cssText = buttonStyle("#d9e7df", "#183126");
    modeButton.textContent = "模式：对比";

    actionButton.addEventListener("click", async () => {
      setButtonBusy(actionButton, true);
      try {
        const response = await chrome.runtime.sendMessage({ type: "NAS_TOGGLE_PAGE_TRANSLATION" });
        if (!response?.ok) {
          throw new Error(response?.error || "操作失败。");
        }
        await refreshSidebarState();
      } catch (error) {
        showSelectionTranslation({
          sourceText: "操作失败",
          translatedText: "",
          error: error.message || String(error)
        });
      } finally {
        setButtonBusy(actionButton, false);
      }
    });

    modeButton.addEventListener("click", async () => {
      modeButton.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: "NAS_TOGGLE_RENDER_MODE" });
        if (!response?.ok) {
          throw new Error(response?.error || "切换模式失败。");
        }
        await refreshSidebarState();
      } catch (error) {
        showSelectionTranslation({
          sourceText: "模式切换失败",
          translatedText: "",
          error: error.message || String(error)
        });
      } finally {
        modeButton.disabled = false;
      }
    });

    sidebar.appendChild(actionButton);
    sidebar.appendChild(modeButton);
    document.documentElement.appendChild(sidebar);
    state.sidebar = { root: sidebar, actionButton, modeButton };
    await refreshSidebarState();
  }

  async function refreshSidebarState() {
    if (!state.sidebar) {
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "NAS_GET_TAB_STATE" });
    if (!response?.ok) {
      return;
    }

    state.sidebar.actionButton.dataset.labelIdle = response.translated ? "显示原文" : "翻译整页";
    if (state.sidebar.actionButton.dataset.busy !== "true") {
      state.sidebar.actionButton.textContent = state.sidebar.actionButton.dataset.labelIdle;
    }
    state.sidebar.modeButton.textContent = response.renderMode === "compare" ? "模式：对比" : "模式：覆盖";
  }

  function buttonStyle(background, color) {
    return [
      "min-width:88px",
      "padding:10px 12px",
      "border:0",
      "border-radius:999px",
      `background:${background}`,
      `color:${color}`,
      "cursor:pointer",
      "font:600 12px/1 sans-serif",
      "white-space:nowrap",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "gap:8px",
      "transition:opacity 160ms ease, transform 160ms ease, filter 160ms ease"
    ].join(";");
  }

  function setButtonBusy(button, busy) {
    button.disabled = busy;
    button.dataset.busy = busy ? "true" : "false";
    button.style.opacity = busy ? "0.72" : "1";
    button.style.filter = busy ? "grayscale(0.08)" : "none";
    button.style.cursor = busy ? "wait" : "pointer";

    if (busy) {
      button.textContent = `${button.dataset.labelBusy || "处理中"} ·`;
      startButtonSpinner(button);
      return;
    }

    stopButtonSpinner(button);
    button.textContent = button.dataset.labelIdle || "翻译整页";
  }

  function startButtonSpinner(button) {
    stopButtonSpinner(button);
    let frame = 0;
    const frames = ["·", "··", "···"];
    button.dataset.spinnerId = String(window.setInterval(() => {
      frame = (frame + 1) % frames.length;
      button.textContent = `${button.dataset.labelBusy || "处理中"} ${frames[frame]}`;
    }, 220));
  }

  function stopButtonSpinner(button) {
    const spinnerId = Number(button.dataset.spinnerId || 0);
    if (spinnerId) {
      window.clearInterval(spinnerId);
    }
    delete button.dataset.spinnerId;
  }

  async function translatePage(options) {
    if (state.translating) {
      throw new Error("当前页面正在翻译中。");
    }

    state.translating = true;
    const translationContext = buildTranslationContext(options);
    if (options.renderMode === "compare") {
      try {
        return await translateCompareMode(options, translationContext);
      } finally {
        state.translating = false;
      }
    }

    clearCompareArtifacts();

    const nodeBudget = Math.max(1, Math.floor(options.maxNodes * 0.75));
    const attrBudget = Math.max(20, options.maxNodes - nodeBudget);
    const nodes = collectTextNodes(document.body, nodeBudget, options.targetLang, {
      visibleOnly: true,
      translationContext
    });
    const attributes = collectAttributeTargets(document.body, attrBudget, options.targetLang, {
      visibleOnly: true,
      translationContext
    });
    const totalTargets = nodes.length + attributes.length;

    if (totalTargets === 0) {
      state.translating = false;
      return "当前页面没有找到需要翻译的文本。";
    }

    const cache = new Map();

    try {
      let completed = 0;
      await runWithConcurrency(nodes, 4, async (node) => {
        const sourceText = normalizeText(node.nodeValue);
        if (!sourceText) {
          completed += 1;
          return;
        }

        let translated = cache.get(sourceText);
        if (!translated) {
          translated = await translateText(sourceText, options);
          cache.set(sourceText, translated);
        }

        if (!state.originals.has(node)) {
          state.originals.set(node, node.nodeValue);
        }

        node.nodeValue = preserveWhitespace(node.nodeValue, translated);
        state.translatedNodes.add(node);

        completed += 1;
      });

      await runWithConcurrency(attributes, 4, async (target) => {
        const sourceText = normalizeText(target.element.getAttribute(target.attribute));
        if (!sourceText) {
          completed += 1;
          return;
        }

        let translated = cache.get(sourceText);
        if (!translated) {
          translated = await translateText(sourceText, options);
          cache.set(sourceText, translated);
        }

        state.translatedAttributes.push({
          element: target.element,
          attribute: target.attribute,
          original: target.element.getAttribute(target.attribute)
        });
        target.element.setAttribute(target.attribute, translated);

        completed += 1;
      });
    } finally {
      state.translating = false;
    }

    enableLiveTranslation(options);
    refreshSidebarState().catch(() => {});
    return `已翻译 ${nodes.length} 个文本节点和 ${attributes.length} 个属性。`;
  }

  async function translateCompareMode(options, translationContext) {
    const roots = collectCompareRoots(document.body, options.maxTargets, options.targetLang, translationContext);
    if (roots.length === 0) {
      return "当前页面没有找到需要翻译的内容块。";
    }

    const cache = new Map();
    let translatedBlocks = 0;

    await runWithConcurrency(roots, 3, async (root) => {
      const compareBlock = await buildCompareBlock(root, options, cache, translationContext);
      if (!compareBlock) {
        return;
      }

      insertOrReplaceCompareBlock(root, compareBlock);
      translatedBlocks += 1;
    });

    enableLiveTranslation(options);
    refreshSidebarState().catch(() => {});
    return `已翻译 ${translatedBlocks} 个内容块。`;
  }

  function restorePage() {
    disableLiveTranslation();
    let count = 0;
    for (const node of Array.from(state.translatedNodes)) {
      if (!node?.isConnected) {
        state.translatedNodes.delete(node);
        continue;
      }

      const original = state.originals.get(node);
      if (typeof original === "string") {
        node.nodeValue = original;
        count += 1;
      }
      state.translatedNodes.delete(node);
    }

    count += clearCompareArtifacts();

    return count;
  }

  function clearCompareArtifacts() {
    let count = 0;

    for (const target of state.translatedAttributes.splice(0)) {
      if (!target.element?.isConnected) {
        continue;
      }
      target.element.setAttribute(target.attribute, target.original);
      count += 1;
    }

    for (const entry of state.compareBlocks.splice(0)) {
      const block = entry?.block || entry;
      if (block?.isConnected) {
        block.remove();
        count += 1;
      }
    }

    for (const block of document.querySelectorAll(".nas-translation-compare-block, .nas-translation-compare-inline")) {
      if (!block.isConnected) {
        continue;
      }
      block.remove();
      count += 1;
    }

    state.compareBlockByRoot = new WeakMap();
    return count;
  }

  function collectTextNodes(root, maxNodes, targetLang, options = {}) {
    if (!root) {
      return [];
    }

    const visibleOnly = options.visibleOnly !== false;
    const translationContext = options.translationContext || buildTranslationContext();

    const ignoredTags = new Set([
      "SCRIPT",
      "STYLE",
      "NOSCRIPT",
      "TEXTAREA",
      "INPUT",
      "SELECT",
      "OPTION",
      "CODE",
      "PRE"
    ]);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_REJECT;
        }
        if (ignoredTags.has(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.isContentEditable) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest(".nas-translation-compare-block, .nas-translation-compare-inline")) {
          return NodeFilter.FILTER_REJECT;
        }
        if (visibleOnly && (!parent.checkVisibility || !parent.checkVisibility())) {
          return NodeFilter.FILTER_REJECT;
        }

        const text = normalizeText(node.nodeValue);
        if (!text || text.length < 2) {
          return NodeFilter.FILTER_REJECT;
        }

        if (shouldSkipNode(parent, text, targetLang, translationContext)) {
          debugTranslation("skip-node", {
            tagName: parent.tagName,
            text
          });
          return NodeFilter.FILTER_REJECT;
        }

        debugTranslation("accept-node", {
          tagName: parent.tagName,
          text
        });
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
      if (nodes.length >= maxNodes) {
        break;
      }
    }
    return nodes;
  }

  function collectAttributeTargets(root, maxTargets, targetLang, options = {}) {
    const visibleOnly = options.visibleOnly !== false;
    const translationContext = options.translationContext || buildTranslationContext();
    const selector = [
      "[title]",
      "[aria-label]",
      "img[alt]",
      "input[placeholder]",
      "textarea[placeholder]",
      "input[type='button'][value]",
      "input[type='submit'][value]"
    ].join(",");

    const targets = [];
    for (const element of root.querySelectorAll(selector)) {
      if (targets.length >= maxTargets) {
        break;
      }
      if (element.closest(".nas-translation-compare-block, .nas-translation-compare-inline")) {
        continue;
      }
      if (visibleOnly && element.checkVisibility && !element.checkVisibility()) {
        continue;
      }

      for (const attribute of candidateAttributesForElement(element)) {
        const value = normalizeText(element.getAttribute(attribute));
        if (!value || value.length < 2) {
          continue;
        }
        if (shouldSkipAttribute(element, attribute, value, targetLang, translationContext)) {
          continue;
        }
        targets.push({ element, attribute });
        if (targets.length >= maxTargets) {
          break;
        }
      }
    }

    return targets;
  }

  function collectCompareRoots(root, maxRoots, targetLang, translationContext) {
    const textNodes = collectTextNodes(root, Math.max(maxRoots * 4, maxRoots), targetLang, {
      translationContext
    });
    const roots = [];
    const seen = new Set();

    for (const node of textNodes) {
      const candidate = findCompareRoot(node.parentElement);
      if (!candidate || seen.has(candidate)) {
        continue;
      }

      if (roots.some((rootElement) => rootElement.contains(candidate) || candidate.contains(rootElement))) {
        continue;
      }

      seen.add(candidate);
      roots.push(candidate);

      if (roots.length >= maxRoots) {
        break;
      }
    }

    return roots;
  }

  function findCompareRoot(startElement) {
    let current = startElement;
    while (current && current !== document.body) {
      if (isCompareRootElement(current)) {
        return current;
      }
      current = current.parentElement;
    }
    return startElement;
  }

  function isCompareRootElement(element) {
    const tagName = element.tagName;
    if (!tagName) {
      return false;
    }

    if ([
      "P", "LI", "ARTICLE", "SECTION", "ASIDE", "MAIN", "DIV", "BLOCKQUOTE",
      "FIGCAPTION", "TD", "TH", "DD", "DT", "H1", "H2", "H3", "H4", "H5", "H6",
      "BUTTON"
    ].includes(tagName)) {
      return true;
    }

    const style = window.getComputedStyle(element);
    return ["block", "list-item", "table-cell", "flex", "grid"].includes(style.display);
  }

  async function buildCompareBlock(sourceRoot, options, cache, translationContext) {
    const clone = sourceRoot.cloneNode(true);
    sanitizeCompareClone(clone);

    const textNodes = collectTextNodes(clone, Number.MAX_SAFE_INTEGER, options.targetLang, {
      visibleOnly: false,
      translationContext
    });
    const attributes = collectAttributeTargets(clone, Number.MAX_SAFE_INTEGER, options.targetLang, {
      visibleOnly: false,
      translationContext
    });

    let translatedCount = 0;

    await runWithConcurrency(textNodes, 4, async (node) => {
      const sourceText = normalizeText(node.nodeValue);
      if (!sourceText) {
        return;
      }

      let translated = cache.get(sourceText);
      if (!translated) {
        translated = await translateText(sourceText, options);
        cache.set(sourceText, translated);
      }

      node.nodeValue = preserveWhitespace(node.nodeValue, translated);
      translatedCount += 1;
    });

    await runWithConcurrency(attributes, 4, async (target) => {
      const sourceText = normalizeText(target.element.getAttribute(target.attribute));
      if (!sourceText) {
        return;
      }

      let translated = cache.get(sourceText);
      if (!translated) {
        translated = await translateText(sourceText, options);
        cache.set(sourceText, translated);
      }

      target.element.setAttribute(target.attribute, translated);
      translatedCount += 1;
    });

    if (translatedCount === 0) {
      return null;
    }

    const sourceStyle = window.getComputedStyle(sourceRoot);
    if (isInlineCompareElement(sourceRoot, sourceStyle)) {
      return buildInlineCompareNode(clone, sourceRoot, sourceStyle);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "nas-translation-compare-block";
    wrapper.style.cssText = [
      "display:block",
      "width:100%",
      "margin-top:0.45em",
      "padding:0",
      "border:0",
      "background:transparent",
      "box-shadow:none",
      "box-sizing:border-box",
      "max-width:100%",
      "overflow:visible"
    ].join(";");

    clone.style.maxWidth = "100%";
    clone.style.overflow = "visible";
    clone.style.opacity = "0.96";
    clone.style.filter = "none";
    clone.style.marginTop = "0";
    clone.style.font = sourceStyle.font;
    clone.style.lineHeight = sourceStyle.lineHeight;
    clone.style.letterSpacing = sourceStyle.letterSpacing;
    clone.style.wordSpacing = sourceStyle.wordSpacing;
    clone.style.textAlign = sourceStyle.textAlign;
    clone.style.color = sourceStyle.color;

    wrapper.appendChild(clone);
    return wrapper;
  }

  function insertOrReplaceCompareBlock(root, compareBlock) {
    const existing = state.compareBlockByRoot.get(root);
    if (existing?.isConnected) {
      existing.replaceWith(compareBlock);
      const index = state.compareBlocks.findIndex((entry) => entry.root === root);
      if (index >= 0) {
        state.compareBlocks[index] = { root, block: compareBlock };
      }
    } else {
      root.insertAdjacentElement("afterend", compareBlock);
      state.compareBlocks.push({ root, block: compareBlock });
    }

    state.compareBlockByRoot.set(root, compareBlock);
  }

  function isInlineCompareElement(element, sourceStyle = window.getComputedStyle(element)) {
    const display = sourceStyle.display;
    if (["inline", "inline-block", "inline-flex", "inline-grid"].includes(display)) {
      return true;
    }

    return ["A", "SPAN", "STRONG", "EM", "B", "I", "SMALL", "LABEL", "CODE"].includes(element.tagName || "");
  }

  function buildInlineCompareNode(clone, sourceRoot, sourceStyle) {
    const wrapper = document.createElement("span");
    wrapper.className = "nas-translation-compare-inline";
    wrapper.style.cssText = [
      "display:inline",
      "margin-left:0.35em",
      "padding:0",
      "border:0",
      "background:transparent",
      "box-shadow:none",
      "max-width:none",
      "overflow:visible",
      "white-space:normal",
      "overflow-wrap:anywhere",
      "word-break:break-word",
      "vertical-align:baseline"
    ].join(";");

    clone.style.display = "inline";
    clone.style.maxWidth = "none";
    clone.style.overflow = "visible";
    clone.style.whiteSpace = "normal";
    clone.style.overflowWrap = "anywhere";
    clone.style.wordBreak = "break-word";
    clone.style.verticalAlign = "baseline";
    clone.style.opacity = "0.9";
    clone.style.font = sourceStyle.font;
    clone.style.lineHeight = sourceStyle.lineHeight;
    clone.style.letterSpacing = sourceStyle.letterSpacing;
    clone.style.wordSpacing = sourceStyle.wordSpacing;
    clone.style.textAlign = sourceStyle.textAlign;
    clone.style.color = sourceStyle.color;

    wrapper.appendChild(clone);
    return wrapper;
  }

  function sanitizeCompareClone(root) {
    for (const element of root.querySelectorAll("script, style, noscript")) {
      element.remove();
    }
    for (const element of root.querySelectorAll("*")) {
      element.removeAttribute("id");
      element.removeAttribute("for");
    }
  }

  async function translateText(text, options) {
    const segments = splitIntoSegments(text, options).flatMap((segment) => {
      if (segment.type !== "text") {
        return [segment];
      }
      return splitSymbolAwareSegments(segment.value);
    });
    const translatedParts = [];

    debugTranslation("translate-text", {
      text,
      segments
    });

    for (const segment of segments) {
      if (segment.type === "protected") {
        translatedParts.push(segment.value);
        continue;
      }

      if (!segment.value.trim()) {
        translatedParts.push(segment.value);
        continue;
      }

      if (!shouldTranslateChunk(segment.value)) {
        translatedParts.push(segment.value);
        continue;
      }

      if (isLikelyTargetLanguageText(segment.value, options.targetLang)) {
        translatedParts.push(segment.value);
        continue;
      }

      translatedParts.push(await translateSegment(segment.value, options));
    }

    return translatedParts.join("");
  }

  function enableLiveTranslation(options) {
    state.liveTranslateEnabled = true;
    state.liveOptions = { ...(options || {}) };

    if (state.liveObserver) {
      return;
    }

    state.liveObserver = new MutationObserver((mutations) => {
      if (!state.liveTranslateEnabled || state.observerMuted) {
        return;
      }

      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            queueLiveRoot(node);
          }
        } else if (mutation.type === "characterData") {
          if (state.liveOptions?.renderMode === "replace") {
            queueLiveRoot(mutation.target?.parentElement);
          }
        }
      }

      scheduleLiveFlush();
    });

    if (document.body) {
      state.liveObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  function disableLiveTranslation() {
    state.liveTranslateEnabled = false;
    state.liveOptions = null;
    state.livePendingRoots.clear();
    if (state.liveFlushTimer) {
      window.clearTimeout(state.liveFlushTimer);
      state.liveFlushTimer = null;
    }
    if (state.liveObserver) {
      state.liveObserver.disconnect();
      state.liveObserver = null;
    }
  }

  function queueLiveRoot(node) {
    const root = normalizeLiveRoot(node);
    if (!root) {
      return;
    }

    state.livePendingRoots.add(root);
  }

  function normalizeLiveRoot(node) {
    if (!node) {
      return null;
    }

    let element = null;
    if (node.nodeType === Node.TEXT_NODE) {
      element = node.parentElement;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      element = node;
    }

    if (!element || !element.isConnected) {
      return null;
    }

    if (element.closest(".nas-translation-sidebar, .nas-translation-compare-block, .nas-translation-compare-inline")) {
      return null;
    }

    return element;
  }

  function scheduleLiveFlush() {
    if (state.liveFlushTimer || !state.livePendingRoots.size) {
      return;
    }

    state.liveFlushTimer = window.setTimeout(() => {
      state.liveFlushTimer = null;
      flushLiveTranslations().catch(() => {});
    }, 350);
  }

  async function flushLiveTranslations() {
    if (!state.liveTranslateEnabled || state.translating || !state.liveOptions) {
      return;
    }

    const roots = Array.from(state.livePendingRoots);
    state.livePendingRoots.clear();
    if (!roots.length) {
      return;
    }

    const options = state.liveOptions;
    const translationContext = buildTranslationContext(options);
    const cache = new Map();

    await withObserverMuted(async () => {
      if (options.renderMode === "compare") {
        for (const root of roots) {
          const compareRoots = collectCompareRoots(root, Math.max(8, options.maxTargets || 20), options.targetLang, translationContext);
          for (const compareRoot of compareRoots) {
            const compareBlock = await buildCompareBlock(compareRoot, options, cache, translationContext);
            if (compareBlock) {
              insertOrReplaceCompareBlock(compareRoot, compareBlock);
            }
          }
        }
        return;
      }

      for (const root of roots) {
        await translateSubtree(root, options, translationContext, cache);
      }
    });
  }

  async function translateSubtree(root, options, translationContext, cache) {
    const nodes = collectTextNodes(root, Math.max(20, options.maxTargets || 200), options.targetLang, {
      visibleOnly: true,
      translationContext
    });
    const attributes = collectAttributeTargets(root, Math.max(10, Math.floor((options.maxTargets || 200) / 4)), options.targetLang, {
      visibleOnly: true,
      translationContext
    });

    for (const node of nodes) {
      const sourceText = normalizeText(node.nodeValue);
      if (!sourceText) {
        continue;
      }

      let translated = cache.get(sourceText);
      if (!translated) {
        translated = await translateText(sourceText, options);
        cache.set(sourceText, translated);
      }

      if (!state.originals.has(node)) {
        state.originals.set(node, node.nodeValue);
      }

      node.nodeValue = preserveWhitespace(node.nodeValue, translated);
      state.translatedNodes.add(node);
    }

    for (const target of attributes) {
      const sourceText = normalizeText(target.element.getAttribute(target.attribute));
      if (!sourceText) {
        continue;
      }

      let translated = cache.get(sourceText);
      if (!translated) {
        translated = await translateText(sourceText, options);
        cache.set(sourceText, translated);
      }

      state.translatedAttributes.push({
        element: target.element,
        attribute: target.attribute,
        original: target.element.getAttribute(target.attribute)
      });
      target.element.setAttribute(target.attribute, translated);
    }
  }

  async function withObserverMuted(work) {
    state.observerMuted = true;
    try {
      await work();
    } finally {
      state.observerMuted = false;
    }
  }

  async function translateSegment(text, options) {
    debugTranslation("translate-segment", { text });
    const wrapped = splitSegmentWrapper(text);
    if (wrapped.core !== text) {
      if (!wrapped.core.trim()) {
        return text;
      }

      const translatedCore = await translateSegmentCore(wrapped.core, options);
      return `${wrapped.leading}${translatedCore}${wrapped.trailing}`;
    }

    return translateSegmentCore(text, options);
  }

  async function translateSegmentCore(text, options) {
    const primaryText = normalizeTranslationInput(text);
    const fallbackText = buildRetryTranslationInput(text);
    let lastError = null;

    try {
      debugTranslation("translate-primary-request", {
        original: text,
        request: primaryText
      });
      const translated = await requestTranslationWithRetry(primaryText, options, {
        retryCount: 1,
        shouldRetryResult: (value) => shouldRetryWithSameInput(text, primaryText, value, options)
      });
      debugTranslation("translate-primary-response", {
        original: text,
        request: primaryText,
        translated,
        cleaned: cleanTranslatedText(translated)
      });
      if (!shouldRetryWithFallback(text, primaryText, translated, fallbackText, options)) {
        return normalizeFinalTranslation(text, translated);
      }
    } catch (error) {
      lastError = error;
    }

    if (fallbackText !== primaryText) {
      try {
        debugTranslation("translate-fallback-request", {
          original: text,
          request: fallbackText
        });
        const translated = await requestTranslationWithRetry(fallbackText, options, {
          retryCount: 1,
          shouldRetryResult: (value) => shouldRetryWithSameInput(text, fallbackText, value, options)
        });
        debugTranslation("translate-fallback-response", {
          original: text,
          request: fallbackText,
          translated,
          cleaned: cleanTranslatedText(translated)
        });
        if (!shouldRetryWithSameInput(text, fallbackText, translated, options)) {
          return normalizeFinalTranslation(text, translated);
        }
      } catch (error) {
        lastError = error;
      }
    }

    const compactFallback = await translateCompactWordByParts(text, options);
    if (compactFallback) {
      debugTranslation("translate-parts-response", {
        original: text,
        translated: compactFallback
      });
      return compactFallback;
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error("翻译请求失败。");
  }

  async function requestTranslationWithRetry(text, options, retryOptions = {}) {
    const retryCount = Number.isFinite(retryOptions.retryCount) ? retryOptions.retryCount : 1;
    const shouldRetryResult =
      typeof retryOptions.shouldRetryResult === "function"
        ? retryOptions.shouldRetryResult
        : null;
    let lastError = null;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        debugTranslation("request-attempt", {
          text,
          attempt
        });
        const response = await chrome.runtime.sendMessage({
          type: "NAS_TRANSLATE_TEXT",
          payload: {
            text,
            serviceUrl: options.serviceUrl,
            sourceLang: options.sourceLang,
            targetLang: options.targetLang
          }
        });

        if (!response?.ok) {
          throw new Error(response?.error || "翻译请求失败。");
        }
        if (typeof response.translatedText !== "string") {
          throw new Error("翻译接口没有返回文本。");
        }

        debugTranslation("request-success", {
          text,
          attempt,
          translated: response.translatedText
        });
        if (shouldRetryResult?.(response.translatedText) && attempt < retryCount) {
          lastError = new Error("翻译结果需要重试。");
          debugTranslation("request-retry-result", {
            text,
            attempt,
            translated: response.translatedText
          });
          continue;
        }

        return response.translatedText;
      } catch (error) {
        lastError = error;
        debugTranslation("request-error", {
          text,
          attempt,
          error: error.message || String(error)
        });
      }
    }

    throw lastError || new Error("翻译请求失败。");
  }

  async function runWithConcurrency(items, concurrency, worker) {
    let index = 0;
    const slots = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const currentIndex = index;
        index += 1;
        await worker(items[currentIndex]);
      }
    });
    await Promise.all(slots);
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function splitSymbolAwareSegments(text) {
    const source = String(text || "");
    const parts = source.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu);

    if (!parts) {
      return [{ type: "text", value: source }];
    }

    return parts.map((part) => ({
      type: shouldTranslateChunk(part) ? "text" : "protected",
      value: part
    }));
  }

  function shouldTranslateChunk(text) {
    const value = String(text || "");
    if (!value.trim()) {
      return false;
    }

    return /[\p{L}]/u.test(value);
  }

  function normalizeTranslationInput(text) {
    return expandCompactTokens(cleanTranslationSourceText(text));
  }

  function splitSegmentWrapper(text) {
    const source = String(text || "");
    const match = source.match(/^([^A-Za-z0-9\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF]*)(.*?)([^A-Za-z0-9\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\uAC00-\uD7AF]*)$/u);

    if (!match) {
      return {
        leading: "",
        core: source,
        trailing: ""
      };
    }

    return {
      leading: match[1] || "",
      core: match[2] || "",
      trailing: match[3] || ""
    };
  }

  function buildRetryTranslationInput(text) {
    return expandCompactTokens(cleanTranslationSourceText(text), true);
  }

  function shouldRetryWithSameInput(original, requestText, translated, options) {
    const cleaned = cleanTranslatedText(translated).trim();
    const normalizedOriginal = original.trim();
    const normalizedRequest = requestText.trim();

    if (!cleaned) {
      return true;
    }

    if (cleaned === normalizedOriginal || cleaned === normalizedRequest) {
      return containsCompactWord(original);
    }

    return !isLikelyTargetLanguageText(cleaned, options.targetLang)
      && containsCompactWord(original);
  }

  function shouldRetryWithFallback(original, requestText, translated, fallbackText, options) {
    if (!fallbackText || fallbackText === requestText) {
      return false;
    }

    return shouldRetryWithSameInput(original, requestText, translated, options);
  }

  function expandCompactTokens(text, aggressive = false) {
    return String(text || "").replace(/\b[A-Za-z0-9]+\b/g, (token) => splitCompactToken(token, aggressive));
  }

  async function translateCompactWordByParts(text, options) {
    const source = String(text || "");
    const tokens = source.match(/[A-Za-z0-9]+|[^A-Za-z0-9]+/g);

    if (!tokens) {
      return "";
    }

    let changed = false;
    const translated = [];

    for (const token of tokens) {
      if (!/^[A-Za-z0-9]+$/.test(token)) {
        translated.push(token);
        continue;
      }

      const splitToken = splitCompactToken(token, true);
      if (splitToken === token) {
        translated.push(token);
        continue;
      }

      const parts = splitToken.split(/\s+/).filter(Boolean);
      const translatedParts = [];

      for (const part of parts) {
        if (!/[A-Za-z]/.test(part)) {
          translatedParts.push(part);
          continue;
        }

        const partTranslated = await requestTranslationWithRetry(part, options, {
          retryCount: 0
        });
        translatedParts.push(normalizeCompactPartTranslation(part, partTranslated, options.targetLang));
      }

      translated.push(joinTranslatedParts(translatedParts, options.targetLang));
      changed = true;
    }

    if (!changed) {
      return "";
    }

    return cleanTranslatedText(translated.join(""));
  }

  function joinTranslatedParts(parts, targetLang) {
    const filtered = parts.filter((part) => part != null && part !== "");
    if (filtered.length === 0) {
      return "";
    }

    if (usesCompactTargetJoin(targetLang)) {
      return filtered.join("");
    }

    return filtered.join(" ");
  }

  function usesCompactTargetJoin(targetLang) {
    const normalizedTarget = String(targetLang || "").toLowerCase();
    return normalizedTarget.startsWith("zho")
      || normalizedTarget.startsWith("jpn")
      || normalizedTarget.startsWith("kor");
  }

  function normalizeCompactPartTranslation(part, translated, targetLang) {
    const glossary = resolveCompactPartGlossary(part, targetLang);
    if (glossary) {
      return glossary;
    }

    const raw = String(translated || "");
    const cleaned = cleanTranslatedText(raw).trim();

    if (!cleaned) {
      return part;
    }

    if (raw.includes("<unk>") && isLikelyProperCompactPart(part)) {
      return part;
    }

    return cleaned;
  }

  function resolveCompactPartGlossary(part, targetLang) {
    const normalizedTarget = String(targetLang || "").toLowerCase();
    if (!normalizedTarget.startsWith("zho")) {
      return "";
    }

    const key = String(part || "").toLowerCase();
    const glossary = {
      bench: "基准",
      benchmark: "基准",
      eval: "评测",
      evaluation: "评测",
      leaderboard: "排行榜",
      score: "得分",
      scorer: "评分器",
      rank: "排名"
    };

    return glossary[key] || "";
  }

  function isLikelyProperCompactPart(part) {
    const value = String(part || "");
    return /^[A-Z][a-z0-9]+$/.test(value)
      || /[A-Z]/.test(value) && /[0-9]/.test(value);
  }

  function containsCompactWord(text) {
    return /\b[A-Za-z0-9]+\b/.test(String(text || ""))
      && String(text || "").split(/\b/).some((part) => splitCompactToken(part, true) !== part);
  }

  function splitCompactToken(token, aggressive = false) {
    if (!/[A-Za-z]/.test(token) || token.length < 4) {
      return token;
    }

    const parts = [];
    let current = token[0];

    for (let index = 1; index < token.length; index += 1) {
      const previous = token[index - 1];
      const char = token[index];
      const next = token[index + 1] || "";
      const shouldSplit =
        (isAsciiLower(previous) && isAsciiUpper(char))
        || (isAsciiUpper(previous) && isAsciiUpper(char) && isAsciiLower(next))
        || (aggressive && isAsciiDigit(previous) && isAsciiLetter(char))
        || (aggressive && isAsciiLetter(previous) && isAsciiDigit(char));

      if (shouldSplit) {
        parts.push(current);
        current = char;
      } else {
        current += char;
      }
    }

    parts.push(current);

    return parts.length >= 2 ? parts.join(" ") : token;
  }

  function isAsciiLetter(char) {
    return /[A-Za-z]/.test(char);
  }

  function isAsciiLower(char) {
    return /[a-z]/.test(char);
  }

  function isAsciiUpper(char) {
    return /[A-Z]/.test(char);
  }

  function isAsciiDigit(char) {
    return /[0-9]/.test(char);
  }

  function shouldSkipNode(parent, text, targetLang, translationContext) {
    const parentText = text.trim();
    const tagName = parent.tagName || "";

    if (["SUMMARY", "TIME"].includes(tagName)) {
      return true;
    }

    if (isLikelyTargetLanguageText(parentText, targetLang)) {
      return true;
    }

    if (matchesSkipWhitelist(parentText, translationContext)) {
      return true;
    }

    return false;
  }

  function isLikelyTargetLanguageText(text, targetLang) {
    const normalizedTarget = String(targetLang || "").toLowerCase();
    const counts = countCharacterGroups(text);
    const meaningfulChars = counts.cjk + counts.latin + counts.kana + counts.hangul;

    if (meaningfulChars < 2) {
      return false;
    }

    if (normalizedTarget.startsWith("zho")) {
      return counts.cjk >= 2 && counts.cjk >= counts.latin;
    }

    if (normalizedTarget.startsWith("jpn")) {
      return (counts.cjk + counts.kana) >= 2 && (counts.cjk + counts.kana) >= counts.latin;
    }

    if (normalizedTarget.startsWith("kor")) {
      return counts.hangul >= 2 && counts.hangul >= counts.latin;
    }

    if (normalizedTarget.startsWith("eng")) {
      return counts.latin >= 3 && counts.latin >= (counts.cjk + counts.kana + counts.hangul) * 2;
    }

    return false;
  }

  function isNaturalLanguageCompound(text) {
    const trimmed = text.trim();
    if (!/^[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)+$/.test(trimmed)) {
      return false;
    }

    const parts = trimmed.split(/[-/]/);
    return parts.length >= 2
      && parts.every(isTranslatableCompoundPart)
      && parts.filter((part) => /[A-Za-z]/.test(part)).length >= 2;
  }

  function isTranslatableCompoundPart(part) {
    const value = String(part || "");
    if (!value) {
      return false;
    }

    if (!/[A-Za-z]/.test(value)) {
      return false;
    }

    if (value.length >= 2) {
      return true;
    }

    return /^[A-Za-z]$/.test(value);
  }

  function candidateAttributesForElement(element) {
    const attrs = [];
    for (const name of ["title", "aria-label", "alt", "placeholder", "value"]) {
      if (element.hasAttribute(name)) {
        attrs.push(name);
      }
    }
    return attrs;
  }

  function shouldSkipAttribute(element, attribute, text, targetLang, translationContext) {
    if (isLikelyTargetLanguageText(text, targetLang)) {
      return true;
    }
    if (matchesSkipWhitelist(text, translationContext)) {
      return true;
    }
    if (attribute === "value" && text.length > 40) {
      return true;
    }
    return false;
  }

  function countCharacterGroups(text) {
    let cjk = 0;
    let latin = 0;
    let kana = 0;
    let hangul = 0;

    for (const char of text) {
      if (/[\u4E00-\u9FFF\u3400-\u4DBF]/u.test(char)) {
        cjk += 1;
      } else if (/[A-Za-z]/.test(char)) {
        latin += 1;
      } else if (/[\u3040-\u30FF]/u.test(char)) {
        kana += 1;
      } else if (/[\uAC00-\uD7AF]/u.test(char)) {
        hangul += 1;
      }
    }

    return { cjk, latin, kana, hangul };
  }

  function splitIntoSegments(text, options) {
    const translationContext = buildTranslationContext(options);
    const patterns = [
      /\bhttps?:\/\/[^\s]+/g,
      /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
      /\b(?:[A-Z][a-z0-9]+){2,}\b/g,
      /\b[A-Z]{2,}(?:[0-9]+)?\b/g,
      /\b[a-z0-9]+(?:[_/][a-z0-9]+)+\b/gi,
      /\b(?:v?\d+\.\d+(?:\.\d+){0,3})\b/g,
      /\b[A-Za-z]:\\[^\s]+/g,
      /\b\/[A-Za-z0-9._/-]+\b/g,
      /\b[a-z]+(?:\.[a-z0-9-]+){1,}\b/gi,
      /<[^>\n]+>/g
    ];

    const matches = [];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        if (match.index == null) {
          continue;
        }
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          value: match[0]
        });
      }
    }

    matches.sort((a, b) => a.start - b.start || b.end - a.end);

    const merged = [];
    for (const match of matches) {
      if (shouldTranslateProtectedMatch(match.value)) {
        continue;
      }

      if (isNaturalLanguageCompound(match.value)) {
        continue;
      }

      if (!matchesSkipWhitelist(match.value, translationContext)) {
        continue;
      }

      const last = merged[merged.length - 1];
      if (!last || match.start >= last.end) {
        merged.push(match);
      } else if (match.end > last.end) {
        last.end = match.end;
        last.value = text.slice(last.start, last.end);
      }
    }

    const segments = [];
    let cursor = 0;
    for (const match of merged) {
      if (cursor < match.start) {
        segments.push({
          type: "text",
          value: text.slice(cursor, match.start)
        });
      }
      segments.push({
        type: "protected",
        value: match.value
      });
      cursor = match.end;
    }

    if (cursor < text.length) {
      segments.push({
        type: "text",
        value: text.slice(cursor)
      });
    }

    return segments.length > 0 ? segments : [{ type: "text", value: text }];
  }

  function shouldTranslateProtectedMatch(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      return false;
    }

    const slashStripped = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    if (
      slashStripped
      && /^[A-Za-z0-9]+$/.test(slashStripped)
      && (isCompactWordCandidate(slashStripped) || isCompactAlphaNumericCandidate(slashStripped))
    ) {
      return true;
    }

    return isCompactWordCandidate(trimmed)
      || (/^[A-Za-z0-9]+$/.test(trimmed) && isCompactAlphaNumericCandidate(trimmed));
  }

  function isCompactWordCandidate(text) {
    return /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+$/.test(text);
  }

  function isCompactAlphaNumericCandidate(text) {
    return /[A-Za-z]/.test(text)
      && /[0-9]/.test(text)
      && splitCompactToken(text, true) !== text;
  }

  function cleanTranslatedText(text) {
    return String(text || "")
      .replace(/<\/?s>|<pad>|<unk>|<mask>/g, " ")
      .replace(/\b[a-z]{3}_[A-Za-z]{4}\b/g, " ")
      .replace(/▁/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function normalizeFinalTranslation(sourceText, translated) {
    const cleaned = cleanTranslatedText(translated);
    if (cleaned) {
      return cleaned;
    }

    if (shouldPreserveSourceToken(sourceText)) {
      return sourceText;
    }

    return cleaned;
  }

  function shouldPreserveSourceToken(text) {
    const value = String(text || "").trim();
    if (!value) {
      return false;
    }

    return /^[A-Z]{2,8}$/.test(value)
      || /^[A-Z0-9]{2,12}$/.test(value)
      || /^[A-Za-z]{1,4}[0-9]{1,4}[A-Za-z0-9]*$/.test(value);
  }

  function preserveWhitespace(original, translated) {
    const leading = original.match(/^\s*/)?.[0] || "";
    const trailing = original.match(/\s*$/)?.[0] || "";
    return `${leading}${translated}${trailing}`;
  }

  function cleanTranslationSourceText(text) {
    return String(text || "")
      .replace(/[|*~^`]+/g, " ")
      .replace(/[_]+/g, " ")
      .replace(/([A-Za-z0-9])[-/]+([A-Za-z0-9])/g, "$1 $2")
      .replace(/[()[\]{}<>«»“”"'‘’]+/g, " ")
      .replace(/[,:;!?]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function buildTranslationContext(options = {}) {
    return {
      customSkipRules: compileCustomSkipRules(options.customSkipPatterns || "")
    };
  }

  function matchesSkipWhitelist(text, translationContext) {
    const value = String(text || "").trim();
    if (!value) {
      return false;
    }

    for (const rule of BUILTIN_SKIP_RULES) {
      if (rule.test(value)) {
        debugTranslation("skip-whitelist", { text: value, rule: rule.name });
        return true;
      }
    }

    for (const rule of translationContext?.customSkipRules || []) {
      if (rule.test(value)) {
        debugTranslation("skip-custom-whitelist", { text: value, rule: rule.label });
        return true;
      }
    }

    return false;
  }

  function compileCustomSkipRules(raw) {
    const rules = [];
    for (const line of String(raw || "").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const regexRule = parseCustomRegexRule(trimmed);
      if (regexRule) {
        rules.push(regexRule);
        continue;
      }

      rules.push({
        label: `exact:${trimmed}`,
        test: (text) => text === trimmed
      });
    }

    return rules;
  }

  function parseCustomRegexRule(text) {
    const match = text.match(/^\/(.+)\/([a-z]*)$/i);
    if (!match) {
      return null;
    }

    try {
      const regex = new RegExp(match[1], match[2]);
      return {
        label: `regex:${text}`,
        test: (value) => regex.test(value)
      };
    } catch (_error) {
      return null;
    }
  }

  function debugTranslation(event, payload) {
    if (!DEBUG_TRANSLATION) {
      return;
    }

    const text = typeof payload?.text === "string"
      ? payload.text
      : typeof payload?.original === "string"
        ? payload.original
        : typeof payload?.request === "string"
          ? payload.request
          : "";

    if (!isInterestingDebugText(text)) {
      return;
    }

    console.log("[NAS debug]", event, payload);
  }

  function isInterestingDebugText(text) {
    const value = String(text || "");
    return /^[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)+$/.test(value)
      || /[A-Za-z]+[0-9]+[A-Za-z]+/.test(value)
      || /[A-Za-z]+(?:[-/][A-Za-z0-9]+)+/.test(value);
  }

  function showSelectionTranslation(payload) {
    if (state.selectionCard?.parentNode) {
      state.selectionCard.parentNode.removeChild(state.selectionCard);
    }

    const card = document.createElement("div");
    card.style.cssText = [
      "position:fixed",
      "right:16px",
      "top:16px",
      "z-index:2147483647",
      "width:min(420px, calc(100vw - 32px))",
      "padding:14px 16px",
      "border-radius:16px",
      "background:rgba(248,244,236,0.98)",
      "color:#1f2a24",
      "box-shadow:0 18px 48px rgba(0,0,0,0.22)",
      "border:1px solid rgba(24,49,38,0.12)",
      "font:13px/1.5 sans-serif"
    ].join(";");

    const title = document.createElement("div");
    title.textContent = payload.error ? "翻译失败" : "翻译为中文";
    title.style.cssText = "font-weight:700;margin-bottom:8px;";

    const source = document.createElement("div");
    source.textContent = payload.sourceText || "";
    source.style.cssText = "color:#54645d;margin-bottom:10px;";

    const translated = document.createElement("div");
    translated.textContent = payload.error || payload.translatedText || "";
    translated.style.cssText = payload.error
      ? "color:#a12626;font-weight:600;"
      : "font-size:15px;font-weight:600;";

    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭";
    close.style.cssText = [
      "margin-top:12px",
      "padding:8px 12px",
      "border:0",
      "border-radius:999px",
      "background:#1f7a57",
      "color:#fff",
      "cursor:pointer"
    ].join(";");
    close.addEventListener("click", () => {
      if (card.parentNode) {
        card.parentNode.removeChild(card);
      }
      if (state.selectionCard === card) {
        state.selectionCard = null;
      }
    });

    card.appendChild(title);
    card.appendChild(source);
    card.appendChild(translated);
    card.appendChild(close);
    document.documentElement.appendChild(card);
    state.selectionCard = card;
  }
})();
