(function initializePopup() {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    autoClean: true,
    autoJump: true,
    cleanAds: true,
    cleanFloatingMedia: true,
    cleanPopups: true,
    disabledHosts: [],
    smoothScroll: false
  });

  const controls = {
    autoClean: document.querySelector("#auto-clean"),
    autoJump: document.querySelector("#auto-jump"),
    cleanAds: document.querySelector("#clean-ads"),
    cleanFloatingMedia: document.querySelector("#clean-floating-media"),
    cleanPopups: document.querySelector("#clean-popups"),
    smoothScroll: document.querySelector("#smooth-scroll")
  };
  const siteEnabled = document.querySelector("#site-enabled");
  const siteName = document.querySelector("#site-name");
  const statusDot = document.querySelector("#status-dot");
  const statusTitle = document.querySelector("#status-title");
  const statusDetail = document.querySelector("#status-detail");
  const statusStats = document.querySelector("#status-stats");
  const readerButton = document.querySelector("#reader-button");
  const jumpButton = document.querySelector("#jump-button");
  const cleanButton = document.querySelector("#clean-button");

  let activeTabId = null;
  let currentHost = "";

  async function sendToPage(type, data = {}) {
    if (activeTabId === null) {
      return null;
    }
    try {
      return await chrome.tabs.sendMessage(activeTabId, { type, ...data });
    } catch (_error) {
      return null;
    }
  }

  function renderUnavailable() {
    statusDot.className = "status-dot unavailable";
    statusTitle.textContent = "This page cannot be processed";
    statusDetail.textContent = "Open a standard website tab, then reload it after installing or updating the extension.";
    statusStats.hidden = true;
    readerButton.disabled = true;
    jumpButton.disabled = true;
    cleanButton.disabled = true;
    siteEnabled.disabled = true;
  }

  function renderStatus(status) {
    if (!status) {
      renderUnavailable();
      return;
    }

    currentHost = status.hostname;
    siteName.textContent = status.hostname;
    siteEnabled.checked = status.enabled;
    siteEnabled.disabled = false;
    readerButton.disabled = !status.enabled || !status.canRead;
    jumpButton.disabled = !status.enabled || !status.canJump;
    cleanButton.disabled = !status.enabled || (!status.active && !status.canJump && !status.canRead);

    if (!status.enabled) {
      statusDot.className = "status-dot unavailable";
      statusTitle.textContent = "Disabled on this site";
      statusDetail.textContent = "Turn on site processing to scan this page.";
    } else if (status.canRead || status.canJump) {
      statusDot.className = "status-dot detected";
      statusTitle.textContent = status.recipeName || "Recipe detected";
      statusDetail.textContent = status.canRead
        ? "Ingredients and instructions are available for the clean recipe view."
        : "A recipe card is available for direct jumping.";
    } else {
      statusDot.className = "status-dot";
      statusTitle.textContent = "No recipe detected";
      statusDetail.textContent = "This page does not currently expose recipe data or a recognized recipe card.";
    }

    const sourceLabels = {
      "json-ld": "Schema.org data",
      dom: "page recipe card",
      none: "no extraction source"
    };
    const domainLabel = status.priorityDomain ? "priority-domain rules" : "universal detection";
    statusStats.textContent = `${sourceLabels[status.source] || status.source} · ${domainLabel} · ${status.cleaned} elements cleaned`;
    statusStats.hidden = false;
  }

  async function loadSettings() {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    for (const [key, input] of Object.entries(controls)) {
      input.checked = Boolean(settings[key]);
      input.addEventListener("change", async () => {
        await chrome.storage.sync.set({ [key]: input.checked });
      });
    }
  }

  siteEnabled.addEventListener("change", async () => {
    if (!currentHost) {
      return;
    }
    const stored = await chrome.storage.sync.get({ disabledHosts: [] });
    const disabledHosts = new Set(Array.isArray(stored.disabledHosts) ? stored.disabledHosts : []);
    if (siteEnabled.checked) {
      disabledHosts.delete(currentHost);
    } else {
      disabledHosts.add(currentHost);
    }
    await chrome.storage.sync.set({ disabledHosts: [...disabledHosts].sort() });
    await sendToPage("SET_ENABLED", { enabled: siteEnabled.checked });
    renderStatus(await sendToPage("GET_STATUS"));
  });

  readerButton.addEventListener("click", async () => {
    await sendToPage("OPEN_READER");
    window.close();
  });

  jumpButton.addEventListener("click", async () => {
    await sendToPage("JUMP_TO_RECIPE");
    window.close();
  });

  cleanButton.addEventListener("click", async () => {
    await sendToPage("CLEAN_NOW");
    renderStatus(await sendToPage("GET_STATUS"));
  });

  async function start() {
    await loadSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) {
      renderUnavailable();
      return;
    }
    activeTabId = tab.id;
    renderStatus(await sendToPage("GET_STATUS"));
  }

  start().catch(renderUnavailable);
})();
