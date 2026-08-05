import { redirect } from 'next/navigation';

export default async function CrmPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/m/crm/contacts`);
}
