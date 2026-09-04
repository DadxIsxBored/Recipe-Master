"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "recipe-page.html"));
const braveCandidates = [
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  path.join(process.env.LOCALAPPDATA || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
];

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForTarget(debugPort, pageUrl) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find((entry) => entry.type === "page" && entry.url === pageUrl);
      if (target) {
        return target;
      }
    } catch (_error) {
      // Brave may still be opening its debugging endpoint.
    }
    await delay(150);
  }
  throw new Error("Brave did not expose the fixture page through the debugging endpoint.");
}

function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out while evaluating the fixture page."));
    }, 10000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true }
      }));
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) {
        return;
      }
      clearTimeout(timeout);
      socket.close();
      if (message.error || (message.result && message.result.exceptionDetails)) {
        reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        return;
      }
      resolve(message.result.result.value);
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not connect to Brave's page debugging socket."));
    });
  });
}

async function main() {
  const bravePath = braveCandidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!bravePath) {
    throw new Error("Brave is not installed in a recognized location.");
  }

  const pagePort = await availablePort();
  const debugPort = await availablePort();
  const pageUrl = `http://127.0.0.1:${pagePort}/`;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(fixture);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(pagePort, "127.0.0.1", resolve);
  });

  const profilePath = path.join(os.tmpdir(), `recipe-master-browser-test-${Date.now()}`);
  const browser = spawn(bravePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--disable-default-apps",
    `--remote-debugging-port=${debugPort}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${profilePath}`,
    `--disable-extensions-except=${projectRoot}`,
    `--load-extension=${projectRoot}`,
    pageUrl
  ], {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  });
  browser.stderr.on("data", () => {});

  try {
    const target = await waitForTarget(debugPort, pageUrl);
    await delay(1800);
    const result = await evaluate(target, `(() => ({
      active: document.documentElement.classList.contains("recipe-master-active"),
      adHidden: document.querySelector(".adthrive-ad")?.dataset.recipeMasterReason === "advertisement",
      popupHidden: document.querySelector("[role='dialog']:not(#age-check)")?.dataset.recipeMasterReason === "popup",
      ageGatePreserved: document.querySelector("#age-check")?.dataset.recipeMasterHidden !== "true",
      cardFound: Boolean(document.querySelector(".wprm-recipe-container"))
    }))()`);

    for (const [name, passed] of Object.entries(result)) {
      if (!passed) {
        throw new Error(`Browser smoke assertion failed: ${name}`);
      }
    }
    process.stdout.write(`Browser smoke test passed: ${JSON.stringify(result)}\n`);
  } finally {
    browser.kill();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
