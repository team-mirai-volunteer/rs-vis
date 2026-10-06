'use client';

/** 評価一覧（/quality）のヘッダーの「説明」。指標・推奨判断・使い方・AI 評価のプロンプトをまとめる */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HeaderHelp } from '@/client/components/HeaderHelp';
import { PromptText } from '@/client/components/unified-budget/UnifiedHelp';
import { AI_EVALUATION_NATURE, AI_EVALUATION_TITLE, AXIS_META } from './score-meta';
import { RECOMMENDATION_ORDER, IMPROVEMENT_ACTION_ORDER } from '@/app/lib/policy-evaluation';

export function QualityHelp({ sheetYear }: { sheetYear: number }) {
  const [promptOpen, setPromptOpen] = useState(false);
  return <HeaderHelp id="quality-help" label="評価一覧の説明">
    <h2 className="mb-2 text-[13px] font-bold">この一覧について</h2>
    <p className="text-mirai-text-subtle">行政事業レビューシートの全事業を、{AI_EVALUATION_TITLE}と執行透明性で並べた一覧です。{AI_EVALUATION_NATURE}事業の良し悪しを断定するものではなく、詳しく確認したい事業を探すスクリーニングに使ってください。</p>
    <h2 className="mb-2 mt-4 text-[13px] font-bold">指標（0〜100点）</h2>
    <ul className="m-0 list-none space-y-1 p-0">
      {AXIS_META.map(axis => <li key={axis.key} className="flex gap-2" title={axis.desc}>
        <span className="w-20 shrink-0 font-bold text-mirai-text">{axis.label}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums text-mirai-text-muted">重み{axis.weight}</span>
        <span className="min-w-0 truncate text-mirai-text-subtle">{axis.desc.split('\n')[0]}</span>
      </li>)}
    </ul>
    <p className="mt-2 text-mirai-text-muted">総合点は5つの重み付き平均です。執行透明性は支出先データから機械的に計算し、それ以外の4つは AI が段階評価します。欠けている指標は0点にせず、重みごと除いて計算します。</p>
    <h2 className="mb-2 mt-4 text-[13px] font-bold">推奨と改善アクション</h2>
    <dl className="space-y-1.5 text-mirai-text-subtle">
      <div><dt className="inline font-bold text-mirai-text">推奨：</dt><dd className="inline">{Object.keys(RECOMMENDATION_ORDER).join('・')}。総合点の絶対値ではなく母集団内の順位帯（「終了・廃止候補」は最下位5%のうち代替困難性・成果設計も下位の事業）で判定します。「縮小」だけは2年連続の不用額から判定します。下位にあることは廃止が妥当であることを意味しません。「終了・廃止候補」は結論ではなく、議論に回すための候補です。</dd></div>
      <div><dt className="inline font-bold text-mirai-text">改善アクション：</dt><dd className="inline">{Object.keys(IMPROVEMENT_ACTION_ORDER).join('・')}。推奨とは別に、何を直せばよいかを示します。「収支是正」は収支の一致が60点未満のときに出します（順位帯ではなく固定の基準）。</dd></div>
    </dl>
    <h2 className="mb-2 mt-4 text-[13px] font-bold">使い方</h2>
    <ul className="m-0 list-disc space-y-1 pl-4 text-mirai-text-subtle">
      <li>左の分布の棒をクリックすると、その点数帯だけに絞り込めます。「分布の軸」で指標を切り替えられます。</li>
      <li>各指標・金額・継続年数は下限〜上限で絞り込めます。「条件をクリア」ですべての条件を戻します。</li>
      <li>列見出しのクリックで並べ替え、見出しにカーソルを合わせると定義が出ます。</li>
      <li>行の「詳細」で、評価の根拠・事業内容・支出先（契約方式・法人番号の確認結果）・委託構造を確認できます。</li>
    </ul>
    <div className="mt-3">
      <Button variant="ghost" size="xs" aria-expanded={promptOpen} aria-controls="quality-help-prompt" onClick={() => setPromptOpen(v => !v)} className="px-0 text-primary-accent">
        {promptOpen ? '▾' : '▸'} AI 評価に使ったプロンプト（全文）
      </Button>
      <div id="quality-help-prompt">{promptOpen && <PromptText sheetYear={sheetYear} />}</div>
    </div>
  </HeaderHelp>;
}
