'use client';

/**
 * 統合ビューの絞り込み入力欄。
 * 上段は `/mof-sankey` の FilterFields と同じ（会計・所管・名前。表示オプションはギアの UnifiedSettings へ移した）、
 * 下段は `/sankey-svg` から移植した事業・支出先単位の絞り込み（事業名・予算額・支出額・再委託・支出先名・政策評価スコア）。
 * 判定は app/lib/unified-budget/transform.ts の applyFilter（純関数）。ここは入力欄だけ。
 */

import { UNIFIED_FILTER_DEFAULT, type UnifiedScoreRange, type UnifiedViewFilter , UNIFIED_SCORE_FIELDS } from '@/types/unified-budget-view';
import { Button } from '@/components/ui/button';
import { MinMaxInput } from '@/components/filters/MinMaxInput';
import { MultiSelectDropdown } from '@/components/filters/MultiSelectDropdown';
import { RegexTextFilter } from '@/client/components/mof-kou/RegexTextFilter';
import { cn } from '@/lib/utils';

/** 政策評価スコアの取得状況（ページが /api/policy-summary を読む） */
export type UnifiedScoreStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

const ACCOUNT_OPTIONS: Array<{ value: 'general' | 'special'; label: string }> = [
  { value: 'general', label: '一般会計' },
  { value: 'special', label: '特別会計' },
];

const SUBCONTRACT_OPTIONS: Array<{ value: UnifiedViewFilter['subcontract']; label: string; title: string }> = [
  { value: 'any', label: '指定なし', title: '再委託の有無で絞り込まない' },
  { value: 'has', label: 'あり', title: '再委託（支出先からさらに先への委託）の記載がある事業だけを残す' },
  { value: 'none', label: 'なし', title: '再委託の記載が無い（直接支出のみ）事業だけを残す' },
];

const INPUT_CLASS =
  'h-7 w-full rounded-md border border-mirai-border bg-card px-2 text-xs text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary';
const SMALL_NUMBER_CLASS =
  'h-6 w-14 rounded-md border border-mirai-border bg-card px-1.5 text-center text-xs text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary';

