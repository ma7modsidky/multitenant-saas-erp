'use client';

import { useParams } from 'next/navigation';

import { DealDetailView } from '@/features/crm/details';

export default function DealDetailPage() {
  const params = useParams<{ id: string }>();
  return <DealDetailView id={params.id} />;
}
