'use client';

import { useParams } from 'next/navigation';

import { InvoiceDetailView } from '@/features/accounting';

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  return <InvoiceDetailView id={params.id} />;
}
