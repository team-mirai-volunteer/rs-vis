'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Link from 'next/link';
import { unifiedProjectUrl } from '@/app/lib/unified-budget/links';
import type { QualityScoreItem } from '@/app/lib/api/quality-scores-loader';
import { Button } from '@/components/ui/button';
import { ScoreDetailDialog } from '@/client/components/quality/ScoreDetailDialog';
import { useDialogFocus } from '@/client/hooks/useDialogFocus';

const cache = new Map<string, QualityScoreItem>();

/** バブルの選択直後からポップアップを開き、サンキー図と共通の詳細を取得する。 */
export function ProjectDetailPopup({ pid, name, year, onClose }: {
  pid: string;
  name: string;
  year: string;
  onClose: () => void;
}) {
  const key = `${year}-${pid}`;
  const [item, setItem] = useState(() => cache.get(key));
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose, !item);

  useEffect(() => {
    if (cache.has(key)) return;
    const controller = new AbortController();
    setError(false);
    fetch(`/api/quality-scores/${pid}?year=${year}&full=1`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('取得に失敗しました');
        const data = await response.json() as { score?: QualityScoreItem };
        if (!data.score) throw new Error('事業データがありません');
        return data.score;
      })
      .then(score => {
        if (controller.signal.aborted) return;
        cache.set(key, score);
        setItem(score);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [key, pid, year, attempt]);

  return createPortal(item ? <ScoreDetailDialog item={item} year={year} onClose={onClose} navigation={<>
    <Button asChild variant="outline" size="xs"><Link href={unifiedProjectUrl(pid, year)}>サンキー図で見る</Link></Button>
    <Button asChild variant="outline" size="xs"><Link href={`/subcontracts/${pid}?year=${year}`}>再委託フローを見る</Link></Button>
  </>} /> : (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={`${name} の詳細`} tabIndex={-1}
        className="w-full max-w-xl rounded-3xl border border-mirai-border bg-card p-5 shadow-soft"
        onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-bold">{name}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="閉じる（Esc）"><X className="size-4" /></Button>
        </div>
        {error ? <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-destructive">事業詳細を取得できませんでした。</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>再試行</Button>
        </div> : <p role="status" className="mt-4 text-sm text-mirai-text-muted">事業詳細を読み込んでいます…</p>}
      </div>
    </div>
  ), document.body);
}
