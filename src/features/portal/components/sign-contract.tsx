"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signFromPortal, type SignState } from "../public-actions";

const W = 600;
const H = 200;

/** A small canvas to draw a mark with a finger or mouse. Optional: typing the name is enough. */
function SignaturePad({ onChange }: { onChange: (png: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.stroke();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setDirty(true);
    if (ref.current) onChange(ref.current.toDataURL("image/png"));
  };
  const clear = () => {
    ref.current?.getContext("2d")?.clearRect(0, 0, W, H);
    setDirty(false);
    onChange("");
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={ref}
        width={W}
        height={H}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        aria-label="Draw your signature (optional)"
        className="h-40 w-full touch-none rounded-xl border bg-background"
      />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Draw your signature here if you like. It is optional.</span>
        {dirty && (
          <Button type="button" variant="ghost" size="touch" onClick={clear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/** Typed name (required), optional drawn mark, and the plain statement of what this signature is. */
export function SignContract({ token, contractId, clientName }: { token: string; contractId: string; clientName: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [state, action, pending] = useActionState<SignState, FormData>(async (prev, form) => {
    const r = await signFromPortal(token, contractId, prev, form);
    if (r.status === "signed") router.refresh();
    return r;
  }, { status: "idle" });

  if (state.status === "signed")
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl bg-accent p-4 font-medium">
        <CheckCircle2 className="size-6 text-success" aria-hidden /> Thank you. The contract is signed.
      </p>
    );

  return (
    <form action={action} noValidate aria-label="Sign this contract" className="space-y-4 rounded-2xl border bg-card p-5 shadow-card">
      <h2 className="text-lg font-semibold">Sign this contract</h2>
      <label className="block space-y-1 text-sm font-medium">
        Type your full name
        <Input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={clientName} autoComplete="name" className="h-12 text-base" />
      </label>
      <SignaturePad onChange={setImage} />
      <input type="hidden" name="image" value={image} />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="agree" className="mt-0.5 size-5 accent-primary" />
        <span>I have read this contract and agree to be bound by it. I understand that typing my name (and drawing my signature, if I did) is my electronic signature.</span>
      </label>
      <p className="text-xs text-muted-foreground">
        This is an ordinary electronic signature under the Electronic Communications and Transactions Act. It is not an &ldquo;advanced electronic signature&rdquo;. We record your name, the time, your device and a fingerprint of the contract as you saw it.
      </p>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <Button type="submit" size="touch" className="w-full" disabled={pending}>
        {pending ? "Signing…" : "Sign the contract"}
      </Button>
    </form>
  );
}
