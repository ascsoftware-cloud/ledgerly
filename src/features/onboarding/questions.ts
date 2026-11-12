import {
  Banknote,
  Boxes,
  Briefcase,
  CalendarDays,
  CircleDashed,
  ClipboardList,
  CreditCard,
  FileText,
  FolderKanban,
  HandCoins,
  Hammer,
  Landmark,
  LineChart,
  ListTodo,
  type LucideIcon,
  Megaphone,
  Package,
  Palette,
  Receipt,
  Rocket,
  Search,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Sprout,
  Timer,
  TrendingUp,
  User,
  Users,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  Zap,
} from "lucide-react";
import type { AnswerKey } from "./schema";

/** The eight onboarding questions, in order. Copy lives here so it is reviewed in one place. */

export type OptionValue = string | number;
export type Selection = OptionValue | OptionValue[];

export type Option = { value: OptionValue; label: string; hint?: string; icon: LucideIcon };

export type Question = {
  /** Matches the answer field, except "vibe", which sets both `accent` and `mode`. */
  id: Exclude<AnswerKey, "accent" | "mode"> | "vibe";
  kind: "single" | "multi" | "theme";
  title: string;
  subtitle?: string;
  options: Option[];
  /** Options that cannot be combined with any other (multi only). */
  exclusive?: OptionValue[];
  /** Miko's one-line reaction to the current selection. */
  react: (selection: Selection) => string;
};

const many = (s: Selection) => Array.isArray(s) && s.length > 1;

export const QUESTIONS: Question[] = [
  {
    id: "business",
    kind: "single",
    title: "What are you building?",
    options: [
      { value: "service", label: "Service business", icon: Briefcase },
      { value: "online_store", label: "Online store", icon: ShoppingBag },
      { value: "freelancer", label: "Freelancer", icon: User },
      { value: "agency", label: "Agency", icon: Megaphone },
      { value: "food", label: "Restaurant or food", icon: UtensilsCrossed },
      { value: "trades", label: "Trades", icon: Hammer },
      { value: "other", label: "Something else", icon: Sparkles },
    ],
    react: () => "Love it. Let's get you set up.",
  },
  {
    id: "team",
    kind: "single",
    title: "How big is the team?",
    options: [
      { value: "solo", label: "Just me", icon: User },
      { value: "2_5", label: "2–5 people", icon: Users },
      { value: "6_20", label: "6–20 people", icon: UsersRound },
      { value: "20_plus", label: "More than 20", icon: Landmark },
    ],
    react: (s) => (s === "solo" ? "Nice, a one-person army!" : "A crew! I'll set up roles."),
  },
  {
    id: "headaches",
    kind: "multi",
    title: "What's your biggest headache?",
    subtitle: "Pick as many as you like.",
    options: [
      { value: "getting_paid", label: "Getting paid", icon: HandCoins },
      { value: "tracking_money", label: "Tracking money", icon: LineChart },
      { value: "finding_clients", label: "Finding clients", icon: Search },
      { value: "managing_tasks", label: "Managing tasks", icon: ListTodo },
      { value: "stock", label: "Stock", icon: Boxes },
      { value: "admin", label: "Admin and paperwork", icon: ClipboardList },
    ],
    react: (s) => (many(s) ? "Noted. We'll tackle those first." : "Noted. We'll tackle that first."),
  },
  {
    id: "manage",
    kind: "multi",
    title: "What do you want to manage first?",
    subtitle: "You can switch the rest on later.",
    options: [
      { value: "invoices", label: "Invoices", icon: FileText },
      { value: "clients", label: "Clients", icon: Users },
      { value: "projects", label: "Projects", icon: FolderKanban },
      { value: "expenses", label: "Expenses", icon: Receipt },
      { value: "inventory", label: "Inventory", icon: Package },
      { value: "team", label: "Team", icon: UsersRound },
      { value: "bookings", label: "Bookings", icon: CalendarDays },
    ],
    react: (s) => (many(s) ? "Good picks. I'll switch those on." : "Good pick. I'll switch that on."),
  },
  {
    id: "paid",
    kind: "multi",
    title: "How do you get paid today?",
    subtitle: "Pick all that apply.",
    exclusive: ["none"],
    options: [
      { value: "cash", label: "Cash", icon: Banknote },
      { value: "eft", label: "EFT", icon: Landmark },
      { value: "card", label: "Card", icon: CreditCard },
      { value: "yoco", label: "Yoco", icon: Smartphone },
      { value: "payfast", label: "PayFast", icon: Zap },
      { value: "none", label: "Not yet", icon: CircleDashed },
    ],
    react: (s) =>
      Array.isArray(s) && s.includes("none")
        ? "We'll fix that."
        : many(s)
          ? "Easy. I'll add those to your invoices."
          : "Easy. I'll add that to your invoices.",
  },
  {
    id: "revenue",
    kind: "single",
    title: "Roughly what comes in each month?",
    subtitle: "Only you see this. It sets your first goal.",
    options: [
      { value: "none", label: "Nothing yet", icon: Sprout },
      { value: "under_20k", label: "Under R20k", icon: Wallet },
      { value: "20k_100k", label: "R20k – R100k", icon: TrendingUp },
      { value: "100k_500k", label: "R100k – R500k", icon: LineChart },
      { value: "500k_plus", label: "More than R500k", icon: Rocket },
    ],
    react: () => "Thanks. This sets your first goal.",
  },
  {
    id: "vibe",
    kind: "theme",
    title: "Pick your vibe",
    subtitle: "Change it any time in settings.",
    options: [{ value: "vibe", label: "Vibe", icon: Palette }],
    react: () => "Looking sharp.",
  },
  {
    id: "dailyMinutes",
    kind: "single",
    title: "How long each day?",
    subtitle: "A few minutes a day keeps the admin away.",
    options: [
      { value: 5, label: "5 minutes", hint: "Quick check-in", icon: Timer },
      { value: 10, label: "10 minutes", hint: "Steady", icon: Timer },
      { value: 15, label: "15 minutes", hint: "On top of everything", icon: Timer },
    ],
    react: () => "Deal. I'll keep you on track.",
  },
];
