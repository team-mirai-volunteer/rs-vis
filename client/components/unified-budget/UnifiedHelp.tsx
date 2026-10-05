'use client';

/**
 * サンキー図（/budget-sankey）のヘッダーの「説明」。図の読み方・データの出典・AI 評価（政策評価スコア）の考え方をまとめ、
 * 評価に使ったプロンプトの全文はアコーディオンを開いたときだけ読み込む（public/policy-evaluation/prompt-{シート年度}.txt）。
 * 他のページ（バブルチャートなど）の「説明」と同じく、ボタンの下に浮かせて出す。
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HeaderHelp } from '@/client/components/HeaderHelp';
import { AXIS_META } from '@/client/components/quality/score-meta';
import { fiscalYearLabel } from '@/app/lib/rs-fiscal-year';

/** プロンプトを書き出してあるシート年度。無い年度は最新の版を案内する */
const PROMPT_YEARS = [2025, 2024];

export function PromptText({ sheetYear }: { sheetYear: number }) {
  const year = PROMPT_YEARS.includes(sheetYear) ? sheetYear : PROMPT_YEARS[0];
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch(`/policy-evaluation/prompt-${year}.txt`)
      .then(res => (res.ok ? res.text() : null))
      .then(t => { if (!cancelled) setText(t); })
      .catch(() => { if (!cancelled) setText(null); });
    return () => { cancelled = true; };
  }, [year]);
  if (text === undefined) return <p role="status" className="mt-2 text-mirai-text-muted">読み込み中…</p>;
  if (text === null) return <p className="mt-2 text-mirai-text-muted">プロンプトを読み込めませんでした。</p>;
  // ファイル冒頭の「# 採点モデル: 〜」（scripts/export-evaluation-prompt.mjs が書く）
  const model = /^# 採点モデル: (.+)$/m.exec(text)?.[1];
  return <>
    {model && <p className="mt-2 text-mirai-text-secondary"><span className="font-bold">採点モデル</span>　{model}</p>}
    <p className="mt-2 text-mirai-text-muted">{year}年版レビューシート（{fiscalYearLabel(year)}）の採点に使った全文です。</p>
    {/* リンクは文の途中で折り返さないよう、独立した行に置く */}
    <p className="mt-1"><a href={`/policy-evaluation/prompt-${year}.txt`} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-primary underline underline-offset-4 hover:text-primary-accent">テキストで開く ↗</a></p>
    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-mirai-surface p-2 text-[11px] leading-relaxed text-mirai-text-secondary">{text}</pre>
  </>;
}

export function UnifiedHelp({ sheetYear }: { sheetYear: number }) {
  const [promptOpen, setPromptOpen] = useState(false);
  return <HeaderHelp id="sankey-help" label="この図の説明">
        <h2 className="mb-2 text-[13px] font-bold">この図の読み方</h2>
        <dl className="space-y-2 text-mirai-text-subtle">
          <div><dt className="font-bold text-mirai-text">流れ</dt>
            <dd>左から、歳入 → 会計 → 所管（府省庁）→ 項 → 目 → 事業 → 支出先の順に、お金がどこからどこへ流れるかを1本の図で示します。帯の太さが金額です。列は右上の歯車（表示設定）で出し入れできます。</dd></div>
          <div><dt className="font-bold text-mirai-text">表示件数と「N件」</dt>
            <dd>各列は金額の大きい順に上位だけを出し、残りは「1,234事業」のような集約ノードにまとめます。上部のバーで表示件数と表示位置を変えられます。</dd></div>
          <div><dt className="font-bold text-mirai-text">「その他」</dt>
            <dd>支出先名が「その他」の行は、行政側が上位以外の支出先をまとめて記載したものです。図の集約ノード（「N支出先」）とは別のものです。</dd></div>
          <div><dt className="font-bold text-mirai-text">詳細パネル</dt>
            <dd>ノードをクリックすると左に詳細が出ます。事業なら政策評価・事業概要・予算・ブロック（委託構造）・支出先、支出先なら法人の情報・受注額・契約方式などを確認できます。</dd></div>
        </dl>
        <h2 className="mb-2 mt-4 text-[13px] font-bold">データについて</h2>
        <ul className="m-0 list-disc space-y-1 pl-4 text-mirai-text-subtle">
          <li>会計〜目：財務省の予算書（当初・補正・決算）。事業〜支出先：行政事業レビューシート（RSシステム）。</li>
          <li>RSシートの年度は「評価した事業の前年度の執行」を載せます（例：2025年版シート＝2024年度の執行）。</li>
          <li>金額はすべて1円単位です。直接の支出と再委託は同じお金を二重に数えることがあるため、合算に注意してください。</li>
          <li>契約方式・所在地は RS公開API、法人の説明は Wikipedia・Wikidata（法人番号で一致したもの）から補っています。</li>
        </ul>
        <h2 className="mb-2 mt-4 text-[13px] font-bold">政策評価スコア（AI評価）について</h2>
        <p className="text-mirai-text-subtle">レビューシートの記載をもとに、事業の評価・見直しに必要な材料がどれだけそろっているかを5つの観点で点数化したものです。事業そのものの良し悪しを断定するものではなく、気になる事業を探すためのスクリーニングの目安です。</p>
        <ul className="m-0 mt-2 list-none space-y-1 p-0">
          {AXIS_META.map(axis => <li key={axis.key} className="flex gap-2" title={axis.desc}>
            <span className="w-20 shrink-0 font-bold text-mirai-text">{axis.label}</span>
            <span className="shrink-0 whitespace-nowrap tabular-nums text-mirai-text-muted">重み{axis.weight}</span>
            <span className="min-w-0 truncate text-mirai-text-subtle">{axis.desc.split('\n')[0]}</span>
          </li>)}
        </ul>
        <p className="mt-2 text-mirai-text-muted">執行透明性は支出先データから機械的に計算し、それ以外の4つは AI が段階評価します。各観点にカーソルを合わせると詳しい基準が出ます。</p>
        <div className="mt-2">
          <Button variant="ghost" size="xs" aria-expanded={promptOpen} aria-controls="sankey-help-prompt" onClick={() => setPromptOpen(v => !v)} className="px-0 text-primary-accent">
            {promptOpen ? '▾' : '▸'} AI 評価に使ったプロンプト（全文）
          </Button>
          <div id="sankey-help-prompt">{promptOpen && <PromptText sheetYear={sheetYear} />}</div>
        </div>
  </HeaderHelp>;
}
