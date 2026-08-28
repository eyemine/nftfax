import { Suspense } from 'react';
import HomeClient from './HomeClient';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <HomeClient />
    </Suspense>
  );
}
