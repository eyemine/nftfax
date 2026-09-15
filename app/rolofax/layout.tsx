/// Metadata for /rolofax.
///
/// The page itself is a client component and so cannot export `metadata`, which
/// is why this route previously inherited the site-wide title and competed with
/// the homepage for the same terms. A layout is the standard way to attach it.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Rolofax Player Directory',
  description:
    'Browse active NFTFAX players across Chonks, Deadfellaz, Normies and POW NFT. Claim your free @fax identity with the NFT you already own and start a chain letter.',
  alternates: { canonical: '/rolofax' },
};

export default function RolofaxLayout({ children }: { children: React.ReactNode }) {
  return children;
}
