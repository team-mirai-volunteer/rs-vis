'use client';

/**
 * LP の数字（カードの figure・Hero の統計）をクリックすると、その計算根拠をモーダルで出す。
 * 根拠は app/lp/insights.ts の basis（使ったファイル・絞り方と計算の手順・検証テスト・根拠メモ）。
 * 数字そのものはそのまま見せ、下に小さく「計算根拠」と添えて押せることを示す。
 */
import { useRef, useState, type ReactNode } from 'react';
import { Calculator, ExternalLink, X } from 'lucide-react';
import type { InsightBasis } from '@/app/lp/insights';
import { useDialogFocus } from '@/client/hooks/useDialogFocus';

const REPO_BLOB = 'https://github.com/team-mirai-volunteer/rs-vis/blob/main/';

export function FigureBasis({ figure, note, basis, asOf, children }: {
  /** モーダルの見出しに出す数字 */
  figure: string;
  /** 数字の説明（figureNote や統計のラベル） */
  note: string;
  basis: InsightBasis;
  /** 集計日 */
  asOf: string;
  /** 押せる部分の中身（数字の表示そのもの） */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="この数字の計算根拠を開く"
        className="group/figure -mx-1 -my-0.5 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-mirai-surface-teal/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40">
        {children}
        <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-primary-accent group-hover/figure:underline">
          <Calculator className="size-3" aria-hidden="true" />
          計算根拠
        </span>
      </button>
      {open && <BasisDialog figure={figure} note={note} basis={basis} asOf={asOf} onClose={() => setOpen(false)} />}
    </>
  );
}

function BasisDialog({ figure, note, basis, asOf, onClose }: { figure: string; note: string; basis: InsightBasis; asOf: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  const docUrl = REPO_BLOB + basis.doc.split('/').map(encodeURIComponent).join('/');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="figure-basis-heading"
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-3xl border border-mirai-border bg-card shadow-soft"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-mirai-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-bold text-primary-accent">計算根拠</p>
            <h2 id="figure-basis-heading" className="mt-1 font-lexend text-2xl font-medium tracking-normal text-mirai-text">{figure}</h2>
            <p className="mt-1 text-sm text-mirai-text-subtle">{note}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる（Esc）" title="閉じる（Esc）"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-mirai-text-muted hover:bg-mirai-surface hover:text-mirai-text">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4 text-sm leading-relaxed sm:px-6">
          <section>
            <h3 className="text-xs font-bold text-mirai-text">使ったデータ</h3>
            <ul className="mt-1.5 space-y-1 text-mirai-text-subtle">
              {basis.data.map(item => <li key={item} className="flex gap-2"><span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />{item}</li>)}
            </ul>
          </section>
          <section className="mt-4">
            <h3 className="text-xs font-bold text-mirai-text">絞り方と計算</h3>
            <ol className="mt-1.5 space-y-2 text-mirai-text-subtle">
              {basis.steps.map((step, i) => (
                <li key={step} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-mirai-surface-teal text-[11px] font-bold text-primary-accent" aria-hidden="true">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>
          {basis.test && (
            <p className="mt-4 rounded-xl bg-mirai-surface-teal px-3 py-2 text-xs leading-relaxed text-mirai-text">
              <span className="font-bold">検証：</span>{basis.test}
            </p>
          )}
          <p className="mt-4 rounded-xl bg-mirai-surface px-3 py-2 text-xs leading-relaxed text-mirai-text-note">
            集計日 {asOf}。public/data の生成物（各府省が公表したレビューシート等を当サイトで加工したもの）を集計した値です。上の手順と同じ定義で再計算するスクリプト（scripts/verify-lp-figures.ts）があり、載せている数字と一致することを確かめています。原資料（概算要求の概要・租税特別措置の報告書）から読んだ数字は、そのページ・表を手順に記しています。
          </p>
          <a href={docUrl} target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-primary-accent hover:underline">
            根拠メモを GitHub で開く <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
