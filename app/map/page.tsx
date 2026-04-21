'use client';

import { useState, useEffect } from 'react';
import type { TreemapMinistry } from '@/app/api/map/treemap/route';
import { BudgetBoardView } from '@/client/components/BudgetBoardView';

export default function MapPage() {
  const [ministries, setMinistries] = useState<TreemapMinistry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/map/treemap')
      .then(r => r.json())
      .then(data => {
        setMinistries(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load treemap data:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: '#0a0f1a' }}>
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-400 text-sm font-mono">Loading budget board...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen">
      <BudgetBoardView ministries={ministries} />
    </div>
  );
}
