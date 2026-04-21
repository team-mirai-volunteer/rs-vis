'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Sankey2LayoutData } from '@/client/components/Sankey2/types';

const Sankey2View = dynamic(
  () => import('@/client/components/Sankey2/Sankey2View'),
  { ssr: false }
);

export default function Sankey2Page() {
  const [data, setData] = useState<Sankey2LayoutData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/sankey2-layout.json')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message));
  }, []);

  if (error) {
    return (
      <main className="w-screen h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-red-500 text-lg">
          データ読み込みエラー: {error}
          <div className="text-sm text-gray-500 mt-2">
            npm run compute-sankey2-layout を実行してください
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden', position: 'relative' }}>
      <Sankey2View data={data} />
    </main>
  );
}
