import { Suspense } from 'react';

import { DealsTableView } from '@/features/crm';

export default function DealsTablePage() {
  return (
    <Suspense fallback={null}>
      <DealsTableView />
    </Suspense>
  );
}
