'use client';

/**
 * 絞り込みの入力欄（会計・所管・項名・事項名・金額）。
 *
 * /sankey-svg のフィルタパネルと同じ発想の条件セットを、mof-hierarchy の列に
 * 合わせて置き換えている（事業名→事項名、支出先名→項名、省庁→所管はそのまま）。
 *
 * カード・開閉トグルは持たない。/sankey-svg は検索カードの内側にこの内容を
 * 展開するので、置き場所は呼び出し側（HierarchySearch）が決める。
 * 全解除は検索セクションの外にある専用ボタン（HierarchyFilterClearButton）が
 * 担うので、ここには置かない。
 *
 * 実際の絞り込みはサーバ側（filterMOFJikouItems）で行う。ここは入力の
 * 状態を持ち回すだけ。
 */

import type { MOFAccountType } from '@/types/mof-jikou';
import type { MOFHierarchyFilterState } from '@/types/mof-hierarchy';

const ACCOUNT_OPTIONS: Array<{ value: MOFAccountType; label: string }> = [
  { value: 'general', label: '一般会計' },
  { value: 'special', label: '特別会計' },
  { value: 'agency', label: '政府関係機関' },
];

const INPUT_CLASS =
  'h-7 w-full rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function HierarchyFilterFields({
  filter,
  onFilterChange,
  ministryOptions,
}: {
  filter: MOFHierarchyFilterState;
  onFilterChange: (next: MOFHierarchyFilterState) => void;
  /** 所管の選択肢。TopN前の全件（browse）から作るので、絞り込み中でも全省庁を出せる */
  ministryOptions: string[];
}) {
  const set = (patch: Partial<MOFHierarchyFilterState>) => onFilterChange({ ...filter, ...patch });
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
      {/* 会計区分 */}
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

      {/* 所管（複数選択） */}
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
            <label
              key={name}
              className="flex cursor-pointer items-center gap-1.5 px-2 py-1 hover:bg-gray-50"
            >
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

      {/* 項名・事項名 */}
      {(
        [
          { key: 'section', label: '項', query: filter.sectionQuery, regex: filter.sectionRegex },
          { key: 'item', label: '事項', query: filter.itemQuery, regex: filter.itemRegex },
        ] as const
      ).map(({ key, label, query, regex }) => (
        <div key={key}>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">{label}名</span>
            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-gray-400">
              <input
                type="checkbox"
                checked={regex}
                onChange={() =>
                  set(
                    key === 'section'
                      ? { sectionRegex: !filter.sectionRegex }
                      : { itemRegex: !filter.itemRegex }
                  )
                }
                className="h-3 w-3 cursor-pointer"
              />
              正規表現
            </label>
          </div>
          <input
            type="text"
            value={query}
            onChange={e =>
              set(key === 'section' ? { sectionQuery: e.target.value } : { itemQuery: e.target.value })
            }
            placeholder={regex ? '正規表現' : '部分一致'}
            className={INPUT_CLASS}
          />
        </div>
      ))}

      {/* 金額の範囲 */}
      <div>
        <div className="mb-1 font-medium">事項の金額</div>
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
