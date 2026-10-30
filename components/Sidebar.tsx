'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import ZeamiLogo, { ZeamiStar } from '@/components/ZeamiLogo';
import ThemeToggle from '@/components/ThemeToggle';

type NavItem = { href: string; label: string; icon: ReactNode; admin?: boolean };

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5" rx="1.5" />
        <rect x="13.5" y="11" width="7.5" height="10" rx="1.5" /><rect x="3" y="15" width="7.5" height="6" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/',
    label: 'Opportunities',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: '/warm',
    label: 'Warm people',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10z" />
      </svg>
    ),
  },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    href: '/followups',
    label: 'Follow-ups',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    href: '/grants',
    label: 'Grants',
    icon: (
      // Award ribbon — Stage-2 utilization dashboard
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="6" /><polyline points="8.21 13.89 7 22 12 19 17 22 15.79 13.88" />
      </svg>
    ),
  },
  {
    href: '/credits',
    label: 'Credits',
    icon: (
      // Lightning bolt — AI/cloud credits (Google, AWS, Anthropic, etc.)
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    href: '/icp',
    label: 'Lists (ICP)',
    icon: (
      // Target — the ideal-customer profile that sourcing and scoring aim at
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    href: '/brand',
    label: 'Brand & Voice',
    icon: (
      // Speech bubble — how we write to prospects (Brand & Voice, 079)
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="13" y2="13" />
      </svg>
    ),
  },
  {
    href: '/agents',
    label: 'Agents',
    icon: (
      // Bot face — background agents (Leads Finder, Outreach)
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="8" width="18" height="12" rx="2" /><circle cx="9" cy="14" r="1.5" /><circle cx="15" cy="14" r="1.5" /><line x1="12" y1="8" x2="12" y2="4" /><circle cx="12" cy="3" r="1" />
      </svg>
    ),
  },
  {
    href: '/admin/costs',
    label: 'Costs',
    admin: true,
    icon: (
      // Dollar sign — what the system costs to run (LLM, Unipile, credits, infra)
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  {
    href: '/admin/learning',
    label: 'Learning',
    admin: true,
    icon: (
      // Open book with a spark — what the agents learned and staged for review
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
      </svg>
    ),
  },
  {
    href: '/admin/users',
    label: 'Users',
    admin: true,
    icon: (
      // Two people — every person the agents act for, with the per-person switches
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/sales-leads',
    label: 'Leads',
    icon: (
      // Inbox-tray icon — signals "inbound submissions land here"
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
        <line x1="12" y1="4" x2="12" y2="10" />
        <polyline points="9 7 12 10 15 7" />
      </svg>
    ),
  },
  {
    href: '/marketing',
    label: 'Marketing',
    icon: (
      // Megaphone — paid acquisition: ads performance across channels
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    ),
  },
  {
    href: '/campaigns',
    label: 'Campaigns',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11l18-8v18l-18-8v-2z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </svg>
    ),
  },
  {
    href: '/lessons',
    label: 'Lessons',
    icon: (
      // Lightbulb — signals "what we learned"
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
      </svg>
    ),
  },
  // Approvals and Inbox were removed on 2026-07-30. Both were working pages
  // wired to producers that no longer exist: Approvals listed draft
  // outreach_messages (nothing can create one since the agent runtime was
  // deleted) and Inbox listed prospects at P6_REPLIED (nothing sets that stage).
  // They could never show a row, and a permanently empty page reads as a broken
  // feature rather than an absent one. Approvals now happen in the Telegram
  // flow; LinkedIn replies are triaged by the sync + crm_linkedin_inbox.
  {
    href: '/pricing',
    label: 'Pricing',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <line x1="8" y1="7" x2="16" y2="7" />
        <line x1="8" y1="11" x2="10" y2="11" />
        <line x1="12" y1="11" x2="14" y2="11" />
        <line x1="16" y1="11" x2="16" y2="11" />
        <line x1="8" y1="15" x2="10" y2="15" />
        <line x1="12" y1="15" x2="14" y2="15" />
        <line x1="8" y1="18" x2="14" y2="18" />
      </svg>
    ),
  },
  {
    href: '/network',
    label: 'Network',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2.5" />
        <circle cx="4" cy="5" r="1.8" />
        <circle cx="20" cy="5" r="1.8" />
        <circle cx="4" cy="19" r="1.8" />
        <circle cx="20" cy="19" r="1.8" />
        <line x1="12" y1="12" x2="4" y2="5" />
        <line x1="12" y1="12" x2="20" y2="5" />
        <line x1="12" y1="12" x2="4" y2="19" />
        <line x1="12" y1="12" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (
      // Person in a circle — account, and the channels attached to it
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
      </svg>
    ),
  },
];

// The nav follows the funnel (Mateo + Amir, 2026-10-26): first say whom you want and how you sound, then reach them,
// then work prospects → leads → opportunities. Dashboard + Inbox sit on top: what is happening, what needs an answer.
// `foldable` groups start folded on every page (Amir 2026-10-24) and open by a click on their label — or by themselves
// while one of their pages is the page you are on. The icon rail always shows every item.
const GROUPS: { label: string; hrefs: string[]; foldable?: boolean }[] = [
  { label: 'Overview', hrefs: ['/dashboard', '/inbox'] },
  { label: 'Target', hrefs: ['/icp', '/brand'] },
  { label: 'Reach', hrefs: ['/warm', '/campaigns', '/marketing', '/network'] },
  // Prospects live on the Lists page since 2026-10-28 ("All prospects" on the All-lists card); /prospecting still answers.
  { label: 'Prospects', hrefs: ['/agents'] },
  { label: 'Leads', hrefs: ['/sales-leads', '/followups'] },
  // Opportunities (`/`) holds the list and the pipeline board since 2026-10-24; /pipeline redirects to it.
  { label: 'Opportunities', hrefs: ['/'] },
  { label: 'Funding', foldable: true, hrefs: ['/grants', '/credits'] },
  { label: 'Insights', foldable: true, hrefs: ['/reports', '/lessons', '/pricing'] },
  { label: 'Admin', foldable: true, hrefs: ['/admin/costs', '/admin/users', '/admin/learning'] },
];
const BY_HREF = new Map(NAV_ITEMS.map((i) => [i.href, i]));
const PROFILE = BY_HREF.get('/profile')!;
const COLLAPSE_KEY = 'salesbrain-nav-collapsed';

export default function Sidebar() {
  const pathname = usePathname();
  // Admin-only items need the role; the API routes behind them re-check it.
  const [role, setRole] = useState<string | null>(null);
  // Below lg the nav is always the icon rail; on lg+ the user chooses.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((d) => setRole(d?.role ?? null)).catch(() => {});
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch { /* private mode */ }
  }, []);
  // Conversations waiting for my answer (the Inbox badge); looked at again every two minutes.
  const [inboxCount, setInboxCount] = useState(0);
  useEffect(() => {
    const get = () => fetch('/api/inbox/count').then((r) => (r.ok ? r.json() : null)).then((d) => setInboxCount(d?.needs_reply ?? 0)).catch(() => {});
    get();
    const t = setInterval(() => { if (document.visibilityState === 'visible') get(); }, 120_000);
    return () => clearInterval(t);
  }, []);
  const [loggingOut, setLoggingOut] = useState(false);
  const logOut = async () => {
    setLoggingOut(true);
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* go to the login page either way */ }
    window.location.href = '/login';
  };
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* private mode */ }
  };

  const wide = collapsed ? 'hidden' : 'hidden lg:block';      // shown only in the expanded nav
  const narrow = collapsed ? 'block' : 'block lg:hidden';     // shown only in the rail
  // Longest matching href wins, so a parent item (/marketing) is not lit while
  // one of its children (/marketing/connectors) is the page.
  const activeHref = (() => {
    let best = '';
    for (const item of NAV_ITEMS) {
      const h = item.href;
      const hit = h === '/' ? pathname === '/' : pathname === h || pathname.startsWith(h + '/');
      if (hit && h.length > best.length) best = h;
    }
    return best;
  })();
  const isActive = (href: string) => href === activeHref;
  // A click on a foldable group's label opens / closes it; untouched, it is open only while it holds the current page.
  const [folds, setFolds] = useState<Record<string, boolean>>({});

  const link = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.label}
        aria-current={active ? 'page' : undefined}
        className={`h-9 rounded-xl flex items-center gap-3 text-sm transition-colors hover:bg-[var(--accent-glow)] ${collapsed ? 'justify-center' : 'justify-center lg:justify-start lg:px-3'}`}
        style={{
          background: active ? 'var(--accent-glow)' : undefined,
          color: active ? 'var(--accent)' : 'var(--text-muted)',
          fontWeight: active ? 600 : 400,
        }}
      >
        <span className="flex-shrink-0 relative">
          {item.icon}
          {item.href === '/inbox' && inboxCount > 0 && (
            <span className={`${narrow} absolute -top-1 -right-1 w-2 h-2 rounded-full`} style={{ background: 'var(--accent)' }} />
          )}
        </span>
        <span className={`${wide} truncate`}>{item.label}</span>
        {item.href === '/inbox' && inboxCount > 0 && (
          <span className={`${wide} ml-auto text-[10px] font-semibold tabular-nums px-1.5 rounded-full`}
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }} title={`${inboxCount} conversation(s) waiting for your reply`}>
            {inboxCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className={`flex-shrink-0 flex flex-col border-r h-screen sticky top-0 w-16 ${collapsed ? '' : 'lg:w-56'}`}
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
    >
      <Link
        href="/"
        title="SalesBrain — home"
        className={`h-14 flex-shrink-0 flex items-center ${collapsed ? 'justify-center' : 'justify-center lg:justify-start lg:px-5'}`}
        style={{ color: 'var(--logo)' }}
      >
        <span className={wide}>
          <ZeamiLogo height={26} />
        </span>
        <span className={narrow}>
          <ZeamiStar size={24} />
        </span>
      </Link>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {GROUPS.map((group, gi) => {
          const items = group.hrefs
            .map((h) => BY_HREF.get(h))
            .filter((i): i is NavItem => !!i && (!i.admin || role === 'admin'));
          if (!items.length) return null;
          const open = !group.foldable || (folds[group.label] ?? items.some((i) => i.href === activeHref));
          return (
            <div key={group.label} className={gi === 0 ? '' : 'mt-3'}>
              {group.foldable ? (
                <button
                  type="button"
                  onClick={() => setFolds((f) => ({ ...f, [group.label]: !open }))}
                  aria-expanded={open}
                  className={`${collapsed ? 'hidden' : 'hidden lg:flex'} w-full items-center justify-between z-eyebrow px-3 mb-1 hover:opacity-80`}
                  title={open ? `Fold ${group.label}` : `Show ${group.label}`}
                >
                  {group.label}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 120ms' }} aria-hidden="true">
                    <polyline points="9 6 15 12 9 18" />
                  </svg>
                </button>
              ) : (
                <p className={`${wide} z-eyebrow px-3 mb-1`}>{group.label}</p>
              )}
              {gi > 0 && <div className={`${narrow} mx-3 mb-2 border-t`} style={{ borderColor: 'var(--border)' }} />}
              {/* folded: hidden in the wide nav, still listed in the icon rail */}
              <div className={`${open ? 'flex' : collapsed ? 'flex' : 'flex lg:hidden'} flex-col gap-0.5`}>{items.map(link)}</div>
            </div>
          );
        })}
      </div>

      <div className="flex-shrink-0 px-2 py-2 border-t flex flex-col gap-0.5" style={{ borderColor: 'var(--border)' }}>
        {link(PROFILE)}
        <button
          type="button"
          onClick={logOut}
          disabled={loggingOut}
          title="Log out"
          className={`h-9 rounded-xl flex items-center gap-3 text-sm transition-colors hover:bg-[var(--accent-glow)] disabled:opacity-60 ${collapsed ? 'justify-center' : 'justify-center lg:justify-start lg:px-3'}`}
          style={{ color: 'var(--text-muted)' }}
        >
          <span className="flex-shrink-0">
            {/* Door with an arrow leaving it */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </span>
          <span className={`${wide} truncate`}>{loggingOut ? 'Logging out…' : 'Log out'}</span>
        </button>
        <div className={`flex items-center gap-1 ${collapsed ? 'flex-col' : 'flex-col lg:flex-row lg:justify-between lg:px-1.5'}`}>
          <span className={wide}><ThemeToggle label /></span>
          <span className={narrow}><ThemeToggle /></span>
          <button
            onClick={toggleCollapsed}
            className="hidden lg:flex p-1.5 rounded-md hover:opacity-80"
            style={{ color: 'var(--text-muted)' }}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}>
              <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="9" y1="4" x2="9" y2="20" /><polyline points="16 9 13 12 16 15" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
