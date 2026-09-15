import type { Metadata } from 'next';
import './globals.css';
import Providers from './providers';

/// Canonical site identity.
///
/// Deliberately NOT derived from FAX_THEME. The theme is set per deployment via
/// NEXT_PUBLIC_FAX_COLLECTION, so the title used to change with whichever skin
/// was live — which is why search results show both "CHONKS NFTFAX" and
/// "DEADFELLAZ NFTFAX" for the same site. Search engines treat a title that
/// changes under them as an unstable identity and split the ranking signal.
/// The brand is the domain; the skin is presentation.
// Default is fax.nftmail.box, NOT nftfax.app: the latter is registrar
// domain-forwarding that 301s to it and DROPS THE PATH, so an absolute
// nftfax.app/og/... URL resolves to the homepage HTML and social previews
// break. Point this at nftfax.app only once that domain serves the app
// directly.
const SITE_URL = process.env.NEXT_PUBLIC_FAX_SITE_URL || 'https://fax.nftmail.box';
const SITE_NAME = 'NFTFAX.app';
const SITE_TITLE = 'NFTFAX.app — Internet Fax Machine';
const SITE_DESCRIPTION =
  'NFTFAX.app is an internet fax machine for NFT communities. Claim a free @fax identity with the NFT you already own, send bitmap transmissions, and mint the chain letter on Base.';

export const metadata: Metadata = {
  title: {
    default: SITE_TITLE,
    // Sub-pages read "Rolofax — NFTFAX.app" rather than inventing their own
    // brand, so every result in a SERP reinforces the same name.
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  keywords: [
    'NFTFAX', 'NFT fax', 'fax identity', 'chain letter NFT', 'Base NFT',
    'Chonks', 'Deadfellaz', 'Normies', 'POW NFT', 'onchain messaging',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: 'website',
    locale: 'en_GB',
    images: [
      { url: '/og/nftfax-og.png', width: 1200, height: 630, alt: SITE_NAME },
      { url: '/og/nftfax-og-square.png', width: 1200, height: 1200, alt: SITE_NAME },
    ],
  },
  twitter: {
    // summary_large_image, not summary: the latter renders a small square
    // thumbnail and was what the site previously advertised.
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ['/og/nftfax-og.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

/// Drops malformed EIP-6963 wallet announcements before any bundle code sees
/// them.
///
/// mipd@0.0.7 (pulled in via wagmi/Privy) registers:
///   const handler = (event) => listener(event.detail)
/// with no validation, and its store then reads `detail.info.uuid`. A browser
/// extension that announces `eip6963:announceProvider` with a null/!object
/// `detail` therefore throws
///   "Cannot read properties of null (reading 'info')"
/// inside provider discovery, which can leave Privy's wallet store wedged so
/// `getEthereumProvider()` never settles — the mint button then hangs with no
/// MetaMask prompt and no error.
///
/// This must run before the app bundle: DOM listeners on the same target fire
/// in registration order, so registering first lets stopImmediatePropagation()
/// keep the bad event away from mipd. Hence an inline head script, not an
/// effect. Well-formed announcements are untouched.
const EIP6963_GUARD = `
(function () {
  try {
    if (typeof window === 'undefined' || window.__faxEip6963Guard) return;
    window.__faxEip6963Guard = 1;
    window.addEventListener('eip6963:announceProvider', function (event) {
      var d = event && event.detail;
      if (!d || typeof d !== 'object' || !d.info || typeof d.info.uuid !== 'string' || !d.provider) {
        event.stopImmediatePropagation();
        console.warn('[fax] dropped malformed eip6963:announceProvider', d);
      }
    }, true);
  } catch (e) { /* never block boot */ }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: EIP6963_GUARD }} />
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
