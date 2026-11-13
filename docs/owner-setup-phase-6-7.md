# Owner set-up, part 2: AI, push, billing, legal details, monitoring, deploy

Continues the checklist in the [README](../README.md) (sections A to F). Every step here is optional until you want that feature; the app tells people plainly when something is not switched on.

## G. The AI helper (Groq)

1. Create a free account at [console.groq.com](https://console.groq.com) and open **API Keys > Create API Key**. Copy it (shown once).
2. In Vercel > Settings > Environment Variables (Production) add `AI_PROVIDER` = `groq` and `AI_API_KEY` = the key.
3. In the Groq console switch on **Zero Data Retention** (Settings, Data Controls).
4. Optional: `AI_MODEL` and `AI_VISION_MODEL` if Groq retires the defaults (`llama-3.3-70b-versatile` and `qwen/qwen3.8-27b`, checked against Groq's docs on 2026-11-13). See [console.groq.com/docs/models](https://console.groq.com/docs/models).
5. Redeploy. Then More > AI helper > switch it on for a business and ask a question.

Not verified here: whether the chat model handles tool calls the way the app expects. The first real question will show it; if it answers "couldn't answer that", try the other production model.

## H. Push notifications

Generate a key pair once (`npx web-push generate-vapid-keys`) and add, in Vercel: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (for example `mailto:hello@ascsoftware.co.za`). Redeploy, then More > Notification settings > turn on this device. Keep the pair: replacing it makes everyone turn push on again.

## I. Pro subscriptions (PayFast, Ledgerly's own account)

1. You need a PayFast merchant account for ASC with **recurring billing** enabled, and a **passphrase** set (Settings > Integration).
2. In Vercel add `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE` and `PAYFAST_MODE` (`sandbox` to try it, `live` for real money).
3. Until all three values are set, the upgrade button says paying is not switched on.
4. The price is R199 a month in `src/lib/plans.ts`. Change it there if you want a different price.
5. The notification address PayFast must reach is `<site>/api/webhooks/payfast-billing` (the app sends it with each checkout).
6. Try it in the sandbox first: More > Plan and billing > Upgrade. PayFast's sandbox does not show the subscription token, so cancelling from the app needs a live subscription to test properly.

Not verified here: PayFast's field names and cancel API were checked against reference code and PayFast's API reference, not a live sandbox (their developer site could not be read directly). A sandbox run is the real test.

## J. Company details for the legal pages

Add in Vercel: `NEXT_PUBLIC_COMPANY_NAME`, `NEXT_PUBLIC_COMPANY_REG` (registration number), `NEXT_PUBLIC_COMPANY_ADDRESS`, `NEXT_PUBLIC_INFO_OFFICER` (name of the information officer), and optionally `NEXT_PUBLIC_CONTACT_EMAIL` and `NEXT_PUBLIC_DATA_REGION`. Until the first four are set, the privacy, terms and POPIA pages show **[to confirm]** and a "draft" notice.

The pages are drafts. Have a lawyer read them before launch, in particular: the refund terms and the limit of liability in the terms, the PAIA manual link, and whether a registered information officer is needed. If you want to change what is said, the text is in `src/app/(marketing)/`.

## K. Monitoring

- **Uptime:** point a free monitor (for example UptimeRobot) at `https://<your domain>/api/health`. It returns 200 when the app and database answer and 503 when the database does not.
- **Errors:** create a free [Sentry](https://sentry.io) project (Next.js is fine), copy its DSN and add it in Vercel as `SENTRY_DSN`. The app sends only the error type, a message with emails and tokens removed, the route and method. Until set, errors are only written to the Vercel logs as JSON lines.
- **Logs:** Vercel > the project > Logs. Each line is JSON with `level`, `event` and `time`; secrets and personal details are hidden by field name.

## L. Backups

Supabase's **Free** plan has no downloadable backups and no point-in-time restore, so a restore test cannot be done on it. Before real customer data goes in, either upgrade the Supabase project to Pro (daily backups, and you can restore into a new project to prove it works) or schedule regular exports. Do one test restore and write down the date and result in `docs/launch-report.md`.

## M. Deploy and smoke test

The app is deployed from the `main` branch on Vercel at `business.ascsoftware.co.za`. After each deploy:

```bash
BASE_URL=https://business.ascsoftware.co.za npm run smoke
```

It makes read-only requests (the pages, health check, manifest, security headers, robots, sitemap) and signs nobody in.

Before going live also set in Vercel: `NEXT_PUBLIC_SITE_URL` to the live address, and in Supabase > Authentication > URL Configuration the site URL and redirect URLs for the live domain (README section B).
