'use client';

import { useParams } from 'next/navigation';

import { ActivityDetailView } from '@/features/crm/details';

export default function ActivityDetailPage() {
  const params = useParams<{ id: string }>();
  return <ActivityDetailView id={params.id} />;
}
