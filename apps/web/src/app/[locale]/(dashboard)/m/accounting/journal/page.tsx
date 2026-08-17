import { JournalView } from '@/features/accounting';

/**
 * Journal page. A deep link `?entry=<uuid>` (e.g. the invoice detail's
 * "View journal entry") is read server-side from searchParams and passed as a
 * prop — reading the URL inside a client lazy initializer would be lost on
 * SSR/hydration (React keeps the server-rendered state).
 */
export default async function AccountingJournalPage({ searchParams }: { searchParams: Promise<{ entry?: string }> }) {
  const { entry } = await searchParams;
  return <JournalView initialEntryId={entry ?? null} />;
}
