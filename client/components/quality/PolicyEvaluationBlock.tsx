'use client';

/**
 * サイドパネルの政策評価ブロック。/sankey-svg と /subcontracts/[projectId] で共用する。
 *
 * データの取り方はページごとに違う（サンキーは全件サマリを既に持っている、
 * 再委託ビューは1事業だけ引く）ため、このコンポーネントは表示に専念し、
 * 呼び出し側が `view` を組み立てて渡す。
 *
 * 色はチームみらいデザインシステムのトークン（Tailwind クラス）で当てる。
 * フォントサイズだけは呼び出し側のフォントスケール（labelPx / metaPx）に従うため inline のまま。
 */

import { rsViewUrl } from '@/app/lib/rs-fiscal-year';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { scoreColor } from '@/client/components/quality/score-format';
import { TONE_CLS, ACTION_CLS } from '@/client/components/quality/score-meta';

/** 表示に必要な最小セット。呼び出し側がサマリ or 単体評価から組み立てる */
export interface PolicyEvaluationView {
  /** 総合点（0-100） */
  overall: number | null;
  /** 成果設計・検証可能性・執行透明性。渡すと 5 軸すべてを並べる（幅のあるパネル向け）。省略時は総合・費用対内容・必要性の 3 つ */
  designClarity?: number | null;
  evidence?: number | null;
  transparency?: number | null;
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

/** /quality の推奨バッジ（TONE_CLS）と同じ配色。判断の強さで色を変える */
function recommendationCls(rec: string): string {
  if (rec === '継続') return TONE_CLS.green;
  if (rec === '要改善') return TONE_CLS.blue;
  if (rec === '再設計' || rec === '終了・廃止候補') return TONE_CLS.red;
  return TONE_CLS.amber;
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
      <div className="shrink-0 border-b border-border px-3.5 py-[7px]">
        <span className="font-bold text-mirai-text-subtle" style={{ fontSize: labelPx }}>政策評価</span>
        <span className="ml-2 text-destructive" style={{ fontSize: metaPx }}>
          読み込めませんでした（{error}）
        </span>
      </div>
    );
  }
  if (!view) return null;   // 取得中・スコアなしはブロックごと出さない（パネルのちらつき防止）

  // 既定は、総合点への寄与が最も大きく所管庁の作文が支配しにくい2軸（費用対内容・必要性）＋総合点。
  // 残り3軸（成果設計・検証可能性・執行透明性）は呼び出し側が渡したときだけ並べる（統合ビューの広いパネル）。
  const full = view.designClarity !== undefined || view.evidence !== undefined || view.transparency !== undefined;
  const cells: Array<[string, number | null]> = full
    ? [
        ['総合点', view.overall], ['成果設計', view.designClarity ?? null], ['検証可能性', view.evidence ?? null],
        ['執行透明性', view.transparency ?? null], ['費用対内容', view.proportionality], ['必要性', view.necessity],
      ]
    : [['総合点', view.overall], ['費用対内容', view.proportionality], ['必要性', view.necessity]];

  return (
    <div className="shrink-0 border-b border-border px-3.5 py-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-bold text-mirai-text-subtle" style={{ fontSize: labelPx }}>政策評価</span>
        <span className="text-mirai-text-muted" style={{ fontSize: metaPx }}>暫定</span>
        {view.categoryLabel && (
          <span
            className="whitespace-nowrap rounded-full bg-mirai-surface-light px-1.5 py-px text-mirai-text-subtle"
            style={{ fontSize: metaPx }}
          >
            {view.categoryLabel}
          </span>
        )}
        {onOpenDetail && (
          <Button
            variant="link"
            onClick={onOpenDetail}
            disabled={detailLoading}
            title="スコアの詳細（判定理由・支出先一覧）を開く"
            className={cn('ml-auto shrink-0 font-normal no-underline hover:underline hover:text-primary-accent', detailLoading && 'cursor-wait')}
            style={{ fontSize: metaPx }}
          >{detailLoading ? '読込中…' : '詳細'}</Button>
        )}
        <a
          href={rsViewUrl(`/quality?pid=${pid}`, year)}
          target="_blank"
          rel="noopener noreferrer"
          className={cn('shrink-0 text-primary underline-offset-4 hover:underline hover:text-primary-accent', onOpenDetail ? 'ml-2' : 'ml-auto')}
          style={{ fontSize: metaPx }}
        >一覧で見る →</a>
      </div>
      <div className={cn('flex items-end', full ? 'flex-wrap gap-y-2 gap-x-3' : 'gap-3.5')}>
        {cells.map(([label, value]) => (
          <div key={label} className="text-center">
            <div
              className={cn('font-mono font-bold leading-none', scoreColor(value))}
              style={{ fontSize: labelPx + 4 }}
            >
              {value ?? '—'}
            </div>
            <div className="mt-[3px] text-mirai-text-muted" style={{ fontSize: metaPx }}>{label}</div>
          </div>
        ))}
        <div className={cn('flex flex-wrap justify-end gap-1', full ? 'basis-full justify-start' : 'ml-auto')}>
          {view.recommendation && (
            <span
              className={cn('whitespace-nowrap rounded-full px-[7px] py-0.5 font-bold', recommendationCls(view.recommendation))}
              style={{ fontSize: metaPx }}
            >
              {view.recommendation}
            </span>
          )}
          {view.improvementAction && (
            <span
              className={cn('whitespace-nowrap rounded-full px-[7px] py-0.5 font-bold', ACTION_CLS)}
              style={{ fontSize: metaPx }}
            >
              {view.improvementAction}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
