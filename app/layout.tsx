import type { Metadata } from 'next';
// @ts-expect-error -- CSS import handled by Next.js bundler
import './globals.css';

export const metadata: Metadata = {
  title: 'SalesBrain — Agentic B2B Sales CRM',
  description: 'AI-powered sales pipeline management with Claude',
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
