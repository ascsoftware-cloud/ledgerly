import { Briefcase, Home, Menu, Package, Users, Wallet, type LucideIcon } from "lucide-react";
import type { IconName } from "./nav";

export const NAV_ICONS: Record<IconName, LucideIcon> = {
  home: Home,
  wallet: Wallet,
  users: Users,
  briefcase: Briefcase,
  package: Package,
  menu: Menu,
};
