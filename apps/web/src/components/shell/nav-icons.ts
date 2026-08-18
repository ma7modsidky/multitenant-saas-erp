// Shared icon-name → LucideIcon map for navigation and search results.
// Icon names come from the module descriptors (NavigationItem.icon) and the
// search contributors (SearchResult.icon).

import {
  Activity,
  BarChart3,
  Building2,
  ClipboardList,
  Clock,
  CreditCard,
  FileText,
  Handshake,
  History,
  Lock,
  Package,
  PackageCheck,
  Receipt,
  Repeat,
  Undo2,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

export const NAV_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  'bar-chart': BarChart3,
  building: Building2,
  'clipboard-list': ClipboardList,
  clock: Clock,
  contact: Users,
  'credit-card': CreditCard,
  'file-text': FileText,
  history: History,
  lock: Lock,
  package: Package,
  'package-check': PackageCheck,
  receipt: Receipt,
  repeat: Repeat,
  target: Handshake,
  undo: Undo2,
  users: Users,
  wallet: Wallet,
  warehouse: Warehouse,
};
