(function runRecipeMaster() {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;
  const parser = globalThis.RecipeMasterParser;
  const rules = globalThis.RecipeMasterRules;
  if (!extensionApi || !parser || !rules || globalThis.__recipeMasterLoaded) {
    return;
  }
  globalThis.__recipeMasterLoaded = true;

  const DEFAULT_SETTINGS = Object.freeze({
    autoClean: true,
    autoJump: true,
    cleanAds: true,
    cleanFloatingMedia: true,
    cleanPopups: true,
    disabledHosts: [],
    smoothScroll: false
  });

  const state = {
    active: false,
    card: null,
    cleaned: 0,
    enabled: true,
    hostname: location.hostname.toLowerCase(),
    jumped: false,
    observer: null,
    readerHost: null,
    recipe: null,
    scanTimer: null,
    settings: { ...DEFAULT_SETTINGS },
    source: "none",
    url: location.href
  };

  function safeQueryAll(scope, selectors) {
    const found = [];
    const seen = new Set();
    for (const selector of selectors) {
      let matches;
      try {
        matches = scope.querySelectorAll(selector);
      } catch (_error) {
        continue;
      }
      for (const element of matches) {
        if (!seen.has(element)) {
          seen.add(element);
          found.push(element);
        }
      }
    }
    return found;
  }

  function baseHostname() {
    return state.hostname.replace(/^www\./, "");
  }

  function matchingPriorityDomain() {
    const host = baseHostname();
    return rules.priorityDomains.find((domain) => host === domain || host.endsWith(`.${domain}`)) || "";
  }

  function siteSelectors() {
    const host = baseHostname();
    const match = Object.keys(rules.siteCardSelectors).find((domain) => host === domain || host.endsWith(`.${domain}`));
    return match ? rules.siteCardSelectors[match] : [];
  }

  function elementText(element) {
    return parser.cleanText(element && element.textContent);
  }

  function looksLikeRecipeCard(element) {
    if (!element || element === document.body || element === document.documentElement) {
      return false;
    }

    const text = elementText(element).slice(0, 12000);
    if (text.length < 40) {
      return false;
    }

    const hasIngredients = rules.headingIngredients.test(findHeadingText(element, rules.headingIngredients)) ||
      safeQueryAll(element, rules.ingredientSelectors).length >= 2;
    const hasInstructions = rules.headingInstructions.test(findHeadingText(element, rules.headingInstructions)) ||
      safeQueryAll(element, rules.instructionSelectors).length >= 1;
    return hasIngredients && hasInstructions;
  }

  function findHeadingText(scope, pattern) {
    const headings = scope.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']");
    for (const heading of headings) {
      const text = elementText(heading).replace(/[:：]\s*$/, "");
      if (pattern.test(text)) {
        return text;
      }
    }
    return "";
  }

  function findKnownCard() {
    const candidates = safeQueryAll(document, [...siteSelectors(), ...rules.cardSelectors]);
    let fallback = null;
    for (const element of candidates) {
      if (!fallback && elementText(element).length >= 80) {
        fallback = element;
      }
      if (looksLikeRecipeCard(element)) {
        return element;
      }
    }
    return fallback;
  }

  function findHeadingTarget() {
    const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']");
    let ingredientHeading = null;
    let instructionHeading = null;

    for (const heading of headings) {
      const text = elementText(heading).replace(/[:：]\s*$/, "");
      if (!ingredientHeading && rules.headingIngredients.test(text)) {
        ingredientHeading = heading;
      }
      if (!instructionHeading && rules.headingInstructions.test(text)) {
        instructionHeading = heading;
      }
      if (ingredientHeading && instructionHeading) {
        break;
      }
    }

    if (!ingredientHeading) {
      return null;
    }

    if (instructionHeading) {
      let ancestor = ingredientHeading.parentElement;
      while (ancestor && ancestor !== document.body) {
        if (ancestor.contains(instructionHeading) && elementText(ancestor).length < 25000) {
          return { card: ancestor, target: ingredientHeading };
        }
        ancestor = ancestor.parentElement;
      }
    }

    return {
      card: ingredientHeading.closest("section, article, main, [class*='recipe']") || ingredientHeading.parentElement,
      target: ingredientHeading
    };
  }

  function findLinkedJumpTarget() {
    const controls = document.querySelectorAll("a[href*='#'], button, [role='button']");
    for (const control of controls) {
      if (!/^jump (?:to|straight to) (?:the )?recipe$/i.test(elementText(control))) {
        continue;
      }
      if (control instanceof HTMLAnchorElement) {
        const hash = new URL(control.href, location.href).hash;
        if (hash) {
          try {
            const target = document.querySelector(hash);
            if (target) {
              return target;
            }
          } catch (_error) {
            // Ignore invalid fragment selectors.
          }
        }
      }
    }
    return null;
  }

  function locateRecipe() {
    const knownCard = findKnownCard();
    const headings = findHeadingTarget();
    const recipe = parser.extractFromDocument(document, rules, knownCard || (headings && headings.card));
    const target = knownCard || (headings && headings.target) || findLinkedJumpTarget();
    return { card: knownCard || (headings && headings.card), recipe, target };
  }

  function markHidden(element, reason) {
    if (!element || element.id === "recipe-master-reader-host" || element.closest("#recipe-master-reader-host")) {
      return false;
    }
    if (state.card && (element === state.card || element.contains(state.card))) {
      return false;
    }
    if (element.dataset.recipeMasterHidden === "true") {
      return false;
    }
    element.dataset.recipeMasterHidden = "true";
    element.dataset.recipeMasterReason = reason;
    state.cleaned += 1;
    return true;
  }

  function isFixedOrDialog(element) {
    if (element.matches("dialog[open], [role='dialog'], [aria-modal='true']")) {
      return true;
    }
    const style = getComputedStyle(element);
    return style.position === "fixed" || style.position === "sticky";
  }

  function shouldHideOverlay(element) {
    if (!element || element.closest("#recipe-master-reader-host")) {
      return false;
    }

    const text = elementText(element).slice(0, 5000);
    const identity = `${element.id} ${element.className || ""} ${element.getAttribute("aria-label") || ""}`;
    const searchable = `${identity} ${text}`;
    if (rules.protectedText.test(searchable)) {
      return false;
    }

    const fixed = isFixedOrDialog(element);
    const knownPopup = /pum-|om-holder|newsletter|email-popup|signup-modal|promo-modal|exit-intent/i.test(identity);
    const emailCapture = Boolean(element.querySelector("input[type='email'], input[autocomplete='email']"));
    return rules.nuisanceText.test(searchable) && (fixed || knownPopup || emailCapture);
  }

  function cleanInlinePromotions() {
    const selectors = [
      "[class*='newsletter-signup']",
      "[id*='newsletter-signup']",
      "[class*='newsletter-form']",
      "[id*='newsletter-form']",
      "[class*='email-signup']",
      "[id*='email-signup']",
      "[class*='email-subscribe']",
      "[id*='email-subscribe']",
      "[class*='app-download']",
      "[id*='app-download']",
      "[class*='social-follow']"
    ];

    for (const element of safeQueryAll(document, selectors)) {
      const searchable = `${element.id} ${element.className || ""} ${elementText(element).slice(0, 3000)}`;
      if (!rules.protectedText.test(searchable)) {
        markHidden(element, "promotion");
      }
    }
  }

  function restoreReasons(reasons) {
    const reasonSet = new Set(reasons);
    for (const element of document.querySelectorAll("[data-recipe-master-hidden='true']")) {
      if (reasonSet.has(element.dataset.recipeMasterReason)) {
        delete element.dataset.recipeMasterHidden;
        delete element.dataset.recipeMasterReason;
      }
    }
  }

  function resetForNavigation() {
    closeReader();
    state.active = false;
    state.card = null;
    state.cleaned = 0;
    state.jumped = false;
    state.recipe = null;
    state.source = "none";
    state.url = location.href;
    document.documentElement.classList.remove("recipe-master-active");
    for (const element of document.querySelectorAll("[data-recipe-master-hidden], [data-recipe-master-target]")) {
      delete element.dataset.recipeMasterHidden;
      delete element.dataset.recipeMasterReason;
      delete element.dataset.recipeMasterTarget;
    }
  }

  function cleanNuisances() {
    if (!state.active || !state.enabled) {
      return;
    }

    if (state.settings.cleanAds) {
      for (const element of safeQueryAll(document, rules.adSelectors)) {
        markHidden(element, "advertisement");
      }
    }

    if (state.settings.cleanFloatingMedia) {
      for (const element of safeQueryAll(document, rules.floatingMediaSelectors)) {
        markHidden(element, "floating-media");
      }

      for (const media of document.querySelectorAll("video, iframe[title*='video' i], [class*='video-player']")) {
        const container = media.closest("[class*='sticky'], [class*='floating'], [style*='position: fixed'], [style*='position:fixed']");
        if (container && isFixedOrDialog(container)) {
          markHidden(container, "floating-media");
        }
      }
    }

    if (state.settings.cleanPopups) {
      for (const element of safeQueryAll(document, rules.overlayCandidateSelectors)) {
        if (shouldHideOverlay(element)) {
          markHidden(element, "popup");
        }
      }
      cleanInlinePromotions();
    }
  }

  function activate() {
    state.active = true;
    document.documentElement.classList.add("recipe-master-active");
    if (state.settings.autoClean) {
      cleanNuisances();
    }
  }

  function deactivate() {
    state.active = false;
    document.documentElement.classList.remove("recipe-master-active");
    closeReader();
  }

  function jumpToRecipe(force = false) {
    if ((!state.enabled && !force) || !state.card) {
      return false;
    }

    const headings = findHeadingTarget();
    const target = (headings && headings.target) || state.card;
    target.dataset.recipeMasterTarget = "true";
    target.scrollIntoView({
      behavior: state.settings.smoothScroll ? "smooth" : "auto",
      block: "start"
    });
    state.jumped = true;
    return true;
  }

  function scheduleScan(delay = 250) {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(scanPage, delay);
  }

  function scanPage() {
    state.scanTimer = null;
    if (!document.documentElement) {
      scheduleScan(100);
      return;
    }
    if (state.url !== location.href) {
      resetForNavigation();
    }

    const located = locateRecipe();
    if (located.card) {
      state.card = located.card;
    }
    if (located.recipe) {
      state.recipe = located.recipe;
      state.source = located.recipe.source;
    }

    const detected = Boolean(state.recipe || state.card);
    if (detected && state.enabled) {
      activate();
      if (state.settings.autoJump && !state.jumped && state.card) {
        setTimeout(() => jumpToRecipe(), 150);
      }
    } else {
      deactivate();
    }
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (text !== undefined && text !== null) {
      element.textContent = String(text);
    }
    return element;
  }

  function appendMetadata(container, label, value) {
    if (!value) {
      return;
    }
    const item = createElement("div", "rm-meta-item");
    item.append(createElement("span", "rm-meta-label", label), createElement("strong", "", value));
    container.append(item);
  }

  function readerStyles() {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .rm-backdrop {
        background: rgba(4, 5, 7, .96);
        color: #f7f3f1;
        font-family: "Segoe UI", system-ui, sans-serif;
        inset: 0;
        overflow: auto;
        padding: 28px 18px 60px;
        position: fixed;
      }
      .rm-sheet {
        background: #111317;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 14px;
        box-shadow: 0 24px 80px rgba(0,0,0,.48);
        margin: 0 auto;
        max-width: 1040px;
        overflow: hidden;
      }
      .rm-toolbar {
        align-items: center;
        background: rgba(17,19,23,.96);
        border-bottom: 1px solid rgba(255,255,255,.1);
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        padding: 12px 18px;
        position: sticky;
        top: 0;
        z-index: 2;
      }
      button {
        background: #262a31;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 8px;
        color: #fff;
        cursor: pointer;
        font: 600 14px/1 "Segoe UI", system-ui, sans-serif;
        padding: 10px 14px;
      }
      button:hover, button:focus-visible { border-color: #AE0212; outline: none; }
      .rm-close { background: #AE0212; border-color: #AE0212; }
      .rm-header { padding: 34px 36px 26px; }
      .rm-kicker { color: #df6974; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
      h1 { color: #fff; font: 750 clamp(32px, 5vw, 56px)/1.05 "Segoe UI", system-ui, sans-serif; margin: 8px 0 14px; }
      .rm-description { color: #c7c8cc; font-size: 16px; line-height: 1.65; margin: 0; max-width: 760px; }
      .rm-byline { color: #a8abb2; font-size: 14px; margin-top: 14px; }
      .rm-image { display: block; max-height: 430px; object-fit: cover; width: 100%; }
      .rm-meta { display: grid; gap: 1px; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); background: rgba(255,255,255,.08); border-bottom: 1px solid rgba(255,255,255,.08); border-top: 1px solid rgba(255,255,255,.08); }
      .rm-meta-item { background: #16191e; min-height: 78px; padding: 16px 20px; }
      .rm-meta-label { color: #91959e; display: block; font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 6px; text-transform: uppercase; }
      .rm-meta strong { color: #fff; font-size: 16px; }
      .rm-content { display: grid; gap: 38px; grid-template-columns: minmax(250px, .8fr) minmax(0, 1.4fr); padding: 36px; }
      h2 { border-bottom: 2px solid #AE0212; color: #fff; font: 750 23px/1.2 "Segoe UI", system-ui, sans-serif; margin: 0 0 20px; padding-bottom: 10px; }
      h3 { color: #e8e8ea; font: 700 17px/1.3 "Segoe UI", system-ui, sans-serif; margin: 28px 0 12px; }
      ul, ol { margin: 0; padding: 0; }
      li { color: #e4e4e6; font-size: 16px; line-height: 1.58; }
      .rm-ingredients { list-style: none; }
      .rm-ingredients li { border-bottom: 1px solid rgba(255,255,255,.08); }
      .rm-ingredients label { align-items: flex-start; cursor: pointer; display: flex; gap: 12px; padding: 10px 2px; }
      .rm-ingredients input { accent-color: #AE0212; flex: 0 0 auto; height: 18px; margin-top: 3px; width: 18px; }
      .rm-ingredients input:checked + span { color: #777c85; text-decoration: line-through; }
      .rm-instructions { counter-reset: rm-step; list-style: none; }
      .rm-instructions li { counter-increment: rm-step; display: grid; gap: 14px; grid-template-columns: 34px 1fr; margin-bottom: 18px; }
      .rm-instructions li::before { align-items: center; background: #AE0212; border-radius: 50%; color: #fff; content: counter(rm-step); display: flex; font-size: 13px; font-weight: 700; height: 30px; justify-content: center; margin-top: 1px; width: 30px; }
      .rm-details { border-top: 1px solid rgba(255,255,255,.08); display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); padding: 0 36px 36px; }
      .rm-detail-card { background: #181b20; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; padding: 18px; }
      .rm-detail-card h2 { font-size: 17px; }
      .rm-detail-list { display: grid; gap: 9px; }
      .rm-detail-row { color: #d6d7da; display: flex; font-size: 14px; gap: 14px; justify-content: space-between; }
      .rm-detail-row strong { color: #fff; text-align: right; }
      .rm-source { border-top: 1px solid rgba(255,255,255,.08); color: #999da5; font-size: 13px; padding: 18px 36px 28px; }
      .rm-source a { color: #df6974; overflow-wrap: anywhere; }
      @media (max-width: 720px) {
        .rm-backdrop { padding: 0; }
        .rm-sheet { border: 0; border-radius: 0; min-height: 100%; }
        .rm-header, .rm-content { padding: 26px 20px; }
        .rm-content { grid-template-columns: 1fr; }
        .rm-details { padding: 0 20px 26px; }
        .rm-source { padding: 18px 20px 24px; }
      }
      @media print {
        .rm-backdrop { background: #fff; color: #111; inset: auto; overflow: visible; padding: 0; position: static; }
        .rm-sheet { background: #fff; border: 0; box-shadow: none; color: #111; max-width: none; }
        .rm-toolbar { display: none; }
        h1, h2, h3, li, .rm-meta strong, .rm-detail-row, .rm-detail-row strong { color: #111; }
        .rm-description, .rm-byline, .rm-meta-label, .rm-source { color: #444; }
        .rm-meta, .rm-meta-item, .rm-detail-card { background: #fff; }
        .rm-content { grid-template-columns: 1fr 1.5fr; }
      }
    `;
  }

  function buildDetails(title, values) {
    const entries = Object.entries(values || {}).filter(([, value]) => value);
    if (!entries.length) {
      return null;
    }
    const card = createElement("section", "rm-detail-card");
    card.append(createElement("h2", "", title));
    const list = createElement("div", "rm-detail-list");
    for (const [label, value] of entries) {
      const row = createElement("div", "rm-detail-row");
      row.append(createElement("span", "", label), createElement("strong", "", value));
      list.append(row);
    }
    card.append(list);
    return card;
  }

  function openReader() {
    if (!state.recipe || !document.body) {
      return false;
    }
    if (state.readerHost) {
      return true;
    }

    const recipe = state.recipe;
    const host = createElement("div");
    host.id = "recipe-master-reader-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = createElement("style", "", readerStyles());
    const backdrop = createElement("div", "rm-backdrop");
    const sheet = createElement("article", "rm-sheet");
    const toolbar = createElement("div", "rm-toolbar");
    const printButton = createElement("button", "", "Print");
    printButton.type = "button";
    printButton.addEventListener("click", () => window.print());
    const closeButton = createElement("button", "rm-close", "Close");
    closeButton.type = "button";
    closeButton.addEventListener("click", closeReader);
    toolbar.append(printButton, closeButton);
    sheet.append(toolbar);

    const header = createElement("header", "rm-header");
    header.append(createElement("div", "rm-kicker", recipe.isDrink ? "Drink recipe" : "Recipe"));
    header.append(createElement("h1", "", recipe.name));
    if (recipe.description) {
      header.append(createElement("p", "rm-description", recipe.description));
    }
    if (recipe.author) {
      header.append(createElement("div", "rm-byline", `By ${recipe.author}`));
    }
    sheet.append(header);

    if (recipe.image) {
      const image = createElement("img", "rm-image");
      image.src = recipe.image;
      image.alt = recipe.name;
      image.referrerPolicy = "no-referrer";
      sheet.append(image);
    }

    const metadata = createElement("section", "rm-meta");
    appendMetadata(metadata, recipe.isDrink ? "Makes" : "Servings", recipe.yield);
    appendMetadata(metadata, "Prep", recipe.prepTime);
    appendMetadata(metadata, "Cook", recipe.cookTime);
    appendMetadata(metadata, "Total", recipe.totalTime);
    appendMetadata(metadata, "Category", recipe.category);
    appendMetadata(metadata, "Cuisine", recipe.cuisine);
    if (metadata.childElementCount) {
      sheet.append(metadata);
    }

    const content = createElement("div", "rm-content");
    const ingredientSection = createElement("section");
    ingredientSection.append(createElement("h2", "", "Ingredients"));
    const ingredientList = createElement("ul", "rm-ingredients");
    for (const ingredient of recipe.ingredients) {
      const item = createElement("li");
      const label = createElement("label");
      const checkbox = createElement("input");
      checkbox.type = "checkbox";
      label.append(checkbox, createElement("span", "", ingredient));
      item.append(label);
      ingredientList.append(item);
    }
    ingredientSection.append(ingredientList);
    content.append(ingredientSection);

    const instructionSection = createElement("section");
    instructionSection.append(createElement("h2", "", recipe.isDrink ? "Method" : "Instructions"));
    const instructionList = createElement("ol", "rm-instructions");
    let currentSection = "";
    for (const instruction of recipe.instructions) {
      if (instruction.section && instruction.section !== currentSection) {
        instructionList.append(createElement("h3", "", instruction.section));
        currentSection = instruction.section;
      }
      instructionList.append(createElement("li", "", instruction.text));
    }
    instructionSection.append(instructionList);
    content.append(instructionSection);
    sheet.append(content);

    const details = createElement("div", "rm-details");
    const extraCard = buildDetails(recipe.isDrink ? "Drink details" : "Details", recipe.additional);
    const nutritionCard = buildDetails("Nutrition", recipe.nutrition);
    if (extraCard) {
      details.append(extraCard);
    }
    if (nutritionCard) {
      details.append(nutritionCard);
    }
    if (details.childElementCount) {
      sheet.append(details);
    }

    if (recipe.url) {
      const source = createElement("footer", "rm-source");
      source.append("Source: ");
      const link = createElement("a", "", recipe.url);
      link.href = recipe.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      source.append(link);
      sheet.append(source);
    }

    backdrop.append(sheet);
    shadow.append(style, backdrop);
    document.body.append(host);
    document.documentElement.classList.add("recipe-master-reader-open");
    state.readerHost = host;
    closeButton.focus();
    return true;
  }

  function closeReader() {
    if (state.readerHost) {
      state.readerHost.remove();
      state.readerHost = null;
    }
    document.documentElement.classList.remove("recipe-master-reader-open");
  }

  function statusPayload() {
    return {
      active: state.active,
      canJump: Boolean(state.card),
      canRead: Boolean(state.recipe && state.recipe.ingredients.length && state.recipe.instructions.length),
      cleaned: document.querySelectorAll("[data-recipe-master-hidden='true']").length,
      enabled: state.enabled,
      hostname: state.hostname,
      priorityDomain: matchingPriorityDomain(),
      recipeName: state.recipe ? state.recipe.name : "",
      source: state.source
    };
  }

  extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === "GET_STATUS") {
      scanPage();
      sendResponse(statusPayload());
      return false;
    }
    if (message.type === "JUMP_TO_RECIPE") {
      sendResponse({ ok: jumpToRecipe(true) });
      return false;
    }
    if (message.type === "OPEN_READER") {
      sendResponse({ ok: openReader() });
      return false;
    }
    if (message.type === "CLOSE_READER") {
      closeReader();
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === "CLEAN_NOW") {
      activate();
      cleanNuisances();
      sendResponse({ ok: true, cleaned: state.cleaned });
      return false;
    }
    if (message.type === "SET_ENABLED") {
      state.enabled = Boolean(message.enabled);
      if (state.enabled) {
        scanPage();
      } else {
        deactivate();
      }
      sendResponse({ ok: true, enabled: state.enabled });
      return false;
    }
    return false;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.readerHost) {
      closeReader();
    }
  });

  extensionApi.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) {
        state.settings[key] = change.newValue;
      }
    }
    if (changes.cleanAds && changes.cleanAds.newValue === false) {
      restoreReasons(["advertisement"]);
    }
    if (changes.cleanFloatingMedia && changes.cleanFloatingMedia.newValue === false) {
      restoreReasons(["floating-media"]);
    }
    if (changes.cleanPopups && changes.cleanPopups.newValue === false) {
      restoreReasons(["popup", "promotion"]);
    }
    if (!Array.isArray(state.settings.disabledHosts)) {
      state.settings.disabledHosts = [];
    }
    state.enabled = !state.settings.disabledHosts.includes(state.hostname);
    scheduleScan(0);
  });

  async function initialize() {
    try {
      state.settings = await extensionApi.storage.sync.get(DEFAULT_SETTINGS);
    } catch (_error) {
      state.settings = { ...DEFAULT_SETTINGS };
    }
    if (!Array.isArray(state.settings.disabledHosts)) {
      state.settings.disabledHosts = [];
    }
    state.enabled = !state.settings.disabledHosts.includes(state.hostname);

    const beginObservation = () => {
      if (!document.documentElement || state.observer) {
        return;
      }
      state.observer = new MutationObserver(() => scheduleScan(450));
      state.observer.observe(document.documentElement, { childList: true, subtree: true });
      scanPage();
    };

    beginObservation();
    if (!state.observer) {
      document.addEventListener("readystatechange", beginObservation, { once: true });
    }
    document.addEventListener("DOMContentLoaded", () => scheduleScan(0), { once: true });
    window.addEventListener("load", () => scheduleScan(100), { once: true });
  }

  initialize();
})();
