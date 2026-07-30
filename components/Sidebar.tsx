'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  {
    href: '/',
    label: 'Deals',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: '/pipeline',
    label: 'Pipeline',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    href: '/followups',
    label: 'Followups',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    href: '/clients',
    label: 'Clients',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/relationships',
    label: 'People',
    icon: (
      // Linked nodes — the relationship graph
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="6" r="3" /><circle cx="19" cy="6" r="3" /><circle cx="12" cy="18" r="3" />
        <line x1="7.2" y1="7.8" x2="10" y2="16" /><line x1="16.8" y1="7.8" x2="14" y2="16" /><line x1="8" y1="6" x2="16" y2="6" />
      </svg>
    ),
  },
  {
    href: '/discovery',
    label: 'Discovery',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    href: '/prospecting',
    label: 'Prospects',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    href: '/sales-leads',
    label: 'Sales Leads',
    icon: (
      // Inbox-tray icon — signals "inbound submissions land here"
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
        <line x1="12" y1="4" x2="12" y2="10" />
        <polyline points="9 7 12 10 15 7" />
      </svg>
    ),
  },
  {
    href: '/campaigns',
    label: 'Campaigns',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11l18-8v18l-18-8v-2z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
      </svg>
    ),
  },
  {
    href: '/lessons',
    label: 'Lessons',
    icon: (
      // Lightbulb — signals "what we learned"
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
      </svg>
    ),
  },
  {
    href: '/approvals',
    label: 'Approvals',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
    ),
  },
  {
    href: '/pricing',
    label: 'Pricing',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    href: '/onboarding',
    label: 'Onboarding',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="14" height="17" rx="2" />
        <path d="M8 4V2h6v2" />
        <line x1="7" y1="9" x2="13" y2="9" />
        <line x1="7" y1="13" x2="13" y2="13" />
        <line x1="7" y1="17" x2="11" y2="17" />
      </svg>
    ),
  },
  {
    href: '/network',
    label: 'Network',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
    href: '/integrations',
    label: 'Imports',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
  {
    href: '/settings/mcp',
    label: 'MCP',
    icon: (
      // Plug/socket — signals "external tool connection"
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2v6" />
        <path d="M15 2v6" />
        <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
        <path d="M12 18v4" />
      </svg>
    ),
  },
  {
    href: '/settings/telegram',
    label: 'Telegram',
    icon: (
      // Paper airplane — the Telegram brand shape
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    ),
  },
  {
    href: '/settings/linkedin',
    label: 'LinkedIn',
    icon: (
      // The "in" mark: rounded square with the stem + node
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="3" />
        <line x1="8" y1="11" x2="8" y2="17" />
        <line x1="8" y1="7.5" x2="8" y2="7.5" />
        <path d="M12 17v-3.5a2.5 2.5 0 0 1 5 0V17" />
        <line x1="12" y1="11" x2="12" y2="17" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div
      className="w-16 flex-shrink-0 flex flex-col items-center py-4 gap-1 border-r"
      style={{ background: '#0F1F3D', borderColor: 'var(--border)' }}
    >
      {/* Logo — neural-node SB monogram. SVG lives at public/logo.svg. */}
      <Link href="/" className="mb-4 block" title="SalesBrain — home">
        <img
          src="/logo.svg"
          alt="SalesBrain"
          width={40}
          height={40}
          className="w-10 h-10 rounded-xl block"
        />
      </Link>

      {/* Nav items */}
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors"
            style={{
              background: isActive ? 'var(--accent-glow)' : 'transparent',
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            }}
            title={item.label}
          >
            {item.icon}
            <span className="text-[9px] leading-none">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
