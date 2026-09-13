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
