'use client';

/**
 * サイドパネルの「目」タブ。項・RS事業では見せ方が違う:
 *
 * - 項ノード選択時（mode='section'）: その項の目一覧（`/api/mof-kou/detail`）を
 *   金額の大きい順に出し、RS紐づけがある目には繋がるRS事業名を添える
 * - RS事業ノード選択時（mode='project'）: その事業が計上されている目を
 *   `/api/mof-sankey/rs-project` から集め、どの項のどの目かを1行ずつ出す
 *   （1つの事業が複数の項にまたがることがあるため、項名も併記する）
 *
 * main API（/api/mof-sankey）には目単位の明細までは含めていないため、
 * タブを開いたときに遅延取得する（/mof-kou の行展開と同じ方針）。
 * fetch 自体は useKouMokuDetail に閉じ、ここは表示に専念する（Layer Design Rules）。
 */

import { useEffect } from 'react';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { useKouMokuDetail, type KouMokuDetailParams } from '@/client/hooks/useKouMokuDetail';

type Props = KouMokuDetailParams & {
  /** 取得できた件数。他のタブと同じく見出しに件数を出すため、親へ伝える */
  onCount?: (count: number) => void;
};

export function KouMokuTab({ onCount, ...params }: Props) {
  const { rows, error } = useKouMokuDetail(params);

  useEffect(() => {
    if (rows) onCount?.(rows.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onCount は親のsetStateで安定しているため対象外
  }, [rows]);

  if (error) return <div className="p-4 text-xs text-red-600">目の取得に失敗しました</div>;
  if (!rows) return <div className="p-4 text-xs text-gray-400">読み込み中…</div>;
  if (rows.length === 0) return <div className="p-4 text-xs text-gray-400">該当する目がありません</div>;

  return (
    <div className="p-4 pt-1">
      {rows.map((r, i) => (
        <div key={`${i}-${r.subItemName}`} className="flex items-baseline justify-between gap-3 border-b border-gray-50 py-1.5">
          <div className="min-w-0">
            {r.sectionName && <div className="truncate text-[10px] text-gray-400">{r.sectionName}</div>}
            {r.sourceUrl ? (
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-xs text-gray-700 underline hover:text-gray-900"
              >
                {r.subItemName}
              </a>
            ) : (
              <div className="truncate text-xs text-gray-700" title={r.page === undefined ? undefined : '出典ページ不明'}>
                {r.subItemName}
              </div>
            )}
            {r.rsProjectNames && r.rsProjectNames.length > 0 && (
              <div className="truncate text-[10px] text-emerald-600">→ {r.rsProjectNames.join('、')}</div>
            )}
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-gray-500">{formatBudgetFromYen(r.amount)}</span>
        </div>
      ))}
    </div>
  );
}
