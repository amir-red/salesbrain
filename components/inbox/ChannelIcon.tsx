import type { InboxChannel } from '@/lib/inbox';

/** The two channel marks of the Inbox: an envelope for email, the "in" square for LinkedIn. */
export default function ChannelIcon({ channel, size = 16 }: { channel: InboxChannel; size?: number }) {
  if (channel === 'linkedin') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="LinkedIn" role="img">
        <rect x="1.5" y="1.5" width="21" height="21" rx="4" fill="#0A66C2" />
        <path fill="#fff" d="M6.4 9.6h2.5v8h-2.5zm1.25-3.9a1.45 1.45 0 1 1 0 2.9 1.45 1.45 0 0 1 0-2.9zM10.6 9.6h2.4v1.1h.03c.34-.63 1.15-1.3 2.37-1.3 2.53 0 3 1.67 3 3.83v4.37h-2.5v-3.88c0-.92-.02-2.11-1.29-2.11-1.29 0-1.49 1-1.49 2.04v3.95h-2.5z" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Email" role="img" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--cat-blue)' }}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" /><polyline points="3.5 6.5 12 13 20.5 6.5" />
    </svg>
  );
}
