'use client';

import {
  LayoutDashboard,
  Settings,
  Building2,
  Users,
  Shield,
  CreditCard,
  ScrollText,
  Puzzle,
  Package,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  Search,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useSession } from '@/lib/auth/session-context';
import { useNavigation } from '@/lib/entitlements';
import { hasPermission } from '@/lib/permissions';

import { cn } from '../cn';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  /** Only highlight on the exact path, not child routes (hubs with their own sub-items). */
  exact?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const MODULE_ICONS: Record<string, LucideIcon> = {
  crm: Users,
  inventory: Package,
  pos: DollarSign,
};

interface SidebarProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Sidebar({ collapsed = false, onCollapsedChange }: SidebarProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const { organizationId, permissions } = useSession();
  const { data: navigation, isLoading: navigationLoading } = useNavigation();

  // Extract locale from pathname
  const locale = pathname.split('/')[1] ?? 'en';

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
  ];

  const navSections: NavSection[] = [{ label: t('nav.platform'), items: platformItems }];

  if (organizationId !== null && navigation && navigation.length > 0) {
    navSections.push({
      label: t('nav.modulesLabel'),
      items: navigation.flatMap((group) =>
        group.items.map((item) => ({
          icon: MODULE_ICONS[group.moduleKey] ?? Puzzle,
          label: t(item.labelKey),
          href: `/${locale}${item.href}`,
        })),
      ),
    });
  }

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

      {/* Search (expanded only) */}
      {!collapsed && (
        <div className="px-3 py-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input placeholder={t('shell.search')} className="h-8 ps-8 text-sm" aria-label={t('shell.search')} />
          </div>
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
