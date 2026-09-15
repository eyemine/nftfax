import VerifyClient from './VerifyClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Verify Prize Draw',
  description: 'Independently recompute the NFTFAX prize draw from the on-chain seed. Anyone can verify the winners before payout.',
  alternates: { canonical: '/verify' },
};

export default function VerifyPage() {
  return <VerifyClient />;
}
