'use client';

/**
 * 統合ビューの絞り込み入力欄（会計・所管・非事業の表示・巨大特会の表示・名前）。
 * `/mof-sankey` の FilterFields と同じ作り。
 */

import { UNIFIED_FILTER_DEFAULT, type UnifiedViewFilter } from '@/types/unified-budget-view';
import { Button } from '@/components/ui/button';

const ACCOUNT_OPTIONS: Array<{ value: 'general' | 'special'; label: string }> = [
  { value: 'general', label: '一般会計' },
  { value: 'special', label: '特別会計' },
];

const INPUT_CLASS =
  'h-7 w-full rounded-md border border-mirai-border bg-card px-2 text-xs text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary';

export function UnifiedFilterFields({
  filter,
  onFilterChange,
  ministryOptions,
}: {
  filter: UnifiedViewFilter;
  onFilterChange: (next: UnifiedViewFilter) => void;
  ministryOptions: string[];
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
      <Button variant="link" onClick={() => onFilterChange(UNIFIED_FILTER_DEFAULT)} className="self-start text-[11px] font-medium">
        絞り込みを既定に戻す
      </Button>
    </div>
  );
}
