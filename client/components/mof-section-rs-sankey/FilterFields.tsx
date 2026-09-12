'use client';

/**
 * 絞り込みの入力欄（会計・所管・項名・金額）。
 * `/mof-hierarchy` の HierarchyFilterFields と同じ作り。事項名の欄は無い
 * （このページに事項列が無いため）。
 */

import type { MOFAccountType } from '@/types/mof-jikou';
import type { MOFSectionRsFilterState } from '@/types/mof-section-rs-sankey';

const ACCOUNT_OPTIONS: Array<{ value: MOFAccountType; label: string }> = [
  { value: 'general', label: '一般会計' },
  { value: 'special', label: '特別会計' },
  { value: 'agency', label: '政府関係機関' },
];

const INPUT_CLASS =
  'h-7 w-full rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function FilterFields({
  filter,
  onFilterChange,
  ministryOptions,
}: {
  filter: MOFSectionRsFilterState;
  onFilterChange: (next: MOFSectionRsFilterState) => void;
  ministryOptions: string[];
}) {
  const set = (patch: Partial<MOFSectionRsFilterState>) => onFilterChange({ ...filter, ...patch });
  const toggleAccount = (value: MOFAccountType) =>
    set({
      accountTypes: filter.accountTypes.includes(value)
        ? filter.accountTypes.filter(a => a !== value)
        : [...filter.accountTypes, value],
    });
  const toggleMinistry = (name: string) =>
    set({
      ministries: filter.ministries.includes(name)
        ? filter.ministries.filter(m => m !== name)
        : [...filter.ministries, name],
    });

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-gray-600">
      <div>
        <div className="mb-1 font-medium">会計</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {ACCOUNT_OPTIONS.map(({ value, label }) => (
            <label key={value} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={filter.accountTypes.includes(value)}
                onChange={() => toggleAccount(value)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-medium">所管</span>
          {filter.ministries.length > 0 && (
            <button
              type="button"
              onClick={() => set({ ministries: [] })}
              className="text-[11px] text-gray-400 hover:text-gray-600"
            >
              クリア
            </button>
          )}
        </div>
        <div className="max-h-32 overflow-y-auto rounded border border-gray-200">
          {ministryOptions.map(name => (
            <label key={name} className="flex cursor-pointer items-center gap-1.5 px-2 py-1 hover:bg-gray-50">
              <input
                type="checkbox"
                checked={filter.ministries.includes(name)}
                onChange={() => toggleMinistry(name)}
                className="h-3.5 w-3.5 cursor-pointer"
              />
              <span className="truncate">{name}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-medium">項名</span>
          <label className="flex cursor-pointer items-center gap-1 text-[11px] text-gray-400">
            <input
              type="checkbox"
              checked={filter.sectionRegex}
              onChange={() => set({ sectionRegex: !filter.sectionRegex })}
              className="h-3 w-3 cursor-pointer"
            />
            正規表現
          </label>
        </div>
        <input
          type="text"
          value={filter.sectionQuery}
          onChange={e => set({ sectionQuery: e.target.value })}
          placeholder={filter.sectionRegex ? '正規表現' : '部分一致'}
          className={INPUT_CLASS}
        />
      </div>

      <div>
        <div className="mb-1 font-medium">項の金額</div>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={filter.minAmountText}
            onChange={e => set({ minAmountText: e.target.value })}
            placeholder="例: 100億"
            className={INPUT_CLASS}
          />
          <span className="shrink-0 text-gray-400">〜</span>
          <input
            type="text"
            value={filter.maxAmountText}
            onChange={e => set({ maxAmountText: e.target.value })}
            placeholder="例: 1兆"
            className={INPUT_CLASS}
          />
        </div>
      </div>
    </div>
  );
}
