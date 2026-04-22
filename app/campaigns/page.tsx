'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  deal_type: string;
  persona_target: string | null;
  positioning_angle: string | null;
  is_active: boolean;
  created_by_name: string | null;
  prospect_count: number;
  messages_sent: number;
  created_at: string;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [persona, setPersona] = useState('');
  const [angle, setAngle] = useState('');

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/campaigns');
      if (res.ok) setCampaigns(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const create = async () => {
    if (!name.trim()) return;
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || undefined,
        persona_target: persona.trim() || undefined,
        positioning_angle: angle.trim() || undefined,
      }),
    });
    if (res.ok) {
      setShowNew(false);
      setName(''); setDescription(''); setPersona(''); setAngle('');
      fetchCampaigns();
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="text-lg font-bold">Campaigns</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{campaigns.length} campaigns</p>
          </div>
          <button onClick={() => setShowNew(!showNew)} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#fff' }}>
            + New Campaign
          </button>
        </div>

        {showNew && (
          <div className="p-4 border-b space-y-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name *" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Persona target (e.g. VP Ops at mid-market logistics)" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <input value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="Positioning angle" className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <div className="flex gap-2">
              <button onClick={create} disabled={!name.trim()} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--green)', color: '#fff' }}>Create</button>
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
            </div>
          </div>
        )}

        <div className="p-4">
          {loading && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>}
          {!loading && campaigns.length === 0 && (
            <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
              <p>No campaigns yet</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {campaigns.map((c) => (
              <div key={c.id} className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium">{c.name}</h3>
                  {c.is_active ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `var(--green)20`, color: 'var(--green)' }}>Active</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>Inactive</span>
                  )}
                </div>
                {c.description && <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{c.description}</p>}
                {c.persona_target && <p className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Persona: {c.persona_target}</p>}
                {c.positioning_angle && <p className="text-[10px] mb-2" style={{ color: 'var(--text-muted)' }}>Angle: {c.positioning_angle}</p>}
                <div className="flex gap-3 mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>{c.prospect_count} prospects</span>
                  <span>{c.messages_sent} sent</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
