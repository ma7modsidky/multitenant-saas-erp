'use client';

import { useParams } from 'next/navigation';

import { BillDetailView } from '@/features/purchasing';

export default function PurchasingBillDetailPage() {
  const params = useParams<{ id: string }>();
  return <BillDetailView billId={params.id} />;
}
