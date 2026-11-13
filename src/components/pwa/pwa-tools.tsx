"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Download, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeDevicePush } from "@/features/notifications/actions";

/** Forgets the saved copies of pages. Called at sign-out so the next person on this device sees none. */
export async function clearOfflineCopies(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "clear" });
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("ledgerly-pages-")).map((n) => caches.delete(n)));
  } catch {
    // No cache support or blocked storage: nothing was saved, so nothing to clear.
  }
}

/** Stops this device receiving the signed-in person's push alerts. Called at sign-out, while the session still exists. */
export async function forgetPushOnThisDevice(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await removeDevicePush(sub.endpoint);
    await sub.unsubscribe();
  } catch {
    // No push on this device, or offline: nothing to stop.
  }
}

/** Registers the service worker in the real app (not in development, where cached pages only confuse). */
export function ServiceWorkerRegister({ userId }: { userId?: string }) {
  useEffect(() => {
    // Pages saved for someone else are never shown to the next person on this device.
    if (userId) {
      try {
        const key = "ledgerly-cache-user";
        const previous = localStorage.getItem(key);
        if (previous && previous !== userId) void clearOfflineCopies();
        localStorage.setItem(key, userId);
      } catch {
        // Storage blocked: sign-out still clears the copies.
      }
    }
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, [userId]);
  return null;
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Says so, plainly, when the phone has no connection. */
export function OfflineBanner() {
  const offline = useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);
  if (!offline) return null;
  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <WifiOff className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p>You&apos;re offline. You can read pages you opened before, but changes can&apos;t be saved until you&apos;re back online.</p>
    </div>
  );
}

// The browser offers installation once, as an event; keep it so a button can use it later.
type InstallPrompt = Event & { prompt: () => Promise<void> };
let installEvent: InstallPrompt | null = null;
const installListeners = new Set<() => void>();
let installWired = false;
function wireInstall() {
  if (installWired || typeof window === "undefined") return;
  installWired = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as InstallPrompt;
    installListeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    installListeners.forEach((l) => l());
  });
}
function subscribeInstall(onChange: () => void) {
  wireInstall();
  installListeners.add(onChange);
  return () => void installListeners.delete(onChange);
}

function isIosBrowser() {
  const ua = navigator.userAgent;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return /iPhone|iPad|iPod/.test(ua) && !standalone;
}

/** "Install app" where the browser allows it; a short how-to on iPhone, where it does not. */
export function InstallButton() {
  const canPrompt = useSyncExternalStore(subscribeInstall, () => installEvent !== null, () => false);
  const ios = useSyncExternalStore(() => () => undefined, isIosBrowser, () => false);
  if (canPrompt) {
    return (
      <Button
        type="button"
        variant="outline"
        size="touch"
        onClick={async () => {
          const e = installEvent;
          if (!e) return;
          await e.prompt();
          installEvent = null;
          installListeners.forEach((l) => l());
        }}
      >
        <Download className="size-5" aria-hidden />
        Install the app
      </Button>
    );
  }
  if (ios) return <p className="text-sm text-muted-foreground">To install on iPhone: tap the Share button, then “Add to Home Screen”.</p>;
  return null;
}

// The browser offers installation once, soon after the page loads. Listen from the moment this file loads (every
// signed-in page does), not only once the More page opens, or the offer would be missed.
wireInstall();
