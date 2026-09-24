import type { CSSProperties } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BudgetSummary, BudgetBreakdownItem } from '@/types/sankey-svg';
import { formatYen } from '@/app/lib/sankey-svg-constants';
import { getAccountBadgeStyle, classifyAccountCategory } from '@/app/lib/account-badge';

/**
 * 予算・執行アコーディオンの共有コンポーネント。メインSankey（/sankey-svg）と
 * 再委託ビュー（/subcontracts）で同一の見た目（会計区分集計・歳出項目カード・メタグリッド）を保つ。
 *
 * ドラッグでの高さ変更はページ側の状態を props で受ける（onResizeStart を渡すと有効）。
 * 渡さない場合は listHeight 固定でスクロールする。
 *
 * 色・角丸はチームみらいデザインシステムのトークン（Tailwind クラス）。会計区分バッジの色
 * （一般=赤 / 特別=青）は可視化のエンコーディングなので account-badge.ts の値をそのまま使う。
 * フォントサイズはページ側のフォントスケール（scaleFont）に従うため inline style で渡す。
 */
export function BudgetExecutionSection({
  budgetSummary,
  budgetBreakdown,
  scaleFont,
  expanded = true,
  onToggleExpanded,
  listHeight = 260,
  presentation = 'accordion',
  onResizeStart,
  onResizeReset,
}: {
  budgetSummary: BudgetSummary | null | undefined;
  budgetBreakdown: BudgetBreakdownItem[];
  scaleFont: (px: number) => number;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** タブ内では見出しと内部スクロールを省き、パネル側に任せる */
  presentation?: 'accordion' | 'tab';
  /** 展開時の内訳リスト最大高さ(px) */
  listHeight?: number;
  /** ドラッグ開始（メインのみ。未指定なら高さ変更ハンドルは出さない） */
  onResizeStart?: (e: React.MouseEvent) => void;
  onResizeReset?: () => void;
}) {
  const summary = budgetSummary ?? null;
  const breakdown = budgetBreakdown;
  const isTab = presentation === 'tab';
  if (!summary && breakdown.length === 0) return null;

  const META_PX = isTab ? 11 : scaleFont(11);
  const PANEL_META_PX = isTab ? 12 : scaleFont(13);
  const PANEL_PRIMARY_VALUE_PX = isTab ? 12 : scaleFont(15);
  const PANEL_LIST_VALUE_PX = isTab ? 11 : scaleFont(12);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  const renderText = (value: string) => value.trim() || '-';
  const summaryAccountItems = (summary?.accountSummaries ?? []).filter(item => item.totalBudget > 0);
  const accountTotals = summaryAccountItems.length > 0
    ? summaryAccountItems.reduce((m, item) => {
      const label = item.accountCategory === '一般会計' ? '一般' : item.accountCategory === '特別会計' ? '特別' : '';
      if (label) m.set(label, (m.get(label) ?? 0) + item.totalBudget);
      return m;
    }, new Map<string, number>())
    : breakdown.reduce((m, item) => {
      const label = item.accountCategory === '一般会計' ? '一般' : item.accountCategory === '特別会計' ? '特別' : '';
      if (label) m.set(label, (m.get(label) ?? 0) + item.amount);
      return m;
    }, new Map<string, number>());
  const renderAccountBadge = (value: string) => {
    const badge = getAccountBadgeStyle(classifyAccountCategory(value));
    if (!badge) return null;
    // 会計区分の色は意味色（可視化エンコーディング）なので account-badge.ts の値を使う
    return (
      <span
        className="whitespace-nowrap rounded-lg px-1.5 py-px font-bold leading-[1.4] text-white"
        style={{ background: badge.background, fontSize: Math.max(9, META_PX - 1) }}
      >
        {badge.label}
      </span>
    );
  };
  const accountBadges = (['一般', '特別'] as const)
    .map(label => ({ label, amount: accountTotals.get(label) ?? 0 }))
    .filter(item => item.amount > 0);
  const totalBreakdownAmount = breakdown.reduce((s, item) => s + item.amount, 0);
  const metaGridStyle: CSSProperties = { fontSize: META_PX };
  const renderMeta = (label: string, value: string) => (
    <div className="min-w-0">
      <span className="mr-[3px] text-mirai-text-muted" style={{ fontSize: META_PX }}>{label}</span>
      <span className="break-all text-mirai-text-subtle">{renderText(value)}</span>
    </div>
  );

  return (
    <div className={isTab ? '' : 'shrink-0 border-b border-border'}>
      {!isTab && <div className="flex items-center gap-1 px-3.5 pb-px pt-0.5">
        <Button
          variant="ghost"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          className="h-auto flex-1 justify-start gap-[5px] rounded-md p-0 text-left font-bold text-mirai-text-subtle hover:bg-transparent hover:text-mirai-text"
        >
          <Chevron aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: META_PX, height: META_PX }} />
          <span style={{ fontSize: PANEL_META_PX }}>予算・執行</span>
          {breakdown.length > 0 && (
            <span className="font-medium text-mirai-text-muted" style={{ fontSize: META_PX }}>{breakdown.length.toLocaleString()}件</span>
          )}
        </Button>
      </div>}
      {accountBadges.length > 0 && (
        <div className={`flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 ${isTab ? 'border-b border-border px-1 py-1.5' : 'px-3.5 pb-0.5'}`}>
          {accountBadges.map(item => (
            <div key={item.label} className="min-w-0" style={{ flex: `1 1 ${scaleFont(112)}px` }}>
              <span className="mb-px flex min-w-0 items-center gap-[5px]">
                {renderAccountBadge(item.label)}
                <span className={`block whitespace-nowrap tabular-nums ${isTab ? 'font-medium text-mirai-text-secondary' : 'font-bold text-mirai-text'}`} style={{ fontSize: PANEL_PRIMARY_VALUE_PX }}>{formatYen(item.amount)}</span>
              </span>
              <span className="mt-px block whitespace-nowrap text-mirai-text-muted" style={{ fontSize: META_PX }}>{Math.round(item.amount).toLocaleString()}円</span>
            </div>
          ))}
        </div>
      )}
      {(isTab || expanded) && (
        <div className={`${isTab ? '' : 'px-3.5 '}pb-2.5 text-mirai-text-secondary`} style={{ fontSize: PANEL_META_PX }}>
          {breakdown.length > 0 && summary && totalBreakdownAmount !== summary.totalBudget && (
            <div className="mb-2 rounded-md border border-mirai-border bg-mirai-badge-yellow p-1.5 leading-[1.45] text-mirai-text-secondary">
              2-1合計と2-2内訳合計に差があります: {formatYen((summary?.totalBudget ?? 0) - totalBreakdownAmount)}
            </div>
          )}
          {breakdown.length === 0 ? (
            <p className="m-0 text-mirai-text-placeholder">歳出項目内訳がありません</p>
          ) : (
            <>
              <div
                className={isTab ? 'grid' : 'grid gap-[7px] pr-0.5'}
                style={!isTab && breakdown.length > 1 ? { maxHeight: listHeight, overflowY: 'auto' } : { overflowY: 'visible' }}
              >
                {breakdown.map((item, index) => (
                  <div
                    key={`${item.accountCategory}-${item.account}-${item.subAccount}-${item.budgetType}-${item.item}-${item.subItem}-${index}`}
                    className={isTab ? 'border-b border-border px-1 py-1.5' : 'rounded-xl border border-border bg-card px-[9px] py-2'}
                  >
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-1.5 font-bold text-mirai-text-secondary" style={{ fontSize: PANEL_META_PX }}>
                        {renderAccountBadge(item.accountCategory)}
                        <span className="font-medium text-mirai-text-muted">{renderText(item.budgetType)}</span>
                      </div>
                      <div className={`whitespace-nowrap tabular-nums ${isTab ? 'text-mirai-text-muted' : 'font-bold text-mirai-text'}`} style={{ fontSize: PANEL_LIST_VALUE_PX }}>{formatYen(item.amount)}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-2.5 gap-y-[5px] leading-[1.45]" style={metaGridStyle}>
                      {renderMeta('会計', item.account)}
                      {renderMeta('勘定', item.subAccount)}
                      {renderMeta('項', item.item)}
                      {renderMeta('目', item.subItem)}
                    </div>
                    {item.note.trim() && (
                      <div className="mt-[5px] leading-[1.45]" style={{ fontSize: META_PX }}>
                        <span className="mr-[3px] text-mirai-text-muted">補足</span>
                        <span className="break-all text-mirai-text-subtle">{item.note}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {!isTab && breakdown.length > 1 && onResizeStart && (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="予算・執行カードリストの高さを変更"
                  title="ドラッグで高さを変更"
                  onMouseDown={onResizeStart}
                  onDoubleClick={onResizeReset}
                  className="flex h-2.5 cursor-ns-resize select-none items-center justify-center"
                  data-pan-disabled
                >
                  <div className="h-[3px] w-8 rounded-full bg-mirai-border" />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
