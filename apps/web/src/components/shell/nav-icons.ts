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
  Handshake,
  Lock,
  Package,
  Users,
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
  lock: Lock,
  package: Package,
  target: Handshake,
  users: Users,
  warehouse: Warehouse,
};
