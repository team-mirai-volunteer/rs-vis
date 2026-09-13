'use client';

/**
 * 項単位「項→目→RS事業→支出先」サンキー詳細ページ。
 *
 * `/mof-kou`（項一覧）の行から遷移する（`/subcontracts` → `/subcontracts/[projectId]`
 * と同じ「一覧→詳細」構成）。データは /api/mof-kou/[id]/sankey（項の合成キーをURLエンコード
 * して渡す。年度はidに含まれないため `?year=` を別に持つ）。
 * 詳細: docs/tasks/20260904_0759_項単位の目RS事業支出先サンキー設計.md
 */

import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { MOFKouSankeyData } from '@/types/mof-kou-sankey';
import { PageNavMenu } from '@/components/navigation/PageNavMenu';
import { SankeyChart } from '@/client/components/mof-kou-sankey/SankeyChart';

function CenterMessage({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <p className={error ? 'text-sm text-destructive' : 'text-sm text-mirai-text-muted'}>{text}</p>
    </div>
  );
}

export default function MOFKouSankeyPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<CenterMessage text="読み込み中…" />}>
      <MOFKouSankeyContent params={params} />
    </Suspense>
  );
}

function MOFKouSankeyContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const year = Number(searchParams.get('year'));

  const [data, setData] = useState<MOFKouSankeyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('sel'));

  useEffect(() => {
    if (!year) {
      setError('year を指定してください');
      return;
    }
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/mof-kou/${id}/sankey?year=${year}`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw new Error(body?.error ?? `API error: ${r.status}`);
        }
        return r.json() as Promise<MOFKouSankeyData>;
      })
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch(err => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, year]);

  const selectNode = (nextId: string | null) => {
    setSelectedId(nextId);
    const params = new URLSearchParams(window.location.search);
    if (nextId) params.set('sel', nextId);
    else params.delete('sel');
    window.history.replaceState(null, '', `?${params.toString()}`);
  };

  if (error) return <CenterMessage text={`読み込みに失敗しました: ${error}`} error />;
  if (!data) return <CenterMessage text="読み込み中…" />;

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      <SankeyChart
        nodes={data.sankey.nodes}
        links={data.sankey.links}
        browseNodes={data.browse.nodes}
        browseLinks={data.browse.links}
        selectedId={selectedId}
        onSelect={selectNode}
        rsYear={data.metadata.rsYear}
      />

      <div className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-2xl border border-mirai-border bg-card px-3 py-1.5 text-xs text-mirai-text-subtle shadow-xs">
        <Link href="/mof-kou" className="text-primary underline underline-offset-4 hover:text-primary-accent">
          ← 項一覧
        </Link>
        <span className="text-mirai-text-placeholder">|</span>
        <span className="font-bold text-mirai-text">{data.metadata.sectionName}</span>
        <span>
          {data.metadata.ministry} / {data.metadata.eraLabel} {data.metadata.budgetType}
          {data.metadata.rsYear ? ` / RS${data.metadata.rsYear}年度データ` : ''}
        </span>
      </div>
      <div className="absolute right-3 top-3 z-30">
        <PageNavMenu current="/mof-kou" theme="light" />
      </div>
    </div>
  );
}
