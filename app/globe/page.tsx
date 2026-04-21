'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { GlobeResponse } from '@/app/api/map/globe/route';

const GlobeView = dynamic(
  () => import('@/client/components/GlobeView'),
  { ssr: false }
);

export default function GlobePage() {
  const [data, setData] = useState<GlobeResponse | null>(null);

  useEffect(() => {
    fetch('/api/map/globe')
      .then(res => res.json())
      .then(setData)
      .catch(console.error);
  }, []);

  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <GlobeView data={data} />
    </main>
  );
}
