'use client';

import { useParams } from 'next/navigation';

import { SupplierDetailView } from '@/features/purchasing';

export default function PurchasingSupplierDetailPage() {
  const params = useParams<{ id: string }>();
  return <SupplierDetailView supplierId={params.id} />;
}
