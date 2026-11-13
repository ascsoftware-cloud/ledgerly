import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The service-role client bypasses row-level security, so only these places may use it.
 * Adding a path here is a security decision: review it as one.
 */
const SERVICE_ROLE_ALLOWED = [
  "src/lib/supabase/admin.ts",
  // Calls public.hit_rate_limit only (sign-in and public endpoint throttling).
  "src/lib/rate-limit.ts",
  "src/app/api/webhooks/**",
  // Scheduled and queued work (outbox sending). Every query there filters by workspace itself.
  "src/app/api/jobs/**",
  "src/server/jobs/**",
  // Payment checkouts read the business's own provider keys from Vault.
  "src/server/payments/checkout.ts",
  "src/server/payments/connections.ts",
  "src/server/bookings/create.ts",
  // The contract signature records the visitor's IP and device, so only the server may call sign_contract.
  "src/server/portal/sign.ts",
  // The AI allowance functions are callable by the server only, so a person cannot skip their limits.
  "src/server/ai/allowance.ts",
  // Billing: only a verified PayFast notification or the signed-in owner (checked first) may change a plan.
  "src/server/billing/service.ts",
  // The daily purge deletes what people asked to have deleted 7 days ago (business files, rows, accounts).
  "src/server/privacy/run-purge.ts",
  // Export downloads are parked in a private bucket only the server can reach, then handed out as a 60-second link.
  "src/server/privacy/export-store.ts",
  // Outside apps (Courier Guy, Shopify, Xero, Sage) read their credentials from Vault and run
  // queued jobs. Functions there take a workspace or connection id the caller already authorised.
  "src/server/integrations/**",
  "src/features/account/delete-account.ts",
  "supabase/functions/**",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,mts}"],
    ignores: SERVICE_ROLE_ALLOWED,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/supabase/admin", "**/supabase/admin"],
              message:
                "The service-role client bypasses RLS. It may only be imported by webhooks, scheduled functions and account deletion.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
