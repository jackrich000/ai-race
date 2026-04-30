import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserPool } from "../lib/browser.mjs";

// Fake browser stand-in. Tracks isConnected + close calls.
function makeFakeBrowser() {
  return {
    _connected: true,
    _closeCalls: 0,
    isConnected() { return this._connected; },
    async close() { this._closeCalls++; this._connected = false; },
    disconnect() { this._connected = false; },
  };
}

describe("BrowserPool", () => {
  let launches;
  let launcher;

  beforeEach(() => {
    launches = [];
    launcher = vi.fn(async (kind) => {
      const browser = makeFakeBrowser();
      const entry = { browser, sessionId: kind === "browserbase" ? `s-${launches.length}` : null };
      launches.push({ kind, entry });
      return entry;
    });
  });

  it("caches browsers by kind — repeat getBrowser returns same instance", async () => {
    const pool = new BrowserPool({ launcher });
    const a = await pool.getBrowser("local");
    const b = await pool.getBrowser("local");
    expect(a).toBe(b);
    expect(launcher).toHaveBeenCalledTimes(1);
  });

  it("launches separate browsers for different kinds", async () => {
    const pool = new BrowserPool({ launcher });
    const local = await pool.getBrowser("local");
    const bb = await pool.getBrowser("browserbase");
    expect(local).not.toBe(bb);
    expect(launcher).toHaveBeenCalledTimes(2);
    expect(launcher).toHaveBeenNthCalledWith(1, "local");
    expect(launcher).toHaveBeenNthCalledWith(2, "browserbase");
  });

  it("re-launches when a cached browser has disconnected", async () => {
    const pool = new BrowserPool({ launcher });
    const first = await pool.getBrowser("browserbase");
    first.disconnect();
    const second = await pool.getBrowser("browserbase");
    expect(second).not.toBe(first);
    expect(launcher).toHaveBeenCalledTimes(2);
  });

  it("closeAll closes every cached browser and is idempotent", async () => {
    const pool = new BrowserPool({ launcher });
    const local = await pool.getBrowser("local");
    const bb = await pool.getBrowser("browserbase");
    await pool.closeAll();
    expect(local._closeCalls).toBe(1);
    expect(bb._closeCalls).toBe(1);
    expect(pool.hasKind("local")).toBe(false);
    expect(pool.hasKind("browserbase")).toBe(false);

    // Idempotent: second closeAll is a no-op
    await pool.closeAll();
    expect(local._closeCalls).toBe(1);
    expect(bb._closeCalls).toBe(1);
  });

  it("getSessionId returns the launcher-provided sessionId", async () => {
    const pool = new BrowserPool({ launcher });
    await pool.getBrowser("browserbase");
    expect(pool.getSessionId("browserbase")).toBe("s-0");
    await pool.getBrowser("local");
    expect(pool.getSessionId("local")).toBe(null);
  });

  it("propagates launcher errors (e.g. missing env vars)", async () => {
    const failing = vi.fn(async () => {
      throw new Error("Browserbase requested but BROWSERBASE_API_KEY is not set");
    });
    const pool = new BrowserPool({ launcher: failing });
    await expect(pool.getBrowser("browserbase")).rejects.toThrow(/BROWSERBASE_API_KEY/);
    // Pool does NOT cache failed launches — next call re-tries
    await expect(pool.getBrowser("browserbase")).rejects.toThrow(/BROWSERBASE_API_KEY/);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("closeAll tolerates browser.close() rejection", async () => {
    const flaky = makeFakeBrowser();
    flaky.close = async () => { throw new Error("already disconnected"); };
    const flakyLauncher = vi.fn(async () => ({ browser: flaky, sessionId: null }));
    const pool = new BrowserPool({ launcher: flakyLauncher });
    await pool.getBrowser("local");
    await expect(pool.closeAll()).resolves.toBeUndefined();
    expect(pool.hasKind("local")).toBe(false);
  });
});
