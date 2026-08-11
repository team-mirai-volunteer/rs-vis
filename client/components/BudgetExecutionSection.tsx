import type { CSSProperties } from 'react';
import type { BudgetSummary, BudgetBreakdownItem } from '@/types/sankey-svg';
import { formatYen } from '@/app/lib/sankey-svg-constants';
import { getAccountBadgeStyle, classifyAccountCategory } from '@/app/lib/account-badge';

/**
 * 予算・執行アコーディオンの共有コンポーネント。メインSankey（/sankey-svg）と
 * 再委託ビュー（/subcontracts）で同一の見た目（会計区分集計・歳出項目カード・メタグリッド）を保つ。
 *
 * ドラッグでの高さ変更はページ側の状態を props で受ける（onResizeStart を渡すと有効）。
 * 渡さない場合は listHeight 固定でスクロールする。
 */
export function BudgetExecutionSection({
  budgetSummary,
  budgetBreakdown,
  scaleFont,
  expanded,
  onToggleExpanded,
  listHeight,
  onResizeStart,
  onResizeReset,
}: {
  budgetSummary: BudgetSummary | null | undefined;
  budgetBreakdown: BudgetBreakdownItem[];
  scaleFont: (px: number) => number;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** 展開時の内訳リスト最大高さ(px) */
  listHeight: number;
  /** ドラッグ開始（メインのみ。未指定なら高さ変更ハンドルは出さない） */
  onResizeStart?: (e: React.MouseEvent) => void;
  onResizeReset?: () => void;
}) {
  const summary = budgetSummary ?? null;
  const breakdown = budgetBreakdown;
  if (!summary && breakdown.length === 0) return null;

  const META_PX = scaleFont(11);
  const PANEL_META_PX = scaleFont(13);
  const PANEL_PRIMARY_VALUE_PX = scaleFont(15);
  const PANEL_LIST_VALUE_PX = scaleFont(12);

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
    return (
      <span style={{ background: badge.background, color: '#fff', padding: '1px 6px', borderRadius: 8, fontSize: Math.max(9, META_PX - 1), fontWeight: 700, lineHeight: 1.4, whiteSpace: 'nowrap' }}>
        {badge.label}
      </span>
    );
  };
  const accountBadges = (['一般', '特別'] as const)
    .map(label => ({ label, amount: accountTotals.get(label) ?? 0 }))
    .filter(item => item.amount > 0);
  const totalBreakdownAmount = breakdown.reduce((s, item) => s + item.amount, 0);
  const cardStyle: CSSProperties = { border: '1px solid #e8edf3', borderRadius: 6, background: '#fff', padding: '8px 9px' };
  const cardHeaderStyle: CSSProperties = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 };
  const cardTitleStyle: CSSProperties = { minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', color: '#333', fontSize: PANEL_META_PX, fontWeight: 600 };
  const miniLabelStyle: CSSProperties = { fontSize: META_PX, color: '#999', marginRight: 3 };
  const metaGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '5px 10px', fontSize: META_PX, lineHeight: 1.45 };
  const renderMeta = (label: string, value: string) => (
    <div style={{ minWidth: 0 }}>
      <span style={miniLabelStyle}>{label}</span>
      <span style={{ color: '#555', wordBreak: 'break-all' }}>{renderText(value)}</span>
    </div>
  );

  return (
    <div style={{ borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 14px 1px', gap: 4 }}>
        <button type="button" onClick={onToggleExpanded}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        >
          <span style={{ fontSize: META_PX, color: '#888' }}>{expanded ? '▼' : '▶'}</span>
          <span style={{ fontSize: PANEL_META_PX, fontWeight: 600, color: '#555' }}>予算・執行</span>
          {breakdown.length > 0 && (
            <span style={{ fontSize: META_PX, color: '#999', fontWeight: 500 }}>{breakdown.length.toLocaleString()}件</span>
          )}
        </button>
      </div>
      {accountBadges.length > 0 && (
        <div style={{ padding: '0 14px 2px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 12, rowGap: 4, minWidth: 0 }}>
          {accountBadges.map(item => (
            <div key={item.label} style={{ flex: `1 1 ${scaleFont(112)}px`, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1, minWidth: 0 }}>
                {renderAccountBadge(item.label)}
                <span style={{ display: 'block', fontSize: PANEL_PRIMARY_VALUE_PX, fontWeight: 600, color: '#222', whiteSpace: 'nowrap' }}>{formatYen(item.amount)}</span>
              </span>
              <span style={{ display: 'block', fontSize: META_PX, color: '#999', marginTop: 1, whiteSpace: 'nowrap' }}>{Math.round(item.amount).toLocaleString()}円</span>
            </div>
          ))}
        </div>
      )}
      {expanded && (
        <div style={{ padding: '0 14px 10px', fontSize: PANEL_META_PX, color: '#444' }}>
          {breakdown.length > 0 && summary && totalBreakdownAmount !== summary.totalBudget && (
            <div style={{ color: '#b26a00', background: '#fff8e1', border: '1px solid #ffe0a3', borderRadius: 6, padding: 6, marginBottom: 8, lineHeight: 1.45 }}>
              2-1合計と2-2内訳合計に差があります: {formatYen((summary?.totalBudget ?? 0) - totalBreakdownAmount)}
            </div>
          )}
          {breakdown.length === 0 ? (
            <p style={{ color: '#aaa', margin: 0 }}>歳出項目内訳がありません</p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 7, ...(breakdown.length > 1 ? { maxHeight: listHeight, overflowY: 'auto' as const } : { overflowY: 'visible' as const }), paddingRight: 2 }}>
                {breakdown.map((item, index) => (
                  <div key={`${item.accountCategory}-${item.account}-${item.subAccount}-${item.budgetType}-${item.item}-${item.subItem}-${index}`} style={cardStyle}>
                    <div style={cardHeaderStyle}>
                      <div style={cardTitleStyle}>
                        {renderAccountBadge(item.accountCategory)}
                        <span style={{ color: '#999', fontWeight: 500 }}>{renderText(item.budgetType)}</span>
                      </div>
                      <div style={{ color: '#222', fontWeight: 700, whiteSpace: 'nowrap', fontSize: PANEL_LIST_VALUE_PX }}>{formatYen(item.amount)}</div>
                    </div>
                    <div style={metaGridStyle}>
                      {renderMeta('会計', item.account)}
                      {renderMeta('勘定', item.subAccount)}
                      {renderMeta('項', item.item)}
                      {renderMeta('目', item.subItem)}
                    </div>
                    {item.note.trim() && (
                      <div style={{ marginTop: 5, fontSize: META_PX, lineHeight: 1.45 }}>
                        <span style={miniLabelStyle}>補足</span>
                        <span style={{ color: '#555', wordBreak: 'break-all' }}>{item.note}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {breakdown.length > 1 && onResizeStart && (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="予算・執行カードリストの高さを変更"
                  title="ドラッグで高さを変更"
                  onMouseDown={onResizeStart}
                  onDoubleClick={onResizeReset}
                  style={{ height: 10, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}
                  data-pan-disabled
                >
                  <div style={{ width: 32, height: 3, borderRadius: 2, background: '#d0d0d0' }} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
