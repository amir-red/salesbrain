'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TelegramPanel from '@/components/profile/TelegramPanel';
import LinkedInPanel from '@/components/profile/LinkedInPanel';
import ImportsPanel from '@/components/profile/ImportsPanel';
import McpPanel from '@/components/profile/McpPanel';
import ServiceTokenPanel from '@/components/profile/ServiceTokenPanel';

type Tab = 'account' | 'telegram' | 'linkedin' | 'imports' | 'mcp' | 'service';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'account', label: 'Account', hint: 'Who you are signed in as' },
  { id: 'telegram', label: 'Telegram', hint: 'Chat with the assistant' },
  { id: 'linkedin', label: 'LinkedIn', hint: 'Inbox triage and follow-ups' },
  { id: 'imports', label: 'Imports', hint: 'Google, contacts, messages' },
  { id: 'mcp', label: 'MCP', hint: 'Access tokens for Claude and other tools' },
  { id: 'service', label: 'Service API', hint: 'Admin: tokens for a sibling app to run outreach' },
];

interface Me { userId: string; email: string; name: string | null; role: string }

export default function ProfilePage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <Profile />
    </Suspense>
  );
}

function Profile() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params.get('tab') as Tab) || 'account';
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : 'account');
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => {});
  }, []);

  // Keep the tab in the URL so a connect flow can send the user back to the
  // right place, and so links like /profile?tab=linkedin keep working.
  const select = useCallback((next: Tab) => {
    setTab(next);
    const qs = new URLSearchParams(Array.from(params.entries()));
    qs.set('tab', next);
    router.replace(`/profile?${qs.toString()}`, { scroll: false });
  }, [params, router]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="text-lg font-bold">Profile</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Your account and the channels the assistant works through.
          </p>
        </div>

        <div className="px-4 pt-3 border-b flex gap-1 overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          {TABS.filter((t) => t.id !== 'service' || me?.role === 'admin').map((t) => (
            <button
              key={t.id}
              onClick={() => select(t.id)}
              title={t.hint}
              className="px-3 py-2 text-sm rounded-t whitespace-nowrap"
              style={{
                color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
                borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                fontWeight: tab === t.id ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'account' && (
          <div className="p-4 max-w-3xl">
            <div className="rounded-lg p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <h2 className="text-sm font-semibold mb-3">Signed in as</h2>
              {me ? (
                <dl className="text-xs space-y-2">
                  <div className="flex gap-3">
                    <dt className="w-20" style={{ color: 'var(--text-muted)' }}>Name</dt>
                    <dd>{me.name || '—'}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-20" style={{ color: 'var(--text-muted)' }}>Email</dt>
                    <dd>{me.email}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-20" style={{ color: 'var(--text-muted)' }}>Role</dt>
                    <dd>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                        {me.role}
                      </span>
                      {me.role === 'admin' && (
                        <span className="ml-2" style={{ color: 'var(--text-muted)' }}>
                          sees every deal in the pipeline
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
              )}
            </div>

            <section className="mt-4 rounded-lg p-4 text-xs"
                     style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <p><strong style={{ color: 'var(--text)' }}>Getting set up</strong></p>
              <ol className="mt-2 space-y-1 list-decimal pl-4">
                <li><button onClick={() => select('telegram')} style={{ color: 'var(--accent)' }}>Link Telegram</button> — required before the assistant will act for you at all.</li>
                <li><button onClick={() => select('linkedin')} style={{ color: 'var(--accent)' }}>Connect LinkedIn</button> — optional, adds inbox triage and follow-ups.</li>
                <li><button onClick={() => select('imports')} style={{ color: 'var(--accent)' }}>Imports</button> — bring in contacts and past messages.</li>
              </ol>
              <p className="mt-3">
                Nothing is sent to anyone without you approving the exact wording — no automatic
                emails, LinkedIn messages, or connection requests.
              </p>
            </section>
          </div>
        )}

        {tab === 'telegram' && <TelegramPanel />}
        {tab === 'linkedin' && <LinkedInPanel />}
        {tab === 'imports' && <ImportsPanel />}
        {tab === 'mcp' && <McpPanel />}
        {tab === 'service' && me?.role === 'admin' && <ServiceTokenPanel />}
      </div>
    </div>
  );
}
