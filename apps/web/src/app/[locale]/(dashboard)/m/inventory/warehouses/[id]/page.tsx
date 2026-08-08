'use client';

import { useParams } from 'next/navigation';

import { WarehouseDetailView } from '@/features/inventory';

export default function WarehouseDetailPage() {
  const params = useParams<{ id: string }>();
  return <WarehouseDetailView id={params.id} />;
}
