'use client';

/**
 * サイドパネルの政策評価ブロック。/sankey-svg と /subcontracts/[projectId] で共用する。
 *
 * データの取り方はページごとに違う（サンキーは全件サマリを既に持っている、
 * 再委託ビューは1事業だけ引く）ため、このコンポーネントは表示に専念し、
 * 呼び出し側が `view` を組み立てて渡す。
 */

/** 表示に必要な最小セット。呼び出し側がサマリ or 単体評価から組み立てる */
export interface PolicyEvaluationView {
  /** 総合点（0-100） */
  overall: number | null;
  /** 費用対内容（0-100） */
  proportionality: number | null;
  /** 必要性（0-100） */
  necessity: number | null;
  /** 推奨判断の表示名。未判定は null */
  recommendation: string | null;
  /** 改善アクションの表示名。無しは null */
  improvementAction: string | null;
  /** 政策類型の表示名。未分類は null */
  categoryLabel: string | null;
}

/** /quality と同じ配色。判断の強さで色を変える */
function recommendationColor(rec: string | null): string {
  if (!rec) return '#999';
  if (rec === '継続') return '#2d7d46';
  if (rec === '要改善') return '#3b82f6';
  if (rec === '再設計' || rec === '終了・廃止候補') return '#d94545';
  return '#d98a20';
}

function scoreColor(v: number | null): string {
  if (v == null) return '#999';
  if (v >= 90) return '#2d7d46';
  if (v >= 70) return '#3b82f6';
  if (v >= 50) return '#d98a20';
  return '#d94545';
}

export function PolicyEvaluationBlock({
  view,
  pid,
  year,
  error,
  labelPx,
  metaPx,
  onOpenDetail,
  detailLoading = false,
}: {
  /** null = スコアなし（何も描かない）。undefined = 取得中 */
  view: PolicyEvaluationView | null | undefined;
  pid: string | number;
  /** 「一覧で見る →」に付ける年度。付けないと /quality が既定年度で開く */
  year: string | number;
  /** 取得に失敗したときのメッセージ。表示だけ落として本体の動作は妨げない */
  error?: string | null;
  labelPx: number;
  metaPx: number;
  /** スコア詳細ダイアログを開く。省略時は「詳細」を出さない */
  onOpenDetail?: () => void;
  detailLoading?: boolean;
}) {
  if (error) {
    return (
      <div style={{ borderBottom: '1px solid #f0f0f0', flexShrink: 0, padding: '7px 14px' }}>
        <span style={{ fontSize: labelPx, fontWeight: 600, color: '#555' }}>政策評価</span>
        <span style={{ marginLeft: 8, fontSize: metaPx, color: '#c0392b' }}>
          読み込めませんでした（{error}）
        </span>
      </div>
    );
  }
  if (!view) return null;   // 取得中・スコアなしはブロックごと出さない（パネルのちらつき防止）

  // 5軸のうち、総合点への寄与が最も大きく所管庁の作文が支配しにくい2軸を並べる。
  // 残り3軸（成果設計・検証可能性・執行透明性）は詳細ダイアログ側で確認する。
  const cells: Array<[string, number | null]> = [
    ['総合点', view.overall], ['費用対内容', view.proportionality], ['必要性', view.necessity],
  ];

  return (
    <div style={{ borderBottom: '1px solid #f0f0f0', flexShrink: 0, padding: '8px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: labelPx, fontWeight: 600, color: '#555' }}>政策評価</span>
        <span style={{ fontSize: metaPx, color: '#aaa' }}>暫定</span>
        {view.categoryLabel && (
          <span style={{ background: '#f0f0f0', color: '#666', padding: '1px 6px', borderRadius: 9, fontSize: metaPx, whiteSpace: 'nowrap' }}>
            {view.categoryLabel}
          </span>
        )}
        {onOpenDetail && (
          <button
            type="button"
            onClick={onOpenDetail}
            disabled={detailLoading}
            title="スコアの詳細（判定理由・支出先一覧）を開く"
            style={{
              marginLeft: 'auto', fontSize: metaPx, color: '#4a90d9', background: 'none',
              border: 'none', padding: 0, cursor: detailLoading ? 'wait' : 'pointer', flexShrink: 0,
            }}
          >{detailLoading ? '読込中…' : '詳細'}</button>
        )}
        <a
          href={`/quality?pid=${pid}&year=${year}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: onOpenDetail ? 8 : 'auto', fontSize: metaPx, color: '#4a90d9', textDecoration: 'none', flexShrink: 0 }}
        >一覧で見る →</a>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
        {cells.map(([label, value]) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: labelPx + 4, fontWeight: 700, lineHeight: 1, color: scoreColor(value), fontFamily: 'monospace' }}>
              {value ?? '—'}
            </div>
            <div style={{ fontSize: metaPx, color: '#999', marginTop: 3 }}>{label}</div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginLeft: 'auto', justifyContent: 'flex-end' }}>
          {view.recommendation && (
            <span style={{ background: recommendationColor(view.recommendation), color: '#fff', padding: '2px 7px', borderRadius: 10, fontSize: metaPx, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {view.recommendation}
            </span>
          )}
          {view.improvementAction && (
            <span style={{ background: '#e8f1fb', color: '#2b6cb0', padding: '2px 7px', borderRadius: 10, fontSize: metaPx, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {view.improvementAction}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
