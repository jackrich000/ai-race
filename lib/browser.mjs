// lib/browser.mjs
// Browser launcher + lazy pool for extraction pipeline.
// Supports per-lab opt-in to Browserbase (cloud browser) via the LAB_SOURCES
// `useBrowserbase: true` flag. Other labs use local Playwright.
//
// Usage:
//   const pool = new BrowserPool();
//   const browser = await pool.getBrowser(useBrowserbase ? "browserbase" : "local");
//   const ctx = await browser.newContext({ ... });
//   ...
//   await pool.closeAll();

import { chromium } from "playwright";

// Env vars are read at call time, not module load time. Scripts load .env
// AFTER imports (extract-model-cards.mjs), so module-level reads come back
// undefined even when the keys are present.

async function launchBrowserbase() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error(
      "Browserbase requested but BROWSERBASE_API_KEY or BROWSERBASE_PROJECT_ID is not set"
    );
  }
  const sessionResp = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "x-bb-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId }),
  });
  if (!sessionResp.ok) {
    throw new Error(
      `Browserbase session creation failed: ${sessionResp.status} ${await sessionResp.text()}`
    );
  }
  const { id: sessionId } = await sessionResp.json();
  const wsUrl = `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${sessionId}`;
  const browser = await chromium.connectOverCDP(wsUrl);
  return { browser, sessionId };
}

async function launchLocal() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  return { browser, sessionId: null };
}

/**
 * Launch a browser of the requested kind.
 *   kind="browserbase" — cloud browser; throws if credentials missing.
 *   kind="local"       — local headless Playwright.
 */
export async function launchBrowser(kind) {
  if (kind === "browserbase") {
    console.log("  Using Browserbase (cloud browser)...");
    return launchBrowserbase();
  }
  console.log("  Using local Playwright (headless)...");
  return launchLocal();
}

/**
 * Lazy pool of browsers keyed by kind. Reuses across articles within a kind,
 * which minimizes Browserbase session creation (each session bills minutes).
 *
 * Re-inits if a cached browser has disconnected (e.g. mid-loop CDP drop).
 *
 * @param {object} options
 * @param {(kind: string) => Promise<{browser, sessionId}>} options.launcher — injectable for tests
 */
export class BrowserPool {
  constructor({ launcher } = {}) {
    this.launcher = launcher || launchBrowser;
    this.cache = new Map();
  }

  async getBrowser(kind) {
    const cached = this.cache.get(kind);
    if (cached) {
      if (cached.browser.isConnected()) return cached.browser;
      console.warn(`  ${kind} browser disconnected — re-launching`);
      this.cache.delete(kind);
    }
    const result = await this.launcher(kind);
    this.cache.set(kind, result);
    return result.browser;
  }

  hasKind(kind) {
    return this.cache.has(kind);
  }

  getSessionId(kind) {
    return this.cache.get(kind)?.sessionId ?? null;
  }

  async closeAll() {
    const entries = Array.from(this.cache.values());
    this.cache.clear();
    for (const entry of entries) {
      try {
        await entry.browser.close();
      } catch {
        // ignore — may already be disconnected
      }
    }
  }
}
