import DrawClient from './DrawClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Prize Draw',
  description: 'Commit-reveal prize draw for the FAX CHAIN collectible on Base. One winner drawn per chain-depth tier from an on-chain block hash.',
  alternates: { canonical: '/draw' },
};

export default function DrawPage() {
  return <DrawClient />;
}
