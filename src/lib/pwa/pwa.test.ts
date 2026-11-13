import { readFileSync, statSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, test } from "vitest";
import manifest from "@/app/manifest";

const ROOT = process.cwd();

/** PNG width and height live at fixed offsets in the header. */
function pngSize(path: string) {
  const b = readFileSync(`${ROOT}/${path}`);
  expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe("the web app manifest", () => {
  const m = manifest();
  test("is installable: name, start page, standalone display, colours", () => {
    expect(m.name).toBe("Ledgerly");
    expect(m.short_name).toBe("Ledgerly");
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.lang).toBe("en-ZA");
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });
  test("has 192 and 512 icons, and a maskable one, and every file exists at its stated size", () => {
    const icons = m.icons ?? [];
    for (const want of [{ size: 192, purpose: "any" }, { size: 512, purpose: "any" }, { size: 512, purpose: "maskable" }]) {
      const icon = icons.find((i) => i.sizes === `${want.size}x${want.size}` && i.purpose === want.purpose);
      expect(icon, `${want.size} ${want.purpose}`).toBeDefined();
      expect(icon!.type).toBe("image/png");
      const path = `public${icon!.src}`;
      expect(statSync(`${ROOT}/${path}`).size).toBeGreaterThan(500);
      expect(pngSize(path)).toEqual({ w: want.size, h: want.size });
    }
  });
  test("the Apple touch icon exists at 180", () => {
    expect(pngSize("src/app/apple-icon.png")).toEqual({ w: 180, h: 180 });
  });
});

// ---- The service worker, run in a sandbox with a fake cache and network ----

type Handler = (e: unknown) => void;
function bootWorker() {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: Request | string) => (typeof r === "string" ? new URL(r, "https://app.test").href : r.url);
  const cacheApi = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const s = stores.get(name)!;
    return {
      put: async (r: Request | string, res: Response) => void s.set(key(r), res),
      add: async (r: string) => void s.set(key(r), await net(r)),
      match: async (r: Request | string) => s.get(key(r))?.clone(),
      keys: async () => [...s.keys()].map((k) => new Request(k)),
      delete: async (r: Request | string) => s.delete(key(r)),
    };
  };
  const state = { online: true, fetched: [] as string[], claimed: false, skipped: false, notified: [] as string[], respond: (url: string) => new Response(`page ${url}`, { status: 200 }) };
  const net = async (r: Request | string) => {
    const url = key(r);
    state.fetched.push(url);
    if (!state.online) throw new TypeError("Failed to fetch");
    return state.respond(url);
  };
  const sandbox = {
    self: {
      location: { origin: "https://app.test" },
      addEventListener: (type: string, h: Handler) => void (handlers[type] = h),
      skipWaiting: async () => void (state.skipped = true),
      clients: { claim: async () => void (state.claimed = true), matchAll: async () => [], openWindow: async () => null },
      registration: { showNotification: async (t: string) => void state.notified.push(t) },
    },
    caches: {
      open: async (n: string) => cacheApi(n),
      keys: async () => [...stores.keys()],
      delete: async (n: string) => stores.delete(n),
      match: async (r: Request | string) => {
        for (const s of stores.values()) {
          const hit = s.get(key(r));
          if (hit) return hit.clone();
        }
        return undefined;
      },
    },
    fetch: net,
    URL,
    Response,
    Request,
    Promise,
    console,
  };
  vm.runInNewContext(readFileSync(`${ROOT}/public/sw.js`, "utf8"), sandbox);

  async function fire(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | null = null;
    handlers[type]?.({ ...extra, waitUntil: (p: Promise<unknown>) => void waits.push(p), respondWith: (p: Promise<Response>) => void (responded = Promise.resolve(p)) });
    await Promise.all(waits);
    return responded as Promise<Response> | null;
  }
  // A plain object: the real Request's `mode` cannot be set, and the worker only reads url, method and mode.
  const plain = (url: string, method = "GET", mode = "navigate") => ({ request: { url, method, mode } });
  const nav = (path: string, init: { method?: string } = {}) => plain(`https://app.test${path}`, init.method ?? "GET");
  return { stores, state, fire, nav, handlers };
}

describe("the service worker: install and update", () => {
  test("installing saves the offline page and takes over at once", async () => {
    const w = bootWorker();
    await w.fire("install");
    expect([...w.stores.values()].some((s) => [...s.keys()].includes("https://app.test/offline"))).toBe(true);
    expect(w.state.skipped).toBe(true);
  });
  test("activating removes caches from older versions, keeps current ones, and claims open tabs", async () => {
    const w = bootWorker();
    await w.fire("install");
    const current = [...w.stores.keys()];
    w.stores.set("ledgerly-pages-v0", new Map());
    await w.fire("activate");
    expect([...w.stores.keys()].sort()).toEqual(current.sort());
    expect(w.state.claimed).toBe(true);
  });
});

