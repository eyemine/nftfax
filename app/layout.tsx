import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';
import { FAX_THEME } from './lib/theme';

const siteUrl = process.env.NEXT_PUBLIC_FAX_SITE_URL || 'https://fax.nftmail.box';

export const metadata: Metadata = {
  title: `${FAX_THEME.siteName} — Internet Fax Machine`,
  description: `Send trackless bitmap transmissions from your ${FAX_THEME.collectionName} mailbox.`,
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: `${FAX_THEME.siteName} — Internet Fax Machine`,
    description: FAX_THEME.tagline,
    url: siteUrl,
    siteName: FAX_THEME.siteName,
    type: 'website',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
