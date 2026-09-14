'use client';

/**
 * 統合ビューの絞り込み入力欄。
 * 上段は `/mof-sankey` の FilterFields と同じ（表示・会計・所管・名前）、
 * 下段は `/sankey-svg` から移植した事業・支出先単位の絞り込み（事業名・予算額・支出額・再委託・支出先名・政策評価スコア）。
 * 判定は app/lib/unified-budget/transform.ts の applyFilter（純関数）。ここは入力欄だけ。
 */

import { UNIFIED_FILTER_DEFAULT, type UnifiedScoreRange, type UnifiedViewFilter } from '@/types/unified-budget-view';
import { Button } from '@/components/ui/button';
import { MinMaxInput } from '@/components/filters/MinMaxInput';
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
  { value: 'has', label: '再委託あり', title: '再委託（支出先からさらに先への委託）の記載がある事業だけを残す' },
  { value: 'none', label: '再委託なし', title: '再委託の記載が無い（直接支出のみ）事業だけを残す' },
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
  const toggleMinistry = (name: string) =>
    set({ ministries: filter.ministries.includes(name) ? filter.ministries.filter(m => m !== name) : [...filter.ministries, name] });

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-mirai-text-subtle">
      <div>
        <div className="mb-1 font-medium">表示</div>
        <div className="flex flex-col gap-1">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={filter.showNonRs} onChange={() => set({ showNonRs: !filter.showNonRs })} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
            <span>非事業支出・未突合のノードを出す（繰入・国債費・地方財政移転・予備費・人件費）</span>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={filter.includeCollapsedAccounts}
              onChange={() => set({ includeCollapsedAccounts: !filter.includeCollapsedAccounts })}
              className="h-3.5 w-3.5 cursor-pointer accent-primary"
            />
            <span>国債整理基金特会・交付税特会を含める（他が見えなくなるほど大きいため既定で除外）</span>
          </label>
        </div>
      </div>
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
        <div className="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
          {ministryOptions.map(name => (
            <label key={name} className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={filter.ministries.includes(name)} onChange={() => toggleMinistry(name)} className="h-3.5 w-3.5 cursor-pointer accent-primary" />
              <span>{name}</span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 font-medium">名前（部分一致。一致したノードとその上流・下流だけを残す）</div>
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
        <div className="font-medium">事業（RS事業が対象。条件に合わない事業は事業(支出)・支出先ごと落とす）</div>
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
        {hasSpending && (
          <div className="flex flex-wrap items-center gap-1.5">
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
          </div>
        )}
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
            <span className={filter.recipientQuery.trim() === '' ? 'text-mirai-text-muted' : undefined}>再委託先も含めて判定する（一致する事業を残し、支出先は隠さない）</span>
          </label>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-mirai-border pt-3">
        <div className="font-medium" title="AI政策評価のスコア（0〜100）。/quality と同じ値。範囲を指定した項目で評価が無い事業は落とす">
          政策評価スコア（0〜100。範囲を指定すると未評価の事業は落とす）
        </div>
        <ScoreRow label="総合点" title="AI政策評価の総合点（0〜100）" range={filter.scoreO} onChange={r => set({ scoreO: r })} />
        <ScoreRow label="費用対内容" title="費用対内容（0〜100）。金額が活動の規模に見合っているか" range={filter.scoreX} onChange={r => set({ scoreX: r })} />
        <ScoreRow label="必要性" title="必要性（0〜100）。廃止したら誰が具体的に困るか" range={filter.scoreN} onChange={r => set({ scoreN: r })} />
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

function ScoreRow({ label, title, range, onChange }: { label: string; title: string; range: UnifiedScoreRange; onChange: (r: UnifiedScoreRange) => void }) {
  const bound = (v: string) => {
    const t = v.trim();
    return t === '' || (Number.isFinite(Number(t)) && Number(t) >= 0 && Number(t) <= 100);
  };
  const cls = (ok: boolean) => cn(SMALL_NUMBER_CLASS, !ok && 'border-destructive focus-visible:border-destructive');
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-20 shrink-0 font-medium" title={title}>
        {label}
      </span>
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={range.min}
        onChange={e => onChange({ ...range, min: e.target.value })}
        placeholder="下限"
        aria-label={`${label}の下限`}
        aria-invalid={!bound(range.min) || undefined}
        className={cls(bound(range.min))}
      />
      <span className="text-[11px] text-mirai-text-muted">~</span>
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={range.max}
        onChange={e => onChange({ ...range, max: e.target.value })}
        placeholder="上限"
        aria-label={`${label}の上限`}
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
