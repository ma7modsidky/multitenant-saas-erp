'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';

interface DueBadgeProps {
  dueAt: string | null;
  completedAt: string | null;
}

/**
 * DueBadge — tells the user at a glance whether an activity is overdue
 * ("Overdue · 3 days ago"), due today, upcoming ("5 days left"), or already
 * completed. Computes whole calendar days against the user's local clock so a
 * task due at 11pm tonight reads as "today", not "1 day left".
 */
export function DueBadge({ dueAt, completedAt }: DueBadgeProps) {
  const t = useTranslations('modules.crm');
  if (completedAt) {
    return <Badge variant="secondary">{t('activities.completed')}</Badge>;
  }
  if (!dueAt) return null;

  const due = new Date(dueAt);
  const now = new Date();
  // Calendar-day difference: strip the time components, diff in whole days.
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);

  if (dayDiff < 0) {
    return <Badge variant="destructive">{t('activities.overdueDays', { count: -dayDiff })}</Badge>;
  }
  if (dayDiff === 0) {
    return <Badge>{t('activities.dueToday')}</Badge>;
  }
  return <Badge variant="outline">{t('activities.daysLeft', { count: dayDiff })}</Badge>;
}
