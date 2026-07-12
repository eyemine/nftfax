import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NFTfax — Internet Fax Machine',
  description: 'Send trackless bitmap transmissions from your NFTmail address.',
  metadataBase: new URL('https://fax.nftmail.box'),
  openGraph: {
    title: 'NFTfax — Internet Fax Machine',
    description: 'Paper jams in the cloud. Tracking pixels not included.',
    url: 'https://fax.nftmail.box',
    siteName: 'NFTfax',
    type: 'website',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
