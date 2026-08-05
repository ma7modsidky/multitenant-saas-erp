import { Suspense } from 'react';

import { ContactsTableView } from '@/features/crm';

export default function ContactsTablePage() {
  return (
    <Suspense fallback={null}>
      <ContactsTableView />
    </Suspense>
  );
}
