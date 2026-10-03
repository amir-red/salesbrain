import type { Metadata } from 'next';
import { Poppins, JetBrains_Mono } from 'next/font/google';
// @ts-expect-error -- CSS import handled by Next.js bundler
import './globals.css';

// Brand basics: Poppins for the product, JetBrains Mono for code / IDs only.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SalesBrain — Zeami',
  description: 'Sales and grants CRM with an agent at its core',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Light product style is the default; a stored choice wins. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var t = localStorage.getItem('salesbrain-theme');
                document.documentElement.classList.add(t === 'dark' ? 'dark' : 'light');
              })();
            `,
          }}
        />
      </head>
      {/* Font variables live on <body>: <html>'s class is owned by the theme script. */}
      <body className={`${poppins.variable} ${jetbrains.variable} antialiased min-h-screen`}>{children}</body>
    </html>
  );
}
