# Ledgerly

All-in-one business manager for South African small businesses. Working name.

- Spec: [docs/spec.md](docs/spec.md)
- Plan: [docs/plan.md](docs/plan.md)
- Research: [docs/research.md](docs/research.md)

## Develop

```bash
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run check` | Lint, typecheck and unit tests. Must pass before any commit. |
| `npm run e2e` | Builds the app and runs Playwright tests against it. |
| `npm run build` | Production build. |

## Environment

Copy `.env.example` to `.env.local` and fill it in. `.env.local` is never committed.

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally; your domain in production |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard > Project Settings > API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same page, "Publishable key" |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page, "Secret key". Server only. Never prefix with `NEXT_PUBLIC_` |
| `RESEND_API_KEY` | Resend > API Keys (step 13 below). Sends invoices, quotes and reminders |
| `EMAIL_FROM` | A sender on your verified Resend domain, e.g. `Ledgerly <invoices@mail.yourdomain.co.za>` |
| `JOBS_SECRET` | Must equal the Vault secret `jobs_secret` (see section D). Lets the database's scheduled jobs call the app |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | ASC's Xero app (section F). Optional |
| `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | ASC's Shopify app (section F). Optional |
| `SAGE_API_KEY` | Issued by Sage to ASC (section F). Optional |

## Owner set-up checklist (sign-in)

Supabase project: **Ledgerly** (`znufbvcjqdrpcyqiofrz`, region eu-west-1).

### A. Google sign-in
1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project called "Ledgerly".
2. APIs & Services > OAuth consent screen: choose **External**, enter the app name, your support email and developer email. Scopes: `email`, `profile`, `openid` only.
3. APIs & Services > Credentials > Create credentials > **OAuth client ID** > Web application.
4. Authorised JavaScript origins: `http://localhost:3000` and, later, your live domain.
5. Authorised redirect URI (exactly): `https://znufbvcjqdrpcyqiofrz.supabase.co/auth/v1/callback`
6. Copy the Client ID and Client secret.
7. Supabase dashboard > Authentication > Sign In / Providers > **Google**: switch on, paste the Client ID and secret, save.
8. On the same Providers page, make sure every other provider (Apple, GitHub and so on) is **off**, and under Email turn **off** "Allow password sign-in" if the option is shown.

### B. Redirect URLs
9. Supabase dashboard > Authentication > URL Configuration. Site URL: `http://localhost:3000` for now (change to the live domain at launch).
10. Add these Redirect URLs: `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/confirm`, and the same two paths on the live domain once you have it.

### C. Email sign-in (magic link plus 6-digit code)
11. Create a free [Resend](https://resend.com) account. Add your sending domain (for example `mail.yourdomain.co.za`).
12. Resend shows DNS records. Add all of them at your domain registrar: the **SPF** (TXT) and **DKIM** (TXT/CNAME) records Resend lists, plus a **DMARC** record: TXT on `_dmarc.yourdomain.co.za` with value `v=DMARC1; p=none; rua=mailto:you@yourdomain.co.za`. Wait until Resend shows the domain as verified.
13. Resend > API Keys > create a key with "Sending access".
14. Supabase dashboard > Authentication > Emails > SMTP Settings: enable custom SMTP. Host `smtp.resend.com`, port `465`, username `resend`, password = the Resend API key, sender `hello@yourdomain.co.za`, sender name `Ledgerly`.
15. Supabase dashboard > Authentication > Emails > Templates > **Magic Link**. Replace the body with:

    ```html
    <h2>Sign in to Ledgerly</h2>
    <p>Tap the button on this device:</p>
    <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in</a></p>
    <p>Or enter this code: <strong>{{ .Token }}</strong></p>
    <p>The link and code expire in 10 minutes. If you did not ask for this, ignore this email.</p>
    ```
16. Paste the same body into the **Confirm signup** template (a first-time email sign-in uses that one).
17. Authentication > Sign In / Providers > Email: set "Email OTP expiration" to `600` seconds and "Email OTP length" to `6`.

Until steps 11 to 14 are done, Supabase's built-in mailer still works for testing, limited to a few emails an hour and only to members of your Supabase organisation.

## Owner set-up checklist (getting paid and sending email)

### D. Sending invoices, quotes and reminders by email
18. In Vercel > the project > Settings > Environment Variables (Production), add `RESEND_API_KEY` and `EMAIL_FROM` (table above).
19. Supabase dashboard > Integrations > Vault: open the secret `jobs_secret` and copy its value. Add it in Vercel as `JOBS_SECRET`. The Vault secret `site_url` must be your live domain (it is set to `https://business.ascsoftware.co.za`).
20. Redeploy in Vercel so the new variables load. Emails queue while these are missing and go out once they are set.

### E. Card and instant EFT payments (each business connects its own account)
Ledgerly never holds client money: each business pastes its own keys on **More > Getting paid**. Keys are stored encrypted in Supabase Vault, not in the database tables.
21. **Yoco:** in the Yoco Business Portal, open the online payments (developer) section and find your API keys. Paste the secret key (`sk_test_…` to try it out, `sk_live_…` for real payments). Ledgerly registers its own webhook with Yoco when you connect.
22. **PayFast:** in the PayFast dashboard's settings, find the developer (integration) settings. Paste the Merchant ID, Merchant key and the passphrase you set there. Use a sandbox account from [sandbox.payfast.co.za](https://sandbox.payfast.co.za) to try it out first.
23. **EFT:** add your bank details on the same page. They appear on every invoice, and you record EFT payments by hand.
24. Optional: switch on **Payment reminders** on the same page. Clients with an email address get a reminder 3 days before an invoice is due, on the day, and 3 days after.

### F. Apps: Xero, Sage, Courier Guy, Shopify (More > Apps) and Stitch (More > Getting paid)
Plan and verified API rules: [docs/plans/integrations.md](docs/plans/integrations.md). Each app is optional.
25. **Xero:** at developer.xero.com create a *Web app* owned by ASC. Redirect URI: `<site>/api/oauth/xero/callback`. Put its client id and secret in Vercel as `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`. The free Starter tier allows 5 connected organisations; every business that connects Xero counts as one.
26. **Shopify:** in the Shopify Dev Dashboard create an app owned by ASC with redirect URL `<site>/api/oauth/shopify/callback` and scopes `read_products, read_inventory, read_locations, read_orders`. Set the compliance webhooks (customer data request, customer redact, shop redact) to `<site>/api/webhooks/shopify`. Put the client id and secret in Vercel as `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`. To connect stores you do not own, the app needs public distribution (Shopify review) or custom distribution per store.
27. **Sage (South Africa):** request an API key from Sage (accounting.sageone.co.za developer programme, enrollment form and licence agreement) and put it in Vercel as `SAGE_API_KEY`. Each business then signs in with its own Sage login on the Apps page.
28. **Courier Guy:** nothing for ASC to set up. Each business pastes its own Ship Logic API key on the Apps page (sandbox accounts: tcg-sandbox.shiplogic.com).
29. **Stitch:** nothing for ASC to set up. Each business with a Stitch client pastes its client id and secret on **Getting paid**, asks Stitch to allow redirects to the site, and (optionally) adds the webhook address shown there.
30. Apply migrations `0050`–`0055` and run `supabase/tests/0050_integrations.test.sql` (expect `0 failed`).

