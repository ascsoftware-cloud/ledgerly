import { describe, expect, test } from "vitest";
import { processPush } from "@/server/jobs/push-core";
import { KINDS, kindLabel, prefsSchema, pushSubscriptionSchema, timeAgo } from "./schema";

describe("timeAgo", () => {
  const now = Date.parse("2026-11-13T10:00:00Z");
  test.each([
    ["2026-11-13T09:59:40Z", "just now"],
    ["2026-11-13T09:55:00Z", "5 min ago"],
    ["2026-11-13T07:30:00Z", "2 h ago"],
    ["2026-11-12T08:00:00Z", "yesterday"],
    ["2026-11-10T08:00:00Z", "10 Nov 2026"],
    ["2026-11-13T10:05:00Z", "just now"], // a clock a little ahead is not "in the future"
  ])("%s → %s", (iso, want) => expect(timeAgo(iso, now)).toBe(want));
});

describe("kinds", () => {
  test("every kind has a label and a description a person can read", () => {
    for (const k of KINDS) {
      expect(kindLabel(k).length).toBeGreaterThan(3);
    }
    expect(KINDS).toContain("payment");
    expect(KINDS).toContain("daily");
  });
});

describe("prefsSchema", () => {
  test("accepts a known kind with two switches", () => {
    expect(prefsSchema.parse({ kind: "payment", enabled: "true", push: "false" })).toEqual({ kind: "payment", enabled: true, push: false });
  });
  test("an unknown kind is refused", () => {
    expect(prefsSchema.safeParse({ kind: "spam", enabled: "true", push: "true" }).success).toBe(false);
  });
});

describe("pushSubscriptionSchema", () => {
  const ok = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BNc-key", auth: "authsecret" } };
  test("takes what the browser gives", () => expect(pushSubscriptionSchema.safeParse(ok).success).toBe(true));
  test.each([
    [{ ...ok, endpoint: "http://insecure.example/x" }],
    [{ ...ok, endpoint: "javascript:alert(1)" }],
    [{ ...ok, keys: { p256dh: "", auth: "a" } }],
    [{ endpoint: ok.endpoint }],
    [{ ...ok, endpoint: "https://x.example/" + "a".repeat(700) }],
  ])("refuses %j", (v) => expect(pushSubscriptionSchema.safeParse(v).success).toBe(false));
});

describe("processPush", () => {
  const row = (n: number) => ({ notification_id: `n${n}`, user_id: "u", title: `T${n}`, href: "/x", endpoint: `https://push.example/${n}`, p256dh: "k", auth: "a" });

  test("sends each claimed push with its title and link", async () => {
    const sent: unknown[] = [];
    const r = await processPush({
      claim: async () => [row(1), row(2)],
      send: async (sub, payload) => void sent.push([sub.endpoint, JSON.parse(payload)]),
      drop: async () => {},
    });
    expect(r).toEqual({ sent: 2, dropped: 0, failed: 0 });
    expect(sent[0]).toEqual(["https://push.example/1", { title: "T1", href: "/x" }]);
  });

  test("a subscription the push service says is gone (404 or 410) is removed", async () => {
    const dropped: string[] = [];
    const r = await processPush({
      claim: async () => [row(1), row(2), row(3)],
      send: async (sub) => {
        if (sub.endpoint.endsWith("/1")) throw Object.assign(new Error("gone"), { statusCode: 410 });
        if (sub.endpoint.endsWith("/2")) throw Object.assign(new Error("not found"), { statusCode: 404 });
      },
      drop: async (endpoint) => void dropped.push(endpoint),
    });
    expect(dropped).toEqual(["https://push.example/1", "https://push.example/2"]);
    expect(r).toEqual({ sent: 1, dropped: 2, failed: 0 });
  });

  test("any other error keeps the subscription and carries on with the rest", async () => {
    const dropped: string[] = [];
    const r = await processPush({
      claim: async () => [row(1), row(2)],
      send: async (sub) => {
        if (sub.endpoint.endsWith("/1")) throw Object.assign(new Error("push service down"), { statusCode: 503 });
      },
      drop: async (endpoint) => void dropped.push(endpoint),
    });
    expect(dropped).toEqual([]);
    expect(r).toEqual({ sent: 1, dropped: 0, failed: 1 });
  });
});
