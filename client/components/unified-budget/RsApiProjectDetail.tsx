'use client';
import { useEffect, useState } from 'react';
import type { RsApiDetail } from '@/types/rs-api';

const yen = (amount: number | null) => amount === null || amount < 0 ? '未確認・非公表' : `${amount.toLocaleString()}円`;
export function RsApiProjectDetail({ projectId }: { projectId: number }) {
  const [detail, setDetail] = useState<RsApiDetail | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/rs-provisional/${projectId}`, { signal: controller.signal })
      .then(r => { if (!r.ok) throw Error(String(r.status)); return r.json(); })
      .then(setDetail).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [projectId]);
  if (!detail) return <p className="py-2 text-xs">{failed ? '暫定データを取得できませんでした' : '暫定データを読み込み中…'}</p>;
  const labels = new Map(detail.groups.map(g => [g.id, g.display_code]));
  return <div className="space-y-3 py-3 text-xs" data-testid="rs-api-project-detail">
    <p><strong>{detail.fiscalYear}年度執行額：{yen(detail.execution)}</strong><br />RS公開APIからの暫定取得。政策評価は未実施です。</p>
    <p className="whitespace-pre-wrap">{detail.overview}</p>
    {detail.paymentStatus !== 'available' ? <p>支出先データは未取得です。0円を意味しません。</p> : <>
      {(detail.execution === null || detail.execution === 0) && <p>正の執行額を確認できないため、以下の想定支出先を含み得る記載はグラフに接続していません。</p>}
      <p>記載された支出先の金額は、執行額と一致しない場合があります。再委託を含む全ブロックを下に表示しています。</p>
      {detail.groups.length === 0 && <p>公開シートに支出先ブロックの記載はありません。</p>}
      {detail.groups.map(g => <details key={g.id} className="rounded border border-mirai-border p-2">
        <summary className="cursor-pointer">{g.display_code}. {g.name}：{yen(g.total_amount)}</summary>
        <p className="py-2">{g.overview}</p>
        {g.payments.map(p => <div key={p.id} className="border-t border-mirai-border py-2">
          <p className="font-bold">{p.name}：{yen(p.total_contract_amount)}</p>
          {p.corporate_number && <p>法人番号 {p.corporate_number}</p>}
          {p.contracts.map((c, i) => <div key={i} className="mt-1"><p>{c.overview}：{yen(c.amount)}</p>
            {c.amount_breakdown.map((e, j) => <p key={j} className="text-mirai-text-muted">{e.name} / {e.purpose}：{yen(e.amount)}</p>)}
          </div>)}
        </div>)}
      </details>)}
      {detail.edges.length > 0 && <details><summary className="cursor-pointer">ブロック間の資金の流れ</summary>
        {detail.edges.map((e, i) => <p key={i}>{e.is_connected_to_source_root ? detail.ministry : labels.get(e.source_node_id ?? '') ?? '起点未確認'} → {labels.get(e.target_node_id) ?? '接続先未確認'} {e.label}</p>)}
      </details>}
    </>}
    <a href={detail.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">RSの原本を見る</a>
  </div>;
}
