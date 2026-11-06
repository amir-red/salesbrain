import type { ChatApp, InboxChannel } from '@/lib/inbox';

/** The channel marks of the Inbox: an envelope for email, the "in" square for LinkedIn, and for a chat its app
 *  (WhatsApp's green bubble, Telegram's plane, a green bubble for iMessage / SMS). */
export default function ChannelIcon({ channel, app, size = 16 }: { channel: InboxChannel; app?: ChatApp | null; size?: number }) {
  if (channel === 'linkedin') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="LinkedIn" role="img">
        <rect x="1.5" y="1.5" width="21" height="21" rx="4" fill="#0A66C2" />
        <path fill="#fff" d="M6.4 9.6h2.5v8h-2.5zm1.25-3.9a1.45 1.45 0 1 1 0 2.9 1.45 1.45 0 0 1 0-2.9zM10.6 9.6h2.4v1.1h.03c.34-.63 1.15-1.3 2.37-1.3 2.53 0 3 1.67 3 3.83v4.37h-2.5v-3.88c0-.92-.02-2.11-1.29-2.11-1.29 0-1.49 1-1.49 2.04v3.95h-2.5z" />
      </svg>
    );
  }
  if (channel === 'chat') {
    if (app === 'whatsapp' || app === 'whatsapp_business') {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-label="WhatsApp" role="img">
          <path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" />
          <path fill="#fff" d="M9.1 7.3c-.2-.5-.4-.5-.6-.5h-.5c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3.2 5 4.4 2.5 1 3 .8 3.5.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.4l-2-.9c-.3-.1-.5-.2-.7.1l-.9 1.1c-.2.2-.3.2-.6.1-.3-.2-1.2-.4-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.4.1-.6l.4-.5.3-.5c.1-.2 0-.4 0-.5l-1-2.3z" />
        </svg>
      );
    }
    if (app === 'telegram') {
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Telegram" role="img">
          <circle cx="12" cy="12" r="10" fill="#229ED9" />
          <path fill="#fff" d="M5.5 11.7l10.9-4.2c.5-.2 1 .1.8.9l-1.9 8.8c-.1.6-.5.8-1 .5l-2.8-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-2.9 5.3-4.8c.2-.2 0-.3-.3-.1l-6.5 4.1-2.8-.9c-.6-.2-.6-.6.1-.9z" />
        </svg>
      );
    }
    const label = app === 'imessage' ? 'iMessage' : app === 'sms' ? 'SMS' : 'Chat';
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label={label} role="img">
        <path fill={app ? '#34C759' : '#14B8A6'} d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.6 3.4 6.1L4.5 21l4-2.1c1.1.3 2.3.5 3.5.5 5.5 0 10-3.6 10-8s-4.5-8.4-10-8.4z" />
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
