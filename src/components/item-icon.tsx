import {
  Bug, CircleHelp, CreditCard, FileText, Folder, HardDrive, KeyRound, Laptop, Mail, Monitor, Package, Printer, RefreshCcw, Shield, ShoppingBag, Smartphone, Truck, UserMinus, UserPlus, Wifi, Wrench,
  type LucideIcon,
} from "lucide-react";

/** Icon names usable as `icon:` in business.config.yaml (ticket types and catalog items). */
export const ITEM_ICONS: Record<string, LucideIcon> = {
  bug: Bug, "help-circle": CircleHelp, question: CircleHelp, "credit-card": CreditCard, file: FileText, folder: Folder, "hard-drive": HardDrive, key: KeyRound,
  laptop: Laptop, mail: Mail, monitor: Monitor, package: Package, printer: Printer, refund: RefreshCcw, "refresh-ccw": RefreshCcw, shield: Shield,
  "shopping-bag": ShoppingBag, phone: Smartphone, truck: Truck, "user-minus": UserMinus, "user-plus": UserPlus, wifi: Wifi, wrench: Wrench,
};

export function ItemIcon({ name, fallback = Package, className }: { name?: string | null; fallback?: LucideIcon; className?: string }) {
  const Icon = (name && ITEM_ICONS[name]) || fallback;
  return <Icon className={className} aria-hidden />;
}
