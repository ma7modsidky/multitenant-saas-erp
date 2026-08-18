'use client';

import { useParams } from 'next/navigation';

import { GrnDetailView } from '@/features/purchasing';

export default function PurchasingGrnDetailPage() {
  const params = useParams<{ id: string }>();
  return <GrnDetailView grnId={params.id} />;
}
