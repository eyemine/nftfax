import RolofaxClient from './RolofaxClient';

export const metadata = {
  title: 'Chain-log',
  description:
    'Live NFTFAX standings: minted FAX CHAIN collectibles, chain depth reached, and the most active @fax identities across every community.',
  alternates: { canonical: '/chain-log' },
};

export const dynamic = 'force-dynamic';

export default function RolofaxPage() {
  return <RolofaxClient />;
}
