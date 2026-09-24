'use client';

import { useEffect, useState } from 'react';
import { fiscalYear } from '@/app/lib/rs-fiscal-year';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ProjectDetailShare({ pid, year }: { pid: string; year: string }) {
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setFallbackUrl(''); setNotice(''); }, [pid, year]);

  async function copy() {
    const url = new URL('/quality', window.location.origin);
    url.searchParams.set('fiscalYear', String(fiscalYear(year)));
    url.searchParams.set('detail', pid);
    try {
      await navigator.clipboard.writeText(url.href);
      setFallbackUrl('');
      setNotice('詳細URLをコピーしました');
    } catch {
      setFallbackUrl(url.href);
      setNotice('URLを選択してコピーしてください');
    }
  }

  return <div className="min-w-0">
    <Button variant="outline" size="xs" onClick={() => void copy()}>
      <Link2 className="size-3" aria-hidden="true" />詳細URLをコピー
    </Button>
    {notice && <p role="status" className="mt-1 text-xs text-mirai-text-muted">{notice}</p>}
    {fallbackUrl && <input aria-label="事業詳細の共有URL" className="mt-1 w-full rounded border border-mirai-border bg-card p-1 text-xs" readOnly value={fallbackUrl} onFocus={e => e.target.select()} />}
  </div>;
}
