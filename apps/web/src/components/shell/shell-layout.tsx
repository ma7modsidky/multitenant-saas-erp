'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { cn } from '../cn';

import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

interface ShellLayoutProps {
  children: ReactNode;
}

/**
 * ShellLayout — the main authenticated app layout.
 *
 * Provides sidebar navigation + topbar + main content area.
 * Used by the (dashboard) route group.
 *
 * The sidebar collapsed state is managed here so the main
 * content offset can react to it.
 */
export function ShellLayout({ children }: ShellLayoutProps) {
  const t = useTranslations();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 md:hidden"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 start-0 z-50 md:hidden animate-slide-in">
            <Sidebar />
          </div>
        </>
      )}

      {/* Main content area */}
      <div className={cn(
        'flex flex-1 flex-col transition-all duration-200',
        sidebarCollapsed ? 'md:ms-16' : 'md:ms-64',
      )}>
        <Topbar onMenuToggle={() => setMobileSidebarOpen(!mobileSidebarOpen)} />

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
            {children}
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t py-3 px-6">
          <p className="text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} ModuBiz. {t('shell.copyright')}
          </p>
        </footer>
      </div>
    </div>
  );
}
