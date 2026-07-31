import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ArrowRight, TrendingUp, Users, Package, DollarSign } from 'lucide-react';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default async function DashboardPage() {
  const t = await getTranslations();

  const modules = [
    {
      key: 'crm',
      href: '/m/crm',
      icon: Users,
      gradient: 'from-blue-500 to-blue-600',
    },
    {
      key: 'inventory',
      href: '/m/inventory',
      icon: Package,
      gradient: 'from-emerald-500 to-emerald-600',
    },
    {
      key: 'pos',
      href: '/m/pos',
      icon: DollarSign,
      gradient: 'from-amber-500 to-amber-600',
    },
  ] as const;

  const stats = [
    { label: 'Active Users', value: '12', icon: Users, change: '+2 this week' },
    { label: 'Products', value: '1,234', icon: Package, change: '+28 this month' },
    { label: 'Revenue (MTD)', value: 'KES 0', icon: TrendingUp, change: 'Start selling' },
    { label: 'Active Deals', value: '8', icon: DollarSign, change: 'KES 45,000 pipeline' },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Welcome header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('nav.dashboard')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome to ModuBiz. Here&apos;s an overview of your business.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="transition-colors hover:bg-accent/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                </div>
                <p className="mt-2 text-2xl font-bold tracking-tight">{stat.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{stat.change}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Module quick-access section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('nav.modulesLabel')}</h2>
          <Link
            href="/settings/modules"
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            {t('nav.modules')}
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <Link key={mod.key} href={mod.href}>
                <Card className="group cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div
                        className={`flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${mod.gradient} text-white shadow-sm`}
                      >
                        <Icon className="size-5" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold group-hover:text-primary transition-colors">
                          {t(`modules.${mod.key}.name`)}
                        </h3>
                        <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">
                          {t(`modules.${mod.key}.description`)}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Recent activity placeholder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
          <CardDescription>Your recent actions across all modules</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No recent activity yet. Start using modules to see your activity here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
