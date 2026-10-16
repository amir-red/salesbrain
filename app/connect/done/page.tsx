/**
 * Where a connect link ends. Public (no login) and deliberately plain: it says whether the connection
 * worked and sends the person back to Telegram, where the bot has already told them the details.
 */
export const dynamic = 'force-dynamic';

export default function ConnectDone({ searchParams }: { searchParams: { ok?: string; provider?: string; reason?: string } }) {
  const ok = searchParams.ok === '1';
  const what = searchParams.provider === 'linkedin' ? 'LinkedIn' : searchParams.provider === 'google' ? 'Google' : 'Your account';
  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="text-4xl mb-3" style={{ color: ok ? 'var(--green)' : 'var(--red)' }}>{ok ? '✓' : '✕'}</div>
        <h1 className="text-lg font-semibold mb-2">{ok ? `${what} connected` : `${what} was not connected`}</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {ok
            ? 'You can close this tab and go back to Telegram. The bot will tell you when it is done.'
            : (searchParams.reason?.slice(0, 200) || 'Something went wrong.') + ' Go back to Telegram and ask the bot for a new link.'}
        </p>
      </div>
    </main>
  );
}
