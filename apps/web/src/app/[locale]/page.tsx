import { getTranslations } from 'next-intl/server';

/**
 * Home page — the main landing after login.
 *
 * In Phase 2, this will become a dashboard with widget slots
 * contributed by modules (via GET /me/navigation).
 */
export default async function HomePage() {
  const t = await getTranslations('nav');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome to ModuBiz. Select a module from the sidebar to get started.
        </p>
      </div>

      {/* Placeholder module cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[
          { key: 'crm', name: 'CRM', description: 'Manage contacts, companies, and deals' },
          { key: 'inventory', name: 'Inventory', description: 'Track products, stock, and warehouses' },
          { key: 'pos', name: 'POS', description: 'Point of sale with offline support' },
        ].map((module) => (
          <div
            key={module.key}
            className="rounded-lg border bg-card p-6 shadow-sm transition-colors hover:bg-accent/50"
          >
            <h3 className="font-semibold">{module.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
