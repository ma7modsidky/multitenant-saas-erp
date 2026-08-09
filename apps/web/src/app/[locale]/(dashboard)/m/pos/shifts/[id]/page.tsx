'use client';

import { useParams } from 'next/navigation';

import { ShiftReportView } from '@/features/pos';

export default function ShiftReportPage() {
  const params = useParams<{ id: string }>();
  return <ShiftReportView shiftId={params.id} />;
}
