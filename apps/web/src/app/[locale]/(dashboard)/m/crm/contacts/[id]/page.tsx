'use client';

import { useParams } from 'next/navigation';

import { ContactDetailView } from '@/features/crm/details';

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  return <ContactDetailView id={params.id} />;
}
