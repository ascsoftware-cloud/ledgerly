import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import { installRequestShop } from "./shopify";

const SECRET = "hush";
const NOW = new Date("2026-11-14T10:00:00Z");
const ts = (offsetSeconds = 0) => String(Math.floor(NOW.getTime() / 1000) + offsetSeconds);

/** Shopify signs the query the same way as for the OAuth callback: sorted name=value pairs, HMAC-SHA256, hex. */
function signed(fields: Record<string, string>, secret = SECRET): URLSearchParams {
  const message = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const p = new URLSearchParams(fields);
  p.set("hmac", createHmac("sha256", secret).update(message).digest("hex"));
  return p;
}

describe("installRequestShop: the request Shopify sends to the App URL when a merchant installs", () => {
  test("a genuine, recent request gives the store's address", () => {
    const p = signed({ shop: "cool-store.myshopify.com", timestamp: ts(-30), host: "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvY29vbC1zdG9yZQ" });
    expect(installRequestShop(p, SECRET, NOW)).toBe("cool-store.myshopify.com");
  });
  test("a request signed with another secret, or changed after signing, is refused", () => {
    expect(installRequestShop(signed({ shop: "cool-store.myshopify.com", timestamp: ts() }, "other"), SECRET, NOW)).toBeNull();
    const p = signed({ shop: "cool-store.myshopify.com", timestamp: ts() });
    p.set("shop", "evil-store.myshopify.com");
    expect(installRequestShop(p, SECRET, NOW)).toBeNull();
  });
  test("an unsigned request is refused", () => {
    expect(installRequestShop(new URLSearchParams({ shop: "cool-store.myshopify.com", timestamp: ts() }), SECRET, NOW)).toBeNull();
  });
  test("an old request (a replayed link) is refused, and so is one dated in the future", () => {
    expect(installRequestShop(signed({ shop: "cool-store.myshopify.com", timestamp: ts(-7200) }), SECRET, NOW)).toBeNull();
    expect(installRequestShop(signed({ shop: "cool-store.myshopify.com", timestamp: ts(3600) }), SECRET, NOW)).toBeNull();
  });
  test("a missing or odd timestamp is refused", () => {
    expect(installRequestShop(signed({ shop: "cool-store.myshopify.com" }), SECRET, NOW)).toBeNull();
    expect(installRequestShop(signed({ shop: "cool-store.myshopify.com", timestamp: "soon" }), SECRET, NOW)).toBeNull();
  });
  test("an address that is not a myshopify.com store is refused even when correctly signed", () => {
    expect(installRequestShop(signed({ shop: "evil.example.com", timestamp: ts() }), SECRET, NOW)).toBeNull();
    expect(installRequestShop(signed({ shop: "cool-store.myshopify.com.evil.com", timestamp: ts() }), SECRET, NOW)).toBeNull();
  });
});