describe("the service worker: pages", () => {
  test("a page that loaded is saved, and shown when the network is gone", async () => {
    const w = bootWorker();
    await w.fire("install");
    const first = await (await w.fire("fetch", w.nav("/acme/money")))!;
    expect(await first.text()).toBe("page https://app.test/acme/money");
    w.state.online = false;
    const again = await (await w.fire("fetch", w.nav("/acme/money")))!;
    expect(await again.text()).toBe("page https://app.test/acme/money");
  });
  test("with no saved copy and no network, the offline page is shown", async () => {
    const w = bootWorker();
    w.state.respond = (url) => new Response(`page ${url}`);
    await w.fire("install");
    w.state.online = false;
    const r = await (await w.fire("fetch", w.nav("/acme/never-seen")))!;
    expect(await r.text()).toBe("page https://app.test/offline");
  });
  test("a redirect (for example to sign in) or an error is passed through and never saved", async () => {
    const w = bootWorker();
    await w.fire("install");
    const redirected = Object.defineProperty(new Response("login", { status: 200 }), "redirected", { value: true });
    w.state.respond = () => redirected;
    await w.fire("fetch", w.nav("/acme"));
    w.state.respond = () => new Response("boom", { status: 500 });
    await w.fire("fetch", w.nav("/acme/money"));
    w.state.online = false;
    expect(await (await w.fire("fetch", w.nav("/acme")))!.text()).toBe("page https://app.test/offline");
    expect(await (await w.fire("fetch", w.nav("/acme/money")))!.text()).toBe("page https://app.test/offline");
  });
  test.each(["/login", "/auth/callback", "/portal/abc", "/p/abc", "/invite/abc", "/book/acme", "/api/jobs/push"])("%s is never saved", async (path) => {
    const w = bootWorker();
    await w.fire("install");
    await w.fire("fetch", w.nav(path));
    w.state.online = false;
    const r = await w.fire("fetch", w.nav(path));
    // Not intercepted at all, or answered by the offline page: but never by a saved copy.
    if (r) expect(await r.text()).toBe("page https://app.test/offline");
  });
  test("only simple page loads are handled: posts, other sites and background requests are left alone", async () => {
    const w = bootWorker();
    await w.fire("install");
    expect(await w.fire("fetch", w.nav("/acme/money", { method: "POST" }))).toBeNull();
    expect(await w.fire("fetch", { request: { url: "https://other.test/x", method: "GET", mode: "navigate" } })).toBeNull();
    expect(await w.fire("fetch", { request: { url: "https://app.test/acme/money?_rsc=1", method: "GET", mode: "cors" } })).toBeNull();
  });
  test("only the most recent pages are kept", async () => {
    const w = bootWorker();
    await w.fire("install");
    for (let i = 0; i < 70; i++) await w.fire("fetch", w.nav(`/acme/page-${i}`));
    const pages = [...w.stores.entries()].find(([n]) => n.includes("pages"))![1];
    expect(pages.size).toBeLessThanOrEqual(60);
    expect(pages.has("https://app.test/acme/page-69")).toBe(true);
    expect(pages.has("https://app.test/acme/page-0")).toBe(false);
  });
  test("a clear message wipes every saved page (sent at sign-out)", async () => {
    const w = bootWorker();
    await w.fire("install");
    await w.fire("fetch", w.nav("/acme/money"));
    await w.fire("message", { data: { type: "clear" } });
    w.state.online = false;
    expect(await (await w.fire("fetch", w.nav("/acme/money")))!.text()).toBe("page https://app.test/offline");
  });
});

describe("the service worker: files", () => {
  test("built scripts and icons are kept and served without asking the network again", async () => {
    const w = bootWorker();
    await w.fire("install");
    const req = { request: { url: "https://app.test/_next/static/chunks/app.js", method: "GET", mode: "no-cors" } };
    await (await w.fire("fetch", req))!.text();
    const before = w.state.fetched.length;
    expect(await (await w.fire("fetch", req))!.text()).toBe("page https://app.test/_next/static/chunks/app.js");
    expect(w.state.fetched.length).toBe(before);
  });
  test("a failed file is not kept", async () => {
    const w = bootWorker();
    await w.fire("install");
    w.state.respond = () => new Response("nope", { status: 404 });
    const req = { request: { url: "https://app.test/_next/static/chunks/missing.js", method: "GET", mode: "no-cors" } };
    await w.fire("fetch", req);
    w.state.respond = (u) => new Response(`page ${u}`);
    await w.fire("fetch", req);
    expect(w.state.fetched.filter((u) => u.endsWith("missing.js")).length).toBe(2);
  });
});

describe("the service worker: push still works", () => {
  test("a push shows a notification", async () => {
    const w = bootWorker();
    await w.fire("push", { data: { json: () => ({ title: "Payment received", href: "/acme/money" }) } });
    expect(w.state.notified).toEqual(["Payment received"]);
  });
});
