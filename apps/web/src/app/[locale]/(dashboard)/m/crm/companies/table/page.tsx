import { Suspense } from 'react';

import { CompaniesTableView } from '@/features/crm';

export default function CompaniesTablePage() {
  return (
    <Suspense fallback={null}>
      <CompaniesTableView />
    </Suspense>
  );
}
