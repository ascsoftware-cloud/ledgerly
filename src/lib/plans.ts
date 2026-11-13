/**
 * The two plans and what each allows. The price lives here and nowhere else: billing, the plan page and the
 * pricing page all read it. Limits that are database rules (documents, AI, automations, portal, workspaces) are
 * enforced there too; these numbers must match the migrations (see docs/plans/phase-7.md).
 */
export type PlanKey = "free" | "pro";

export const PLANS = {
  free: {
    name: "Free",
    priceCents: 0,
    documentsPerMonth: 10 as number | null,
    storageMb: 200,
    aiPerMonth: 20,
    automations: false,
    portal: false,
    hidesFooter: false,
    extraWorkspaces: false,
  },
  pro: {
    name: "Pro",
    // Proposed in the spec (§8.2): flat per workspace, unlimited users. The owner confirms before launch.
    priceCents: 19900,
    documentsPerMonth: null as number | null,
    storageMb: 10_000,
    aiPerMonth: 300,
    automations: true,
    portal: true,
    hidesFooter: true,
    extraWorkspaces: true,
  },
} as const;

/** "R199" for whole rand, "R199,50" otherwise. */
export function formatPrice(cents: number): string {
  const rand = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `R${rand}` : `R${rand},${String(rest).padStart(2, "0")}`;
}

export function storageLimitBytes(plan: PlanKey): number {
  return PLANS[plan].storageMb * 1024 * 1024;
}

/** "150 MB", "1,5 GB": for the plan page. Decimal comma, as everywhere in the app. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${Math.round(mb * 10) / 10} MB`.replace(".", ",");
  return `${Math.round((mb / 1024) * 10) / 10} GB`.replace(".", ",");
}
