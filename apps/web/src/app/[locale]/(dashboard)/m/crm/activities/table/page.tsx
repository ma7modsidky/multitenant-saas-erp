import { Suspense } from 'react';

import { ActivitiesTableView } from '@/features/crm';

export default function ActivitiesTablePage() {
  return (
    <Suspense fallback={null}>
      <ActivitiesTableView />
    </Suspense>
  );
}
