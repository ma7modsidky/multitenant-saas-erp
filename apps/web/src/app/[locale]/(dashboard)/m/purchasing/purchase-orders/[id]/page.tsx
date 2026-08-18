'use client';

import { useParams } from 'next/navigation';

import { PurchaseOrderDetailView } from '@/features/purchasing';

export default function PurchasingPurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  return <PurchaseOrderDetailView poId={params.id} />;
}
