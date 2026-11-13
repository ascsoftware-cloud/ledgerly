"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markAllRead, markRead, removePushSubscription, savePushSubscription, setPref } from "../actions";
import { kindHelp, kindLabel, type Kind } from "../schema";

export function MarkAllRead({ slug, disabled }: { slug: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="touch"
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          await markAllRead(slug);
          router.refresh();
        })
      }
    >
      Mark all as read
    </Button>
  );
}

/** Opens what the notification is about, and marks it read on the way. */
export function NotificationLink({ slug, id, href, unread, children }: { slug: string; id: string; href: string | null; unread: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const className = `block px-4 py-3 hover:bg-muted/50 ${unread ? "font-medium" : "text-muted-foreground"}`;
  if (!href) return <div className={className}>{children}</div>;
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (unread) void markRead(slug, id).then(() => router.refresh());
      }}
    >
      {children}
    </Link>
  );
}

/** Two switches for one kind of notification. */
export function PrefRow({ slug, kind, enabled, push }: { slug: string; kind: Kind; enabled: boolean; push: boolean }) {
  const [state, setState] = useState({ enabled, push });
  const [pending, start] = useTransition();
  const save = (next: { enabled: boolean; push: boolean }) => {
    setState(next);
    start(async () => {
      const r = await setPref(slug, kind, next.enabled, next.push);
      if (!r.ok) {
        setState(state);
        toast.error("Couldn't save that. Try again.");
      }
    });
  };
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{kindLabel(kind)}</span>
        <span className="block text-sm text-muted-foreground">{kindHelp(kind)}</span>
      </span>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={state.enabled} disabled={pending} onChange={(e) => save({ enabled: e.target.checked, push: e.target.checked ? state.push : false })} className="size-5 accent-primary" />
        In the app<span className="sr-only">: {kindLabel(kind)}</span>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={state.push} disabled={pending || !state.enabled} onChange={(e) => save({ enabled: state.enabled, push: e.target.checked })} className="size-5 accent-primary" />
        Push<span className="sr-only">: {kindLabel(kind)}</span>
      </label>
    </li>
  );
}

const b64 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Turn web push on or off for this device. Needs a service worker, a permission and the owner's VAPID key. */
export function PushToggle({ slug, vapidKey }: { slug: string; vapidKey: string | null }) {
  const supported = useSyncExternalStore(
    () => () => {},
    () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    () => null,
  );
  const [on, setOn] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.getRegistration().then((reg) => reg?.pushManager.getSubscription()).then((sub) => setOn(Boolean(sub)));
  }, [supported]);

  if (supported === null) return null;
  if (!supported) return <p className="text-sm text-muted-foreground">This browser can&apos;t receive push notifications. On an iPhone, add Ledgerly to your Home Screen first.</p>;
  if (!vapidKey) return <p className="text-sm text-muted-foreground">Push notifications are not switched on for this site yet. The in-app bell works.</p>;

  const turnOn = () =>
    start(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return void toast.error("Notifications are blocked for this site. Allow them in your browser settings.");
        const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapidKey) }));
        const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        const r = await savePushSubscription(slug, { endpoint: json.endpoint ?? "", keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" } }, navigator.userAgent);
        if (!r.ok) return void toast.error("Couldn't save this device. Try again.");
        setOn(true);
        toast.success("Notifications are on for this device");
      } catch {
        toast.error("Couldn't turn notifications on here.");
      }
    });

  const turnOff = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(slug, sub.endpoint);
        await sub.unsubscribe();
      }
      setOn(false);
      toast.success("Notifications are off for this device");
    });

  return on ? (
    <Button type="button" variant="outline" size="touch" disabled={pending} onClick={turnOff}>
      Turn off on this device
    </Button>
  ) : (
    <Button type="button" size="touch" disabled={pending} onClick={turnOn}>
      Turn on notifications on this device
    </Button>
  );
}
