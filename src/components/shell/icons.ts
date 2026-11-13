import { BarChart3, Briefcase, Calculator, FolderOpen, Home, Menu, Package, ShoppingBag, Truck, Users, Wallet, type LucideIcon } from "lucide-react";
import type { IconName } from "./nav";

export const NAV_ICONS: Record<IconName, LucideIcon> = {
  home: Home,
  wallet: Wallet,
  users: Users,
  briefcase: Briefcase,
  package: Package,
  chart: BarChart3,
  folder: FolderOpen,
  calculator: Calculator,
  truck: Truck,
  "shopping-bag": ShoppingBag,
  menu: Menu,
};
