(function () {
  const state = {
    translating: false,
    originals: new WeakMap(),
    translatedNodes: new Set(),
    translatedAttributes: [],
    compareBlocks: [],
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

    const modeButton = document.createElement("button");
    modeButton.type = "button";
    modeButton.style.cssText = buttonStyle("#d9e7df", "#183126");
    modeButton.textContent = "模式：对比";

    actionButton.addEventListener("click", async () => {
      actionButton.disabled = true;
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
        actionButton.disabled = false;
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

    state.sidebar.actionButton.textContent = response.translated ? "显示原文" : "翻译整页";
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
      "white-space:nowrap"
    ].join(";");
  }

  async function translatePage(options) {
    if (state.translating) {
      throw new Error("当前页面正在翻译中。");
    }

    state.translating = true;
    if (options.renderMode === "compare") {
      try {
        return await translateCompareMode(options);
      } finally {
        state.translating = false;
      }
    }

    const nodeBudget = Math.max(1, Math.floor(options.maxNodes * 0.75));
    const attrBudget = Math.max(20, options.maxNodes - nodeBudget);
    const nodes = collectTextNodes(document.body, nodeBudget, options.targetLang, { visibleOnly: true });
    const attributes = collectAttributeTargets(document.body, attrBudget, options.targetLang, { visibleOnly: true });
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

    refreshSidebarState().catch(() => {});
    return `已翻译 ${nodes.length} 个文本节点和 ${attributes.length} 个属性。`;
  }

  async function translateCompareMode(options) {
    const roots = collectCompareRoots(document.body, options.maxTargets, options.targetLang);
    if (roots.length === 0) {
      return "当前页面没有找到需要翻译的内容块。";
    }

    const cache = new Map();
    let translatedBlocks = 0;

    await runWithConcurrency(roots, 3, async (root) => {
      const compareBlock = await buildCompareBlock(root, options, cache);
      if (!compareBlock) {
        return;
      }

      root.insertAdjacentElement("afterend", compareBlock);
      state.compareBlocks.push(compareBlock);
      translatedBlocks += 1;
    });

    refreshSidebarState().catch(() => {});
    return `已翻译 ${translatedBlocks} 个内容块。`;
  }

  function restorePage() {
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

    for (const target of state.translatedAttributes.splice(0)) {
      if (!target.element?.isConnected) {
        continue;
      }
      target.element.setAttribute(target.attribute, target.original);
      count += 1;
    }

    for (const block of state.compareBlocks.splice(0)) {
      if (block?.isConnected) {
        block.remove();
        count += 1;
      }
    }

    return count;
  }

  function collectTextNodes(root, maxNodes, targetLang, options = {}) {
    if (!root) {
      return [];
    }

    const visibleOnly = options.visibleOnly !== false;

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
        if (visibleOnly && (!parent.checkVisibility || !parent.checkVisibility())) {
          return NodeFilter.FILTER_REJECT;
        }

        const text = normalizeText(node.nodeValue);
        if (!text || text.length < 2) {
          return NodeFilter.FILTER_REJECT;
        }

        if (shouldSkipNode(parent, text, targetLang)) {
          return NodeFilter.FILTER_REJECT;
        }

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
      if (visibleOnly && element.checkVisibility && !element.checkVisibility()) {
        continue;
      }

      for (const attribute of candidateAttributesForElement(element)) {
        const value = normalizeText(element.getAttribute(attribute));
        if (!value || value.length < 2) {
          continue;
        }
        if (shouldSkipAttribute(element, attribute, value, targetLang)) {
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

  function collectCompareRoots(root, maxRoots, targetLang) {
    const textNodes = collectTextNodes(root, Math.max(maxRoots * 4, maxRoots), targetLang);
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
      "A", "BUTTON"
    ].includes(tagName)) {
      return true;
    }

    const style = window.getComputedStyle(element);
    return ["block", "list-item", "table-cell", "flex", "grid"].includes(style.display);
  }

  async function buildCompareBlock(sourceRoot, options, cache) {
    const clone = sourceRoot.cloneNode(true);
    sanitizeCompareClone(clone);

    const textNodes = collectTextNodes(clone, Number.MAX_SAFE_INTEGER, options.targetLang, { visibleOnly: false });
    const attributes = collectAttributeTargets(clone, Number.MAX_SAFE_INTEGER, options.targetLang, { visibleOnly: false });

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

    const wrapper = document.createElement("div");
    wrapper.className = "nas-translation-compare-block";
    const sourceStyle = window.getComputedStyle(sourceRoot);
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
    const segments = splitIntoSegments(text);
    const translatedParts = [];

    for (const segment of segments) {
      if (segment.type === "protected") {
        translatedParts.push(segment.value);
        continue;
      }

      if (!segment.value.trim()) {
        translatedParts.push(segment.value);
        continue;
      }

      if (isLikelyTargetLanguageText(segment.value, options.targetLang)) {
        translatedParts.push(segment.value);
        continue;
      }

      const response = await chrome.runtime.sendMessage({
        type: "NAS_TRANSLATE_TEXT",
        payload: {
          text: segment.value,
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

      translatedParts.push(cleanTranslatedText(response.translatedText));
    }

    return translatedParts.join("");
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

  function shouldSkipNode(parent, text, targetLang) {
    const parentText = text.trim();
    const tagName = parent.tagName || "";

    if (["SUMMARY", "TIME"].includes(tagName)) {
      return true;
    }

    if (isLikelyTargetLanguageText(parentText, targetLang)) {
      return true;
    }

    if (isLikelyHtmlLikeToken(parentText) || isLikelyCodeLikeToken(parentText)) {
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

  function isLikelyHtmlLikeToken(text) {
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      return false;
    }

    return /^<\/?[a-z][a-z0-9-]*[^>]*>$/i.test(trimmed)
      || /^&[a-z0-9#]+;$/i.test(trimmed);
  }

  function isLikelyCodeLikeToken(text) {
    const trimmed = text.trim();
    if (trimmed.length > 80 || trimmed.length < 2) {
      return false;
    }

    if (/^(https?:\/\/|www\.|\/[A-Za-z0-9._/-]+|[A-Za-z]:\\)/.test(trimmed)) {
      return true;
    }

    if (/^[A-Za-z0-9._:+/#-]+$/.test(trimmed)) {
      return /[_/#:+.-]/.test(trimmed) || /[A-Z]{2,}/.test(trimmed);
    }

    return false;
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

  function shouldSkipAttribute(element, attribute, text, targetLang) {
    if (isLikelyTargetLanguageText(text, targetLang)) {
      return true;
    }
    if (isLikelyHtmlLikeToken(text) || isLikelyCodeLikeToken(text)) {
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

  function splitIntoSegments(text) {
    const patterns = [
      /\bhttps?:\/\/[^\s]+/g,
      /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,
      /\b(?:[A-Z][a-z0-9]+){2,}\b/g,
      /\b[A-Z]{2,}(?:[0-9]+)?\b/g,
      /\b[a-z0-9]+(?:[_/-][a-z0-9]+)+\b/gi,
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

  function cleanTranslatedText(text) {
    return text.replace(/<unk>/g, "").replace(/\s{2,}/g, " ");
  }

  function preserveWhitespace(original, translated) {
    const leading = original.match(/^\s*/)?.[0] || "";
    const trailing = original.match(/\s*$/)?.[0] || "";
    return `${leading}${translated}${trailing}`;
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
