'use client';

/**
 * 項一覧の絞り込みを左サイドパネルにまとめたもの。列の値のタイプごとに操作方法を変える:
 *   - 選択肢が有限な列（予算種別・会計区分・所管・組織/特会/機関・勘定/業務）→ チェックボックス付き複数選択コンボ
 *   - 文字列の列（項名）と、一覧には出ない事項・目の名前 → 正規表現トグル付きテキスト検索
 *   - 数値の列（事項数・目数・RS事業数・本年度額・前年度額・増減額・増減率）→ 範囲スライダー
 *   - 項（コード）は絞り込み対象にしない
 *
 * コンボ・検索欄・スライダーの見た目と挙動は `/sankey-svg` のフィルタパネルに揃えている。
 */

import { useState } from 'react';
import type { MOFBudgetType } from '@/types/mof-jikou';
import { ACCOUNT_LABEL } from '@/client/components/mof-kou/columns';
import { MultiSelectCombo } from '@/client/components/mof-kou/MultiSelectCombo';
import { RangeSlider } from '@/client/components/mof-kou/RangeSlider';
import { RegexTextFilter } from '@/client/components/mof-kou/RegexTextFilter';
import { formatYen } from '@/client/components/mof-jikou/format';

/** 複数選択コンボのうちどれか1つだけを開けるようにするフィールド名 */
type ComboField = 'budgetType' | 'account' | 'ministry' | 'organization' | 'subAccount';

export type NumRange = [number | null, number | null];

const ACCOUNT_OPTIONS = [ACCOUNT_LABEL.general, ACCOUNT_LABEL.special, ACCOUNT_LABEL.agency];

export interface FilterSidebarState {
  /** 表示ラベル（ACCOUNT_LABELの値）の集合。空 = すべて */
  account: string[];
  budgetType: string[];
  ministry: string[];
  organization: string[];
  subAccount: string[];
  sectionNameQuery: string;
  sectionNameRegex: boolean;
  detailQuery: string;
  detailRegex: boolean;
  jikouCountRange: NumRange;
  kouMokuCountRange: NumRange;
  rsProjectCountRange: NumRange;
  amountRange: NumRange;
  previousAmountRange: NumRange;
  differenceRange: NumRange;
  rateRange: NumRange;
}

export interface FilterDomains {
  jikouCount: [number, number];
  kouMokuCount: [number, number];
  rsProjectCount: [number, number];
  amount: [number, number];
  previousAmount: [number, number];
  difference: [number, number];
  rate: [number, number];
}

interface FilterSidebarProps {
  state: FilterSidebarState;
  onChange: <K extends keyof FilterSidebarState>(key: K, value: FilterSidebarState[K]) => void;
  budgetTypes: MOFBudgetType[];
  ministries: string[];
  organizations: string[];
  subAccounts: string[];
  domains: FilterDomains;
  activeCount: number;
  onReset: () => void;
  width: number;
}

