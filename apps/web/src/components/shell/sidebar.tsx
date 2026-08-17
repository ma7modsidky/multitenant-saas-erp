'use client';

import {
  BookOpenText,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  DollarSign,
  LayoutDashboard,
  Package,
  Puzzle,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useSession } from '@/lib/auth/session-context';
import { useNavigation } from '@/lib/entitlements';
import { hasPermission } from '@/lib/permissions';

import { cn } from '../cn';
import { Button } from '../ui/button';

import { NAV_ICONS } from './nav-icons';
import { SidebarSearch } from './sidebar-search';

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  /** Only highlight on the exact path, not child routes (hubs with their own sub-items). */
  exact?: boolean;
  /** Nested sub-routes — e.g. inventory Stock → Movements / Transfers / Reservations. */
  children?: NavItem[];
}

/** One module's links — rendered as a collapsible parent in the Modules section. */
interface ModuleNavGroup {
  moduleKey: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

interface NavSection {
  label: string;
  items: NavItem[];
  /** When set, the section renders collapsible module dropdowns instead of a flat list. */
  groups?: ModuleNavGroup[];
}

const MODULE_ICONS: Record<string, LucideIcon> = {
  crm: Users,
  inventory: Package,
  pos: DollarSign,
  accounting: BookOpenText,
};

// Nav item icon names come from the module descriptors (NavigationItem.icon).

interface SidebarProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed = false, onCollapsedChange }: SidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { organizationId, permissions, isPlatformAdmin } = useSession();
  const { data: navigation, isLoading: navigationLoading } = useNavigation();

  // Extract locale from pathname
  const locale = pathname.split('/')[1] ?? 'en';

  // Which module dropdowns are open. The module owning the active route is
  // auto-expanded on navigation; manual collapses elsewhere are preserved.
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!navigation) return;
    const activeKey = navigation.find((group) =>
      group.items.some((item) => {
        const href = `/${locale}${item.href}`;
        return pathname === href || pathname.startsWith(href + '/');
      }),
    )?.moduleKey;
    if (!activeKey) return;
    setExpandedModules((prev) => (prev[activeKey] ? prev : { ...prev, [activeKey]: true }));
  }, [pathname, navigation, locale]);

  // AUTHZ-5/BUSINESS_RULES §3: platform-management settings are OWNER/ADMIN
  // only. The backend enforces this via @RequiresPermission; the sidebar hides
  // entries the user cannot use (server-authoritative — UX only).
  const canManageMembers = hasPermission(permissions, 'platform:members:invite');
  const canManageRoles = hasPermission(permissions, 'platform:roles:manage');
  const canManageBilling = hasPermission(permissions, 'platform:billing:manage');
  const canViewAudit = hasPermission(permissions, 'platform:audit:view');

  const platformItems: NavItem[] = [
    // Dashboard and Settings are hubs: their children (or the settings sub-
    // pages) are separate nav items, so only the exact path should highlight.
    { icon: LayoutDashboard, label: t('nav.dashboard'), href: `/${locale}`, exact: true },
    { icon: Building2, label: t('nav.organizations'), href: `/${locale}/settings/organization` },
    ...(canManageMembers ? [{ icon: Users, label: t('nav.members'), href: `/${locale}/settings/members` }] : []),
    ...(canManageRoles ? [{ icon: Shield, label: t('nav.roles'), href: `/${locale}/settings/roles` }] : []),
    ...(canManageBilling ? [{ icon: CreditCard, label: t('nav.billing'), href: `/${locale}/settings/billing` }] : []),
    ...(canViewAudit ? [{ icon: ScrollText, label: t('nav.audit'), href: `/${locale}/settings/audit` }] : []),
    { icon: Settings, label: t('nav.settings'), href: `/${locale}/settings`, exact: true },
    // Platform Admin Console — visible only to superusers (PLT-1). The
    // backend + client gate remain authoritative; this is UX only (OPS-8).
    ...(isPlatformAdmin ? [{ icon: ShieldCheck, label: t('nav.admin'), href: `/${locale}/admin`, exact: true }] : []),
  ];

  // Group each entitled module's links under its own parent instead of one
  // flat list — e.g. CRM → Contacts / Companies / Deals / Activities.
  const moduleGroups: ModuleNavGroup[] =
    navigation
      ?.filter((group) => group.items.length > 0)
      .map((group) => ({
        moduleKey: group.moduleKey,
        label: t(group.labelKey),
        icon: MODULE_ICONS[group.moduleKey] ?? Puzzle,
        items: group.items.map((item) => {
          const navItem: NavItem = {
            icon: (item.icon && NAV_ICONS[item.icon]) || MODULE_ICONS[group.moduleKey] || Puzzle,
            label: t(item.labelKey),
            href: `/${locale}${item.href}`,
          };
          // exactOptionalPropertyTypes: only set children when the descriptor
          // has them — a plain `children: item.children?.map(...)` would hand
          // `undefined` into the optional property.
          if (item.children && item.children.length > 0) {
            navItem.children = item.children.map((child) => ({
              icon: (child.icon && NAV_ICONS[child.icon]) || MODULE_ICONS[group.moduleKey] || Puzzle,
              label: t(child.labelKey),
              href: `/${locale}${child.href}`,
            }));
          }
          return navItem;
        }),
      })) ?? [];

  const navSections: NavSection[] = [{ label: t('nav.platform'), items: platformItems }];

  if (moduleGroups.length > 0) {
    navSections.push({ label: t('nav.modulesLabel'), items: [], groups: moduleGroups });
  }

  const toggleModule = (moduleKey: string) =>
    setExpandedModules((prev) => ({ ...prev, [moduleKey]: !prev[moduleKey] }));

  return (
    <aside
      className={cn(
        'fixed start-0 top-0 z-40 flex h-screen flex-col border-e bg-background transition-all duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Logo area */}
      <div className={cn('flex h-14 items-center border-b px-4', collapsed ? 'justify-center' : 'justify-between')}>
        <Link href={`/${locale}`} className="flex items-center gap-2" aria-label="ModuBiz Home">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            M
          </div>
          {!collapsed && <span className="text-base font-semibold">ModuBiz</span>}
        </Link>
      </div>

      {/* Federated search (expanded only) */}
      {!collapsed && (
        <div className="px-3 py-3">
          <SidebarSearch />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {navSections.map((section) => (
          <div key={section.label} className="mb-4">
            {!collapsed && (
              <p className="px-3 pb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {section.label}
              </p>
            )}
            {section.groups && section.groups.length > 0 ? (
              <ul className="space-y-0.5">
                {section.groups.map((group) => {
                  const isOpen = expandedModules[group.moduleKey] ?? false;
                  const groupActive = group.items.some(
                    (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
                  );
                  if (collapsed) {
                    // Collapsed rail has no room for dropdowns — flatten each
                    // module's links (including nested children) into icon-only
                    // shortcuts (tooltip = label).
                    const flatItems = group.items.flatMap((item) => [item, ...(item.children ?? [])]);
                    return flatItems.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="flex items-center justify-center rounded-md px-2 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-accent-foreground"
                          title={item.label}
                        >
                          <item.icon className="size-4 shrink-0" aria-hidden="true" />
                        </Link>
                      </li>
                    ));
                  }
                  return (
                    <li key={group.moduleKey}>
                      <button
                        type="button"
                        onClick={() => toggleModule(group.moduleKey)}
                        aria-expanded={isOpen}
                        aria-controls={`sidebar-module-${group.moduleKey}`}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          groupActive
                            ? 'text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                        )}
                      >
                        <group.icon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{group.label}</span>
                        <ChevronDown
                          className={cn(
                            'ms-auto size-4 shrink-0 text-muted-foreground transition-transform',
                            isOpen && 'rotate-180',
                          )}
                          aria-hidden="true"
                        />
                      </button>
                      {isOpen && (
                        <ul id={`sidebar-module-${group.moduleKey}`} className="mt-0.5 space-y-0.5">
                          {group.items.map((item) => {
                            // Child routes (e.g. /m/crm/deals/table or
                            // /m/inventory/stock/movements) highlight their
                            // parent page link via the prefix match.
                            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                            return (
                              <li key={item.href} className="space-y-0.5">
                                <Link
                                  href={item.href}
                                  className={cn(
                                    'ms-6 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                                    isActive
                                      ? 'bg-accent text-accent-foreground'
                                      : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                                  )}
                                  title={collapsed ? item.label : undefined}
                                >
                                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                                  <span className="truncate">{item.label}</span>
                                </Link>
                                {item.children && item.children.length > 0 && (
                                  <ul className="space-y-0.5">
                                    {item.children.map((child) => {
                                      const childActive =
                                        pathname === child.href || pathname.startsWith(child.href + '/');
                                      return (
                                        <li key={child.href}>
                                          <Link
                                            href={child.href}
                                            className={cn(
                                              'ms-12 flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                                              childActive
                                                ? 'bg-accent text-accent-foreground'
                                                : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                                            )}
                                            title={collapsed ? child.label : undefined}
                                          >
                                            <child.icon className="size-3.5 shrink-0" aria-hidden="true" />
                                            <span className="truncate">{child.label}</span>
                                          </Link>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  // Hub items (dashboard root, settings) only highlight on the
                  // exact path — a prefix match on `/${locale}/` would light the
                  // dashboard up on every page, and the settings hub would
                  // double-highlight alongside its sub-items. Other items
                  // highlight on exact or child routes.
                  const isActive = item.exact
                    ? pathname === item.href
                    : pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                          collapsed && 'justify-center px-2',
                        )}
                        title={collapsed ? item.label : undefined}
                      >
                        <item.icon className="size-4 shrink-0" aria-hidden="true" />
                        {!collapsed && <span className="truncate">{item.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}

        {organizationId !== null && !navigationLoading && navigation && navigation.length === 0 && (
          <p className="px-3 pb-1.5 text-xs text-muted-foreground">
            {t('dashboard.noModulesHint')}
            <Link href={`/${locale}/settings/modules`} className="ms-1 font-medium text-primary hover:underline">
              {t('nav.modules')}
            </Link>
          </p>
        )}
      </nav>

      {/* Bottom section */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn('mt-1 w-full', collapsed && 'justify-center')}
          onClick={() => onCollapsedChange?.(!collapsed)}
          aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <>
              <ChevronLeft className="size-4" />
              <span className="text-xs">{t('shell.collapseSidebar')}</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
}
