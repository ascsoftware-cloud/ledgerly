export type OutgoingEmail = {
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  /** Resend refuses a second send with the same key, so a retry cannot duplicate. */
  idempotencyKey: string;
};

export type SendResult = { ok: true; id: string } | { ok: false; error: string };
export type Transport = (m: OutgoingEmail) => Promise<SendResult>;

export function resendTransport(opts: { apiKey: string; from: string; fetch?: typeof fetch }): Transport {
  const doFetch = opts.fetch ?? fetch;
  return async (m) => {
    try {
      const res = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": m.idempotencyKey,
        },
        body: JSON.stringify({
          from: opts.from,
          to: [m.to],
          reply_to: m.replyTo ?? undefined,
          subject: m.subject,
          html: m.html,
          text: m.text,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (res.ok && body.id) return { ok: true, id: body.id };
      return { ok: false, error: `Resend ${res.status}: ${(body.message ?? "no message").slice(0, 200)}` };
    } catch (e) {
      return { ok: false, error: `Network: ${(e as Error).message.slice(0, 200)}` };
    }
  };
}

/** Development stand-in: prints the email instead of sending it. */
export const logTransport: Transport = async (m) => {
  console.info(`[email] to=${m.to} subject="${m.subject}"`);
  return { ok: true, id: `log-${m.idempotencyKey}` };
};
