'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import BrandSettings from '@/components/settings/BrandSettings';
import AgentsSettings from '@/components/settings/AgentsSettings';

const SECTIONS = [
  { key: 'brand', label: 'Brand & Voice' },
  { key: 'agents', label: 'Agents' },
] as const;
type SectionKey = typeof SECTIONS[number]['key'];

/**
 * /settings — Brand & Voice and Agents in one place (Amir 2026-11-11: off the side menu). The old /brand and /agents
 * URLs redirect here with their query string, so every existing link still lands on the right tab.
 */
export default function SettingsPage() {
  return <Suspense><SettingsInner /></Suspense>;
}

function SettingsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const section = (SECTIONS.some((s) => s.key === sp.get('section')) ? sp.get('section') : 'brand') as SectionKey;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 flex items-center gap-4 flex-wrap">
          <h1 className="text-lg font-bold">Settings</h1>
          <div className="flex rounded-lg p-0.5" style={{ background: 'var(--bg-input)' }} role="tablist" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button key={s.key} role="tab" aria-selected={s.key === section}
                onClick={() => router.replace(`/settings?section=${s.key}`)}
                className="px-3 py-1 rounded-md text-sm"
                style={{ background: s.key === section ? 'var(--bg-card)' : 'transparent', color: s.key === section ? 'var(--text)' : 'var(--text-muted)', fontWeight: s.key === section ? 600 : 400 }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {section === 'brand' ? <BrandSettings /> : <AgentsSettings />}
      </div>
    </div>
  );
}
