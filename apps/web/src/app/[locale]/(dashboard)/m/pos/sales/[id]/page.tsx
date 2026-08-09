'use client';

import { useParams } from 'next/navigation';

import { SaleDetailView } from '@/features/pos';

export default function PosSaleDetailPage() {
  const params = useParams<{ id: string }>();
  return <SaleDetailView saleId={params.id} />;
}