export function UnifiedFilterFields({
  filter,
  onFilterChange,
  ministryOptions,
  hasSpending = true,
  scoreStatus = 'idle',
}: {
  filter: UnifiedViewFilter;
  onFilterChange: (next: UnifiedViewFilter) => void;
  ministryOptions: string[];
  /** 事業(支出)・支出先の列がある年度か。無ければ支出額・支出先名・再委託の欄を出さない */
  hasSpending?: boolean;
  scoreStatus?: UnifiedScoreStatus;
}) {
  const set = (patch: Partial<UnifiedViewFilter>) => onFilterChange({ ...filter, ...patch });
  const toggleAccount = (value: 'general' | 'special') =>
    set({ accountTypes: filter.accountTypes.includes(value) ? filter.accountTypes.filter(a => a !== value) : [...filter.accountTypes, value] });

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-mirai-text-subtle">
      {/* 「非事業支出・未突合のノードを出す」「国債整理基金特会・交付税特会を含める」は表示設定（ギア）へ移した */}
      <div>
        <div className="mb-1 font-medium">会計</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {ACCOUNT_OPTIONS.map(({ value, label }) => (
            <label key={value} className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={filter.accountTypes.includes(value)} onChange={() => toggleAccount(value)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 font-medium">所管</div>
        {/* 評価一覧・バブルチャートと同じドロップダウン。チェックボックスの一覧を並べると 40 件近くで縦スクロールが要り、
            まとめて外す手段も無かった。ドロップダウンは「すべて解除」と × のクリアを持つ */}
        <div className="flex">
          <MultiSelectDropdown
            options={ministryOptions}
            selected={filter.ministries}
            onChange={ministries => set({ ministries })}
            allLabel="所管"
            placeholder="所管：すべて"
            placeholderTone="strong"
            minWidth={0}
            triggerClassName="h-7 w-full border-mirai-border text-xs"
          />
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-mirai-text-muted">「A及びB」の共管は、どちらを選んでも含まれます。</p>
      </div>
      <div>
        <div className="mb-1 font-medium" title="部分一致。一致したノードとその上流・下流だけを残す">名前</div>
        <input
          type="text"
          value={filter.nameQuery}
          onChange={e => set({ nameQuery: e.target.value })}
          placeholder="事業名・項名・支出先名…"
          aria-label="名前で絞り込み"
          className={INPUT_CLASS}
        />
      </div>

      {/* ---- /sankey-svg から移植: 事業単位の絞り込み ---- */}
      <div className="flex flex-col gap-2 border-t border-mirai-border pt-3">
        <div className="font-medium" title="条件に合わない事業は事業(支出)・支出先ごと落とす">事業</div>
        {filter.projectIds.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-md bg-mirai-surface-teal px-2 py-1" data-testid="ai-selected-projects">
            <span>AI が選んだ {filter.projectIds.length} 事業だけを表示中（選び方は AI の応答を参照）</span>
            <Button variant="link" size="xs" onClick={() => set({ projectIds: [] })}>解除</Button>
          </div>
        )}
        <RegexTextFilter
          label="事業名"
          note="RS事業の名前で絞り込む。`.*` で正規表現（大文字小文字を区別しない）"
          value={filter.projectQuery}
          onChange={v => set({ projectQuery: v })}
          useRegex={filter.projectRegex}
          onToggleRegex={v => set({ projectRegex: v })}
        />
        <AmountRow label="予算額" title="事業列の値（歳出予算現額など。基準に従う）の下限・上限。例: 100億、1兆">
          <MinMaxInput minVal={filter.budgetMin} maxVal={filter.budgetMax} onMinChange={v => set({ budgetMin: v })} onMaxChange={v => set({ budgetMax: v })} />
        </AmountRow>
        {hasSpending && (
          <AmountRow label="支出額" title="事業(支出)列の値（支出先への支出合計）の下限・上限。下限を指定すると支出の記載が無い事業は落ちる">
            <MinMaxInput minVal={filter.spendingMin} maxVal={filter.spendingMax} onMinChange={v => set({ spendingMin: v })} onMaxChange={v => set({ spendingMax: v })} />
          </AmountRow>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {hasSpending && (<>
            <span className="w-14 shrink-0 font-medium" title="再委託（支出先からさらに先への委託）の記載の有無">
              再委託
            </span>
            <div className="flex overflow-hidden rounded-md border border-mirai-border" role="radiogroup" aria-label="再委託の有無">
              {SUBCONTRACT_OPTIONS.map(({ value, label, title }) => (
                <Button
                  key={value}
                  variant="ghost"
                  size="xs"
                  role="radio"
                  aria-checked={filter.subcontract === value}
                  title={title}
                  onClick={() => set({ subcontract: value })}
                  className={cn(
                    'h-6 rounded-none px-2 text-[11px]',
                    filter.subcontract === value ? 'bg-mirai-surface-teal text-primary-accent hover:bg-mirai-surface-teal' : 'text-mirai-text-muted hover:bg-transparent hover:text-mirai-text'
                  )}
                >
                  {label}
                </Button>
              ))}
            </div>
            {filter.subcontract === 'has' && (
              <label className="flex items-center gap-1" title="2 = 再委託、3 = 再々委託…。この階層以上の再委託がある事業を残す">
                <span>階層</span>
                <input
                  type="number"
                  min={2}
                  step={1}
                  value={filter.subcontractMinDepth}
                  onChange={e => {
                    const v = Math.floor(Number(e.target.value));
                    set({ subcontractMinDepth: Number.isFinite(v) && v >= 2 ? v : 2 });
                  }}
                  aria-label="再委託階層の下限"
                  className={SMALL_NUMBER_CLASS}
                />
                <span>以上</span>
              </label>
            )}
          </>)}
          {/* 継続年数。再委託と同じ行にまとめる（政策評価サマリの値。範囲を指定すると開始年度の記載が無い事業は落ちる） */}
          <label className={cn('flex items-center gap-1', hasSpending && 'ml-1')} title="継続年数（対象年度 − 開始年度 + 1）。範囲を指定すると開始年度の記載が無い事業は落ちる">
            <span className="shrink-0 font-medium">継続年数</span>
            <input type="number" min={0} max={200} step={1} value={filter.years.min} onChange={e => set({ years: { ...filter.years, min: e.target.value } })} placeholder="下限" aria-label="継続年数の下限" className={SMALL_NUMBER_CLASS} />
            <span className="text-[11px] text-mirai-text-muted">~</span>
            <input type="number" min={0} max={200} step={1} value={filter.years.max} onChange={e => set({ years: { ...filter.years, max: e.target.value } })} placeholder="上限" aria-label="継続年数の上限" className={SMALL_NUMBER_CLASS} />
          </label>
        </div>
      </div>

      {hasSpending && (
        <div className="flex flex-col gap-2 border-t border-mirai-border pt-3">
          <div className="font-medium">支出先（一致しない支出先を落とし、支出先が残らない事業も落とす）</div>
          <RegexTextFilter
            label="支出先名"
            note="支出先の名前で絞り込む。`.*` で正規表現（大文字小文字を区別しない）"
            value={filter.recipientQuery}
            onChange={v => set({ recipientQuery: v })}
            useRegex={filter.recipientRegex}
            onToggleRegex={v => set({ recipientRegex: v })}
          />
          <label
            className="flex cursor-pointer items-center gap-1.5"
            title="オンにすると事業単位の判定になり、直接支出先または再委託先のどちらかに名前が一致する事業を残します（支出先ノード自体は隠しません）"
          >
            <input
              type="checkbox"
              checked={filter.recipientIncludeSub}
              onChange={() => set({ recipientIncludeSub: !filter.recipientIncludeSub })}
              disabled={filter.recipientQuery.trim() === ''}
              className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-default"
            />
            <span className={filter.recipientQuery.trim() === '' ? 'text-mirai-text-muted' : undefined}>再委託先も含めて判定する</span>
          </label>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-mirai-border pt-3">
        <div className="font-medium" title="AI政策評価のスコア（0〜100）。/quality と同じ値。範囲を指定した項目で評価が無い事業は落とす">
          政策評価スコア（0〜100）
        </div>
        {/* 評価一覧と同じ 6 項目。2 列 × 3 行 */}
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {UNIFIED_SCORE_FIELDS.map(s => (
            <ScoreRow key={s.field} label={s.short} ariaLabel={s.label} title={`${s.label}: ${s.title}`} compact range={filter[s.field]} onChange={r => set({ [s.field]: r })} />
          ))}
        </div>
        {scoreStatus === 'loading' && <p className="text-[10px] text-mirai-text-muted">政策評価を読み込み中…（取得できるまでスコアの絞り込みは効きません）</p>}
        {scoreStatus === 'unavailable' && <p className="text-[10px] text-destructive">政策評価を取得できませんでした。スコアの絞り込みは効いていません</p>}
      </div>

      <Button variant="link" onClick={() => onFilterChange(UNIFIED_FILTER_DEFAULT)} className="self-start text-[11px] font-medium">
        絞り込みを既定に戻す
      </Button>
    </div>
  );
}

function AmountRow({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 font-medium" title={title}>
        {label}
      </span>
      {children}
    </div>
  );
}

function ScoreRow({ label, ariaLabel = label, title, range, onChange, max = 100, compact = false }: { label: string; ariaLabel?: string; title: string; range: UnifiedScoreRange; onChange: (r: UnifiedScoreRange) => void; max?: number; /** 2 列に並べるときの短い見出し（幅を詰める） */ compact?: boolean }) {
  const bound = (v: string) => {
    const t = v.trim();
    return t === '' || (Number.isFinite(Number(t)) && Number(t) >= 0 && Number(t) <= max);
  };
  const cls = (ok: boolean) => cn(SMALL_NUMBER_CLASS, !ok && 'border-destructive focus-visible:border-destructive');
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('shrink-0 font-medium', compact ? 'w-9' : 'w-20')} title={title}>
        {label}
      </span>
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        value={range.min}
        onChange={e => onChange({ ...range, min: e.target.value })}
        placeholder="下限"
        aria-label={`${ariaLabel}の下限`}
        aria-invalid={!bound(range.min) || undefined}
        className={cls(bound(range.min))}
      />
      <span className="text-[11px] text-mirai-text-muted">~</span>
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        value={range.max}
        onChange={e => onChange({ ...range, max: e.target.value })}
        placeholder="上限"
        aria-label={`${ariaLabel}の上限`}
        aria-invalid={!bound(range.max) || undefined}
        className={cls(bound(range.max))}
      />
      {(range.min || range.max) && (
        <Button variant="link" size="xs" onClick={() => onChange({ min: '', max: '' })} className="h-auto px-1 text-[10px]">
          クリア
        </Button>
      )}
    </div>
  );
}