function formatRate(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(0)}%`;
}

function formatCount(v: number): string {
  return `${Math.round(v).toLocaleString()}件`;
}

/** 上位の選択がまだ有効な選択肢だけに絞る（無効化されたものは黙って落とす） */
function pruneToOptions(selected: string[], options: string[]): string[] {
  if (selected.length === 0) return selected;
  const next = selected.filter(s => options.includes(s));
  return next.length === selected.length ? selected : next;
}

export function FilterSidebar({
  state,
  onChange,
  budgetTypes,
  ministries,
  organizations,
  subAccounts,
  domains,
  activeCount,
  onReset,
  width,
}: FilterSidebarProps) {
  const [openField, setOpenField] = useState<ComboField | null>(null);
  const comboProps = (field: ComboField) => ({
    open: openField === field,
    onOpenChange: (v: boolean) => setOpenField(v ? field : null),
  });

  return (
    <div
      className="flex h-full shrink-0 flex-col overflow-y-auto rounded-lg border border-neutral-200 bg-white p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950"
      style={{ width }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-neutral-700 dark:text-neutral-300">フィルタ</h2>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            すべて解除（{activeCount}）
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div className="block space-y-1">
          <span className="text-neutral-500">予算種別</span>
          <MultiSelectCombo
            label="予算種別"
            options={budgetTypes}
            selected={state.budgetType}
            onChange={v => onChange('budgetType', v)}
            {...comboProps('budgetType')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500">会計区分</span>
          <MultiSelectCombo
            label="会計区分"
            options={ACCOUNT_OPTIONS}
            selected={state.account}
            onChange={v => {
              onChange('account', v);
              onChange('ministry', pruneToOptions(state.ministry, ministries));
              onChange('organization', pruneToOptions(state.organization, organizations));
              onChange('subAccount', pruneToOptions(state.subAccount, subAccounts));
            }}
            {...comboProps('account')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500">所管</span>
          <MultiSelectCombo
            label="所管"
            options={ministries}
            selected={state.ministry}
            onChange={v => {
              onChange('ministry', v);
              onChange('organization', pruneToOptions(state.organization, organizations));
              onChange('subAccount', pruneToOptions(state.subAccount, subAccounts));
            }}
            {...comboProps('ministry')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500">組織／特会／機関</span>
          <MultiSelectCombo
            label="組織／特会／機関"
            options={organizations}
            selected={state.organization}
            onChange={v => {
              onChange('organization', v);
              onChange('subAccount', pruneToOptions(state.subAccount, subAccounts));
            }}
            {...comboProps('organization')}
          />
        </div>

        <div className="block space-y-1">
          <span className="text-neutral-500">勘定／業務</span>
          <MultiSelectCombo
            label="勘定／業務"
            options={subAccounts}
            selected={state.subAccount}
            onChange={v => onChange('subAccount', v)}
            disabled={subAccounts.length === 0}
            {...comboProps('subAccount')}
          />
        </div>

        <hr className="border-neutral-200 dark:border-neutral-800" />

        <RegexTextFilter
          label="項名"
          value={state.sectionNameQuery}
          onChange={v => onChange('sectionNameQuery', v)}
          useRegex={state.sectionNameRegex}
          onToggleRegex={v => onChange('sectionNameRegex', v)}
        />

        <RegexTextFilter
          label="事項・目名"
          note="一覧には出ない、この項に属する事項・目の名前も対象にします"
          value={state.detailQuery}
          onChange={v => onChange('detailQuery', v)}
          useRegex={state.detailRegex}
          onToggleRegex={v => onChange('detailRegex', v)}
        />

        <hr className="border-neutral-200 dark:border-neutral-800" />

        <RangeSlider
          label="事項数"
          domainMin={domains.jikouCount[0]}
          domainMax={domains.jikouCount[1]}
          value={state.jikouCountRange}
          onChange={v => onChange('jikouCountRange', v)}
          formatValue={formatCount}
        />
        <RangeSlider
          label="目数"
          domainMin={domains.kouMokuCount[0]}
          domainMax={domains.kouMokuCount[1]}
          value={state.kouMokuCountRange}
          onChange={v => onChange('kouMokuCountRange', v)}
          formatValue={formatCount}
        />
        <RangeSlider
          label="RS事業数"
          domainMin={domains.rsProjectCount[0]}
          domainMax={domains.rsProjectCount[1]}
          value={state.rsProjectCountRange}
          onChange={v => onChange('rsProjectCountRange', v)}
          formatValue={formatCount}
        />
        <RangeSlider
          label="本年度額"
          domainMin={domains.amount[0]}
          domainMax={domains.amount[1]}
          value={state.amountRange}
          onChange={v => onChange('amountRange', v)}
          formatValue={formatYen}
          scale="log"
        />
        <RangeSlider
          label="前年度額"
          note="決算・暫定予算等、比較対象が無い行は範囲を絞ると除外されます"
          domainMin={domains.previousAmount[0]}
          domainMax={domains.previousAmount[1]}
          value={state.previousAmountRange}
          onChange={v => onChange('previousAmountRange', v)}
          formatValue={formatYen}
          scale="log"
        />
        <RangeSlider
          label="増減額"
          note="比較対象が無い行は範囲を絞ると除外されます"
          domainMin={domains.difference[0]}
          domainMax={domains.difference[1]}
          value={state.differenceRange}
          onChange={v => onChange('differenceRange', v)}
          formatValue={formatYen}
        />
        <RangeSlider
          label="増減率"
          note="比較対象が無い・新規計上の行は範囲を絞ると除外されます"
          domainMin={domains.rate[0]}
          domainMax={domains.rate[1]}
          value={state.rateRange}
          onChange={v => onChange('rateRange', v)}
          formatValue={formatRate}
        />
      </div>
    </div>
  );
}
