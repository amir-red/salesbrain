'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { relativeTime } from '@/lib/time';

interface AccountData {
  account: {
    id: string;
    name: string;
    domain: string | null;
    website: string | null;
    industry: string | null;
    company_size: string | null;
    hq_location: string | null;
    notes: string | null;
    created_at: string;
  };
  contacts: Array<{ id: string; full_name: string; title: string | null; email: string | null }>;
  prospects: Array<{ id: string; stage: string; contact_name: string | null; icp_score: number | null; last_contacted_at: string | null }>;
  deals: Array<{ id: string; name: string; gate: number; score: number | null; verdict: string | null; value: string | null; currency: string | null; deal_type: string }>;
}

export default function AccountDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/accounts/${id}`);
        if (res.ok) setData(await res.json());
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) return <div className="flex h-screen"><Sidebar /><div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Loading...</div></div>;
  if (!data) return <div className="flex h-screen"><Sidebar /><div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>Account not found</div></div>;

  const { account, contacts, prospects, deals } = data;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-xl font-bold">{account.name}</h1>
          {account.domain && <p className="text-sm" style={{ color: 'var(--accent)' }}>{account.domain}</p>}
          <div className="mt-2 flex gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            {account.industry && <span>Industry: {account.industry}</span>}
            {account.company_size && <span>Size: {account.company_size}</span>}
            {account.hq_location && <span>HQ: {account.hq_location}</span>}
          </div>
        </div>

        <div className="p-6 grid grid-cols-3 gap-6">
          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Contacts ({contacts.length})</h3>
            {contacts.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No contacts yet</p>
            ) : (
              <div className="space-y-2">
                {contacts.map((c) => (
                  <div key={c.id} className="text-xs border-l-2 pl-2" style={{ borderColor: 'var(--border)' }}>
                    <p className="font-medium">{c.full_name}</p>
                    {c.title && <p style={{ color: 'var(--text-muted)' }}>{c.title}</p>}
                    {c.email && <p style={{ color: 'var(--accent)' }}>{c.email}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Prospects ({prospects.length})</h3>
            {prospects.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No prospects</p>
            ) : (
              <div className="space-y-2">
                {prospects.map((p) => (
                  <Link key={p.id} href={`/prospects/${p.id}`} className="block text-xs border-l-2 pl-2 hover:opacity-80" style={{ borderColor: 'var(--accent)' }}>
                    <p className="font-medium">{p.contact_name || '—'}</p>
                    <p style={{ color: 'var(--text-muted)' }}>{p.stage} {p.icp_score !== null && `· ${p.icp_score}`}</p>
                    {p.last_contacted_at && <p style={{ color: 'var(--text-muted)' }}>{relativeTime(p.last_contacted_at)}</p>}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Deals ({deals.length})</h3>
            {deals.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No deals</p>
            ) : (
              <div className="space-y-2">
                {deals.map((d) => (
                  <Link key={d.id} href={`/deals/${d.id}`} className="block text-xs border-l-2 pl-2 hover:opacity-80" style={{ borderColor: 'var(--green)' }}>
                    <p className="font-medium">{d.name}</p>
                    <p style={{ color: 'var(--text-muted)' }}>{d.deal_type} · G{d.gate} {d.score !== null && `· ${d.score}`}</p>
                    {d.value && <p style={{ color: 'var(--text-muted)' }}>{d.currency} {Number(d.value).toLocaleString()}</p>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
