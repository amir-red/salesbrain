import type { Metadata } from 'next';
// @ts-expect-error -- CSS import handled by Next.js bundler
import './globals.css';

export const metadata: Metadata = {
  title: 'SalesBrain — Agentic B2B Sales CRM',
  description: 'AI-powered sales pipeline management with Claude',
  // Neural-node SB monogram lives at /public/logo.svg. Browsers render SVG
  // favicons at native resolution — no separate favicon.ico needed.
  icons: {
    icon: [
      { url: '/logo.svg', type: 'image/svg+xml' },
    ],
    // apple-touch-icon uses PNG. If a PNG variant is added at
    // public/logo-192.png later, uncomment the next block.
    // apple: [{ url: '/logo-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var t = localStorage.getItem('salesbrain-theme');
                var d = t ? t === 'dark' : true;
                document.documentElement.classList.add(d ? 'dark' : 'light');
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
