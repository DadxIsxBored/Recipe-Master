"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
const contentScript = fs.readFileSync(path.join(projectRoot, "src", "content", "content.js"), "utf8");
const popupScript = fs.readFileSync(path.join(projectRoot, "src", "popup", "popup.js"), "utf8");
const popupCss = fs.readFileSync(path.join(projectRoot, "src", "popup", "popup.css"), "utf8");

test("declares Firefox desktop and Android compatibility", () => {
  const settings = manifest.browser_specific_settings;
  assert.match(settings.gecko.id, /@/);
  assert.equal(settings.gecko.strict_min_version, "140.0");
  assert.deepEqual(settings.gecko.data_collection_permissions.required, ["none"]);
  assert.equal(settings.gecko_android.strict_min_version, "142.0");
});

test("declares a Safari version that supports Manifest V3", () => {
  assert.equal(manifest.browser_specific_settings.safari.strict_min_version, "15.4");
});

test("selects the standard browser API with a Chromium fallback", () => {
  for (const source of [contentScript, popupScript]) {
    assert.match(source, /globalThis\.browser \|\| globalThis\.chrome/);
  }
});

test("keeps the popup within mobile viewports and supplies touch-size controls", () => {
  assert.match(popupCss, /max-width:\s*100vw/);
  assert.match(popupCss, /@media \(max-width:\s*400px\)/);
  assert.match(popupCss, /min-height:\s*44px/);
});

test("requests only the cross-browser APIs used by the extension", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "storage"]);
  assert.equal("background" in manifest, false);
  assert.equal("host_permissions" in manifest, false);
});
