/** Copy and links for setup-quest steps. The database (quest_steps) stores only keys and state. */

export const QUEST = {
  business_details: {
    title: "Add your business details",
    body: "Your name and contact details, ready for your invoices.",
    section: "more",
  },
  first_client: {
    title: "Add your first client",
    body: "Just a name and an email or phone number.",
    section: "clients",
  },
  first_invoice: {
    title: "Send your first invoice",
    body: "By email or WhatsApp, in under a minute.",
    section: "money",
  },
  get_paid_setup: {
    title: "Set up how you get paid",
    body: "Connect Yoco or PayFast, or add your bank details for EFT.",
    section: "more",
  },
  first_expense: {
    title: "Log an expense",
    body: "Snap a receipt so tax time is easy.",
    section: "money",
  },
  first_task: {
    title: "Add your first task",
    body: "Keep track of what's due and who's on it.",
    section: "work",
  },
  first_product: {
    title: "Add a product",
    body: "Set a price and how many you have in stock.",
    section: "stock",
  },
  booking_page: {
    title: "Set your availability",
    body: "Let clients book a time that suits you both.",
    section: "work",
  },
  invite_team: {
    title: "Invite your team",
    body: "Everyone gets their own sign-in. No extra cost.",
    section: "more",
  },
} as const;

export type QuestKey = keyof typeof QUEST;

export const QUEST_XP = 30;

export function isQuestKey(v: string): v is QuestKey {
  return v in QUEST;
}

export function questHref(key: QuestKey, slug: string): string {
  return `/${slug}/${QUEST[key].section}`;
}
