import RolofaxClient from './RolofaxClient';

export const metadata = {
  title: 'Rolofax Leaderboard',
  description:
    'Live NFTFAX standings: minted FAX CHAIN collectibles, chain depth reached, and the most active @fax identities across every community.',
  alternates: { canonical: '/leaderboard' },
};

export const dynamic = 'force-dynamic';

export default function RolofaxPage() {
  return <RolofaxClient />;
}
