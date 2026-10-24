import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TelegramNudge from '@/components/TelegramNudge';
import DealsView from '@/components/deals/DealsView';
import { getSession } from '@/lib/auth';
import { loadDeals } from '@/lib/deals-board';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deals — one page for the deal list and the pipeline board (merged 2026-10-24; /pipeline redirects here).
 * List = your deals by default (creator or lead, as the old home page), Board = everyone's (as the old /pipeline);
 * a Mine / Everyone switch changes either. A deal opens on /deals/[id], where the agent chat is a tab.
 * Old links `/?deal=<id>[&prefill=…]` open that deal's chat.
 */
export default async function DealsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => (Array.isArray(searchParams[k]) ? searchParams[k]?.[0] : searchParams[k]) as string | undefined;
  const dealId = one('deal');
  if (dealId && UUID.test(dealId)) {
    const prefill = one('prefill');
    redirect(`/deals/${dealId}?tab=chat${prefill ? `&prefill=${encodeURIComponent(prefill)}` : ''}`);
  }

  const session = await getSession();
  if (!session) redirect('/login');
  const deals = await loadDeals();

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-hidden flex flex-col min-w-0">
        <TelegramNudge />
        <DealsView deals={deals} userId={session.userId} />
      </div>
    </div>
  );
}
