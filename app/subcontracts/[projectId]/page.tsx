'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type {
  SubcontractGraph,
  BlockNode,
  BlockRecipient,
  BlockEdge,
  BlockOriginKind,
  FlowOrigin,
} from '@/types/subcontract';
import type { ProjectDetail } from '@/types/project-details';
import { ProjectReferenceLinks } from '@/components/subcontracts/ProjectReferenceLinks';
import {
  computeSubcontractLayout,
  backEdgePath,
  selfLoopPath,
  formatYen,
  COLOR_DIRECT,
  COLOR_SUBCONTRACT,
  COLOR_ROOT,
  NODE_PAD,
  type LayoutBlock,
} from '@/app/lib/subcontract-layout';

const COLOR_BACK_EDGE = 'rgba(217,69,69,0.65)';
const COLOR_CANVAS = '#fff';
const COLOR_DIRECT_BODY = '#f8d3d3';
const COLOR_SUBCONTRACT_BODY = '#f6cbb6';
const COLOR_DIRECT_BODY_TEXT = '#8f1f1f';
const COLOR_SUBCONTRACT_BODY_TEXT = '#8b3a1c';
const COLOR_DIRECT_BODY_SUBTLE = '#b33434';
const COLOR_SUBCONTRACT_BODY_SUBTLE = '#b45309';
const COLOR_DIRECT_EDGE = 'rgba(217,69,69,0.48)';
const COLOR_SUBCONTRACT_EDGE = 'rgba(224,112,64,0.52)';
// 別財源ブロック（5-2の構造的に府省庁ルートでは説明できない財投借入・自己収入・利水者等）
const COLOR_SEPARATE_ORIGIN_STRONG = '#6366f1';
const COLOR_SEPARATE_ORIGIN_BODY = '#eef2ff';
const COLOR_SEPARATE_ORIGIN_BODY_TEXT = '#3730a3';
const COLOR_SEPARATE_ORIGIN_BODY_SUBTLE = '#4338ca';
const COLOR_SEPARATE_ORIGIN_EDGE = 'rgba(99,102,241,0.55)';
const COLOR_REFERENCE_EDGE = 'rgba(148,163,184,0.55)';

interface OriginPalette {
  header: string;
  body: string;
  bodyText: string;
  bodySubtle: string;
  selectedStroke: string;
  badgeText: string;
}

function originPalette(originKind: BlockOriginKind): OriginPalette {
  // 別財源ブロックは broad/strong の内部区別を表示せず一律「別財源」として扱う
  if (originKind === 'separate-origin-strong' || originKind === 'separate-origin-broad') {
    return {
      header: COLOR_SEPARATE_ORIGIN_STRONG,
      body: COLOR_SEPARATE_ORIGIN_BODY,
      bodyText: COLOR_SEPARATE_ORIGIN_BODY_TEXT,
      bodySubtle: COLOR_SEPARATE_ORIGIN_BODY_SUBTLE,
      selectedStroke: '#312e81',
      badgeText: '別財源',
    };
  }
  if (originKind === 'direct') {
    return {
      header: COLOR_DIRECT,
      body: COLOR_DIRECT_BODY,
      bodyText: COLOR_DIRECT_BODY_TEXT,
      bodySubtle: COLOR_DIRECT_BODY_SUBTLE,
      selectedStroke: '#991b1b',
      badgeText: '直接支出',
    };
  }
  return {
    header: COLOR_SUBCONTRACT,
    body: COLOR_SUBCONTRACT_BODY,
    bodyText: COLOR_SUBCONTRACT_BODY_TEXT,
    bodySubtle: COLOR_SUBCONTRACT_BODY_SUBTLE,
    selectedStroke: '#9a3412',
    badgeText: '再委託',
  };
}

function flowEdgeStyle(origin: FlowOrigin): { stroke: string; dasharray?: string; width: number } {
  switch (origin) {
    case 'direct':
      return { stroke: COLOR_DIRECT_EDGE, width: 2.5 };
    case 'transfer':
      return { stroke: COLOR_DIRECT_EDGE, width: 2.5, dasharray: '6 3' };
    case 'separate-origin':
      return { stroke: COLOR_SEPARATE_ORIGIN_EDGE, width: 2.5, dasharray: '5 4' };
    case 'reference':
      return { stroke: COLOR_REFERENCE_EDGE, width: 1.5, dasharray: '3 3' };
    case 'subcontract':
    default:
      return { stroke: COLOR_SUBCONTRACT_EDGE, width: 2.5 };
  }
}

function flowOriginLabel(origin: FlowOrigin): string {
  switch (origin) {
    case 'direct': return '直接';
    case 'transfer': return '移替';
    case 'separate-origin': return '別財源';
    case 'reference': return '参考';
    case 'subcontract': return '再委託';
  }
}

function flowOriginSortRank(origin: FlowOrigin): number {
  switch (origin) {
    case 'direct': return 0;
    case 'transfer': return 1;
    case 'separate-origin': return 2;
    case 'subcontract': return 3;
    case 'reference': return 4;
  }
}

function flowOriginBadgeColor(origin: FlowOrigin): { bg: string; fg: string } {
  switch (origin) {
    case 'direct': return { bg: '#f9dddd', fg: COLOR_DIRECT_BODY_SUBTLE };
    case 'transfer': return { bg: '#fef3c7', fg: '#92400e' };
    case 'separate-origin': return { bg: '#e0e7ff', fg: COLOR_SEPARATE_ORIGIN_BODY_TEXT };
    case 'subcontract': return { bg: '#fbe3d7', fg: COLOR_SUBCONTRACT_BODY_SUBTLE };
    case 'reference': return { bg: '#f1f5f9', fg: '#475569' };
  }
}

function originKindBadgeColor(kind: BlockOriginKind): { bg: string; fg: string } {
  switch (kind) {
    case 'direct': return { bg: '#f9dddd', fg: COLOR_DIRECT_BODY_SUBTLE };
    case 'subcontract': return { bg: '#fbe3d7', fg: COLOR_SUBCONTRACT_BODY_SUBTLE };
    case 'separate-origin-strong':
    case 'separate-origin-broad':
      return { bg: '#e0e7ff', fg: COLOR_SEPARATE_ORIGIN_BODY_TEXT };
  }
}

function originKindLabel(kind: BlockOriginKind): string {
  switch (kind) {
    case 'direct': return '直接';
    case 'subcontract': return '再委託';
    case 'separate-origin-strong':
    case 'separate-origin-broad':
      return '別財源';
  }
}
const COLOR_CONTEXT_BODY = '#d8f1df';
const COLOR_CONTEXT_BODY_TEXT = '#1f6b3a';
const COLOR_CONTEXT_BODY_SUBTLE = '#2d7d46';
const COLOR_PANEL_BORDER = '#e5e7eb';
const PANEL_LIST_NAME_FONT_PX = 12;
const PANEL_LIST_VALUE_FONT_PX = 12;
const PANEL_META_FONT_PX = 11;
const CARD_HEADER_H = 46;
const CARD_RADIUS = 6;
const CARD_BORDER_W = 1;

interface ProjectQualityOrg {
  pid: string;
  bureau?: string;
  division?: string;
  section?: string;
  office?: string;
  team?: string;
  unit?: string;
}

const ORG_LEVEL_LABELS = ['局庁', '部', '課', '室', '班', '係'];

function percentOf(amount: number, total: number): string {
  if (total <= 0) return '—';
  return `${((amount / total) * 100).toFixed(1)}%`;
}

function truncateChars(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  return `${chars.slice(0, Math.max(1, maxChars - 1)).join('')}…`;
}

function labelLines(value: string, maxChars: number, charsPerLine: number): string[] {
  const trimmed = truncateChars(value, maxChars);
  const chars = Array.from(trimmed);
  const lines: string[] = [];
  for (let i = 0; i < chars.length && lines.length < 2; i += charsPerLine) {
    lines.push(chars.slice(i, i + charsPerLine).join(''));
  }
  return lines;
}

function verticalBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const cy = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
}

function roundedTopPath(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${y + h}`,
    `H ${x}`,
    'Z',
  ].join(' ');
}

function roundedBottomPath(x: number, y: number, w: number, h: number, r: number): string {
  return [
    `M ${x} ${y}`,
    `H ${x + w}`,
    `V ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    'Z',
  ].join(' ');
}

function sortRecipients(
  recipients: BlockRecipient[],
  sortKey: 'amount-desc' | 'amount-asc' | 'name-asc',
): BlockRecipient[] {
  return [...recipients].sort((a, b) => {
    if (sortKey === 'amount-asc') return a.amount - b.amount;
    if (sortKey === 'name-asc') return (a.name || '').localeCompare(b.name || '', 'ja');
    return b.amount - a.amount;
  });
}

type HoveredNode =
  | { kind: 'root' }
  | { kind: 'block'; block: LayoutBlock };

// ─── サイドパネル（タブ式） ──────────────────────────────────────────────

type PaneTab = 'flow' | 'blocks' | 'recipients' | 'indirect-cost';

function SidePane({
  block,
  graph,
  projectDetail,
  orgChain,
  year,
  activeTab,
  onChangeTab,
  onSelectBlock,
  onDeselectBlock,
}: {
  block: BlockNode | null;
  graph: SubcontractGraph;
  projectDetail: ProjectDetail | null;
  orgChain: string[];
  year: number;
  activeTab: PaneTab;
  onChangeTab: (tab: PaneTab) => void;
  onSelectBlock: (block: BlockNode) => void;
  onDeselectBlock: () => void;
}) {
  const [expandedRecipients, setExpandedRecipients] = useState<Set<number>>(new Set());
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recipientSort, setRecipientSort] = useState<'amount-desc' | 'amount-asc' | 'name-asc'>('amount-desc');
  const [blockQuery, setBlockQuery] = useState('');
  const [blockFilter, setBlockFilter] = useState<'all' | 'direct' | 'subcontract' | 'separate-origin'>('all');
  const [blockSort, setBlockSort] = useState<'amount-desc' | 'name-asc'>('amount-desc');
  const [flowFilter, setFlowFilter] = useState<'all' | FlowOrigin>('all');

  useEffect(() => {
    setExpandedRecipients(new Set());
    setRecipientQuery('');
  }, [block?.blockId]);

  function toggleRecipient(i: number) {
    setExpandedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const blockById = useMemo(() => new Map(graph.blocks.map((b) => [b.blockId, b])), [graph.blocks]);
  const downstreamBlocks = useMemo(() => {
    if (!block) return [];
    const ids = graph.flows.filter((f) => f.sourceBlock === block.blockId).map((f) => f.targetBlock);
    return ids.map((id) => blockById.get(id)).filter(Boolean) as BlockNode[];
  }, [block, blockById, graph.flows]);
  const upstreamBlocks = useMemo(() => {
    if (!block) return [];
    const ids = graph.flows.filter((f) => f.targetBlock === block.blockId && f.sourceBlock !== null).map((f) => f.sourceBlock as string);
    return ids.map((id) => blockById.get(id)).filter(Boolean) as BlockNode[];
  }, [block, blockById, graph.flows]);

  // ── 集計（フロー / ブロック） ──
  const filteredBlocks = graph.blocks
    .filter((b) => {
      if (blockFilter === 'all') return true;
      if (blockFilter === 'direct') return b.originKind === 'direct';
      if (blockFilter === 'subcontract') return b.originKind === 'subcontract';
      return b.originKind === 'separate-origin-broad' || b.originKind === 'separate-origin-strong';
    })
    .filter((b) => {
      const q = blockQuery.trim().toLowerCase();
      if (!q) return true;
      return `${b.blockId} ${b.blockName} ${b.role ?? ''}`.toLowerCase().includes(q);
    })
    .sort((a, b) => blockSort === 'name-asc'
      ? `${a.blockId} ${a.blockName}`.localeCompare(`${b.blockId} ${b.blockName}`, 'ja')
      : b.totalAmount - a.totalAmount);

  const filteredFlows = graph.flows
    .filter((f) => flowFilter === 'all' || f.origin === flowFilter)
    .sort((a, b) => {
      const ar = flowOriginSortRank(a.origin);
      const br = flowOriginSortRank(b.origin);
      if (ar !== br) return ar - br;
      return (a.sourceBlock ?? '').localeCompare(b.sourceBlock ?? '', 'ja');
    });

  const rq = recipientQuery.trim().toLowerCase();
  const sortedRecipients = block
    ? sortRecipients(block.recipients, recipientSort)
        .filter((r) => !rq || `${r.name} ${r.corporateNumber} ${r.contractSummaries.join(' ')}`.toLowerCase().includes(rq))
    : [];

  const indirectCount = graph.indirectCosts.length;

  // タブ定義（無効化判定込み）
  const tabs: Array<{ key: PaneTab; label: string; count?: number; disabled?: boolean }> = [
    { key: 'flow', label: '流れ', count: graph.flows.length },
    { key: 'blocks', label: 'ブロック', count: graph.blocks.length },
    { key: 'recipients', label: '支出先', count: block?.recipients.length ?? 0 },
    { key: 'indirect-cost', label: '間接経費', count: indirectCount, disabled: indirectCount === 0 },
  ];

  return (
    <aside style={{
      width: 390,
      minWidth: 390,
      maxWidth: 460,
      background: '#fff',
      borderLeft: `1px solid ${COLOR_PANEL_BORDER}`,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
      {/* 事業ヘッダー（常時表示） */}
      <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${COLOR_PANEL_BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111', wordBreak: 'break-all', lineHeight: 1.4 }}>
              {graph.projectName}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#222', marginTop: 3 }}>
              <span style={{ fontSize: PANEL_META_FONT_PX, color: '#aaa', fontWeight: 400, marginRight: 4 }}>予算</span>
              {graph.budget > 0 ? formatYen(graph.budget) : '—'}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: PANEL_META_FONT_PX, color: '#777' }}>
              <span>執行 <strong style={{ color: '#111827' }}>{graph.execution > 0 ? formatYen(graph.execution) : '—'}</strong></span>
            </div>
          </div>
          <ProjectReferenceLinks projectId={graph.projectId} projectName={graph.projectName} year={year} compact />
        </div>
        <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: PANEL_META_FONT_PX }}>
          <span style={{ background: '#2d7d46', color: '#fff', padding: '2px 7px', borderRadius: 10, fontWeight: 500 }}>事業</span>
          <span style={{ color: '#aaa' }}>PID: {graph.projectId}</span>
          <span style={{ color: '#666' }}>{graph.ministry}</span>
          {orgChain.length > 0 && <span style={{ color: '#777' }}>{orgChain.join(' / ')}</span>}
          {!orgChain.length && projectDetail?.bureau && <span style={{ color: '#777' }}>{projectDetail.bureau}</span>}
          <span style={{ padding: '2px 6px', borderRadius: 999, background: '#f3f4f6', color: '#475569' }}>最大{graph.maxDepth}層</span>
          <span style={{ padding: '2px 6px', borderRadius: 999, background: '#f3f4f6', color: '#475569' }}>ブロック {graph.totalBlockCount}</span>
          <span style={{ padding: '2px 6px', borderRadius: 999, background: '#f3f4f6', color: '#475569' }}>支出先 {graph.totalRecipientCount.toLocaleString()}</span>
          <span style={{ padding: '2px 6px', borderRadius: 999, background: '#f9dddd', color: COLOR_DIRECT_BODY_SUBTLE, fontWeight: 700 }}>直接 {graph.directBlockCount}</span>
          <span style={{ padding: '2px 6px', borderRadius: 999, background: '#fbe3d7', color: '#b45309', fontWeight: 700 }}>再委託 {graph.totalBlockCount - graph.directBlockCount - graph.separateOriginCount}</span>
          {graph.separateOriginCount > 0 && (
            <span style={{ padding: '2px 6px', borderRadius: 999, background: '#e0e7ff', color: COLOR_SEPARATE_ORIGIN_BODY_TEXT, fontWeight: 700 }}>
              別財源 {graph.separateOriginCount}
            </span>
          )}
          {graph.hasMerge && (
            <span style={{ padding: '2px 6px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontWeight: 700 }}>
              合流 最大{graph.maxMergeWidth}本
            </span>
          )}
          {graph.isInstitutionalFlowOnly && (
            <span style={{ padding: '2px 6px', borderRadius: 999, background: '#fef2f2', color: '#991b1b', fontWeight: 700 }}>
              制度フロー
            </span>
          )}
          {graph.indirectCosts.length > 0 && (
            <span style={{ padding: '2px 6px', borderRadius: 999, background: '#ecfeff', color: '#0e7490', fontWeight: 700 }}>
              間接経費 {graph.indirectCosts.length}
            </span>
          )}
        </div>
        {projectDetail?.majorExpense && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, marginBottom: 2 }}>主要経費</div>
            <div style={{ fontSize: 11, color: '#111827', lineHeight: 1.5 }}>{projectDetail.majorExpense}</div>
          </div>
        )}

      </div>

      {/* タブヘッダー */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${COLOR_PANEL_BORDER}`,
        background: '#fff',
      }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          const isDisabled = tab.disabled;
          return (
            <button
              key={tab.key}
              onClick={() => !isDisabled && onChangeTab(tab.key)}
              disabled={isDisabled}
              style={{
                flex: 1,
                background: isActive ? '#f1f5f9' : '#fff',
                border: 'none',
                borderBottom: isActive ? '2px solid #6366f1' : '2px solid transparent',
                padding: '10px 4px 8px',
                fontSize: 12,
                fontWeight: 700,
                color: isDisabled ? '#cbd5e1' : (isActive ? '#111827' : '#475569'),
                cursor: isDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {tab.label}
              {typeof tab.count === 'number' && (
                <span style={{ marginLeft: 4, fontSize: 10, color: isDisabled ? '#cbd5e1' : '#94a3b8' }}>
                  {tab.count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
      </div>

      {/* タブ本体 */}
      <div style={{ padding: 12, flex: 1, minHeight: 0 }}>
        {activeTab === 'flow' && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: '#64748b' }}>{filteredFlows.length.toLocaleString()}本 / {graph.flows.length.toLocaleString()}本</div>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
              {([
                ['all', 'すべて'],
                ['direct', '直接'],
                ['transfer', '移替'],
                ['separate-origin', '別財源'],
                ['subcontract', '再委託'],
                ['reference', '参考'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFlowFilter(key)}
                  style={{
                    border: `1px solid ${flowFilter === key ? '#94a3b8' : COLOR_PANEL_BORDER}`,
                    background: flowFilter === key ? '#f1f5f9' : '#fff',
                    borderRadius: 999,
                    padding: '4px 9px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {filteredFlows.length === 0 && (
              <div style={{ fontSize: 12, color: '#9ca3af' }}>該当するフローがありません</div>
            )}
            {filteredFlows.map((flow, i) => (
              <FlowListRow
                key={`${flow.sourceBlock ?? 'root'}->${flow.targetBlock}-${i}`}
                flow={flow}
                graph={graph}
                onSelectBlock={onSelectBlock}
              />
            ))}
          </>
        )}

        {activeTab === 'blocks' && (
          <>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
              {filteredBlocks.length.toLocaleString()}件 / {graph.blocks.length.toLocaleString()}件
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 8, marginBottom: 8 }}>
              <input
                value={blockQuery}
                onChange={(e) => setBlockQuery(e.target.value)}
                placeholder="ブロック名・役割で検索"
                style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 9px', fontSize: 12 }}
              />
              <select
                value={blockSort}
                onChange={(e) => setBlockSort(e.target.value as typeof blockSort)}
                style={{ border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 8px', fontSize: 12, background: '#fff' }}
              >
                <option value="amount-desc">金額順</option>
                <option value="name-asc">名称順</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {([
                ['all', 'すべて'],
                ['direct', '直接'],
                ['subcontract', '再委託'],
                ['separate-origin', '別財源'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setBlockFilter(key)}
                  style={{
                    border: `1px solid ${blockFilter === key ? '#94a3b8' : COLOR_PANEL_BORDER}`,
                    background: blockFilter === key ? '#f1f5f9' : '#fff',
                    borderRadius: 999,
                    padding: '5px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {filteredBlocks.map((b) => (
              <BlockListRow
                key={b.blockId}
                block={b}
                onClick={() => onSelectBlock(b)}
                selected={block?.blockId === b.blockId}
              />
            ))}
          </>
        )}

        {activeTab === 'recipients' && (
          <>
            {!block && (
              <div style={{ fontSize: 12, color: '#9ca3af', padding: '24px 12px', textAlign: 'center', lineHeight: 1.6 }}>
                フロー図またはブロックタブからブロックを選択すると、<br />
                その支出先内訳が表示されます。
              </div>
            )}
            {block && (
              <>
                {/* 選択中ブロックの要約 */}
                <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {(() => {
                        const badge = originKindBadgeColor(block.originKind);
                        return (
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: badge.bg,
                            color: badge.fg,
                            flexShrink: 0,
                          }}>
                            {originKindLabel(block.originKind)}
                          </span>
                        );
                      })()}
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {block.blockId} {block.blockName}
                      </span>
                    </div>
                    <button
                      onClick={onDeselectBlock}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#94a3b8', fontSize: 14 }}
                      aria-label="選択解除"
                      title="選択解除"
                    >✕</button>
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
                    {formatYen(block.totalAmount)} ／ 支出先 {block.recipientCount.toLocaleString()}件
                    ／ 構成比 {percentOf(block.totalAmount, Math.max(graph.execution, graph.budget, block.totalAmount))}
                  </div>
                  {block.role && (
                    <div style={{ fontSize: 11, color: '#374151', marginTop: 4, padding: '3px 6px', background: '#fff', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                      {block.role}
                    </div>
                  )}
                  {(downstreamBlocks.length > 0 || upstreamBlocks.length > 0) && (
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>
                      上流 {upstreamBlocks.length}件 ／ 下流 {downstreamBlocks.length}件
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 8, marginBottom: 8 }}>
                  <input
                    value={recipientQuery}
                    onChange={(e) => setRecipientQuery(e.target.value)}
                    placeholder="支出先・法人番号・契約で検索"
                    style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 9px', fontSize: 12 }}
                  />
                  <select
                    value={recipientSort}
                    onChange={(e) => setRecipientSort(e.target.value as typeof recipientSort)}
                    style={{ border: `1px solid ${COLOR_PANEL_BORDER}`, borderRadius: 6, padding: '7px 8px', fontSize: 12, background: '#fff' }}
                  >
                    <option value="amount-desc">金額大</option>
                    <option value="amount-asc">金額小</option>
                    <option value="name-asc">名称順</option>
                  </select>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{sortedRecipients.length.toLocaleString()}件</div>
                {sortedRecipients.map((r, i) => (
                  <RecipientCard
                    key={`${r.name}-${r.corporateNumber}-${i}`}
                    recipient={r}
                    expanded={expandedRecipients.has(i)}
                    onToggle={() => toggleRecipient(i)}
                    totalAmount={block.totalAmount}
                    barColor={originPalette(block.originKind).header}
                  />
                ))}
                {sortedRecipients.length === 0 && (
                  <p style={{ fontSize: 12, color: '#9ca3af' }}>該当する支出先がありません</p>
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'indirect-cost' && (
          <>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
              国自らが支出する間接経費 {indirectCount.toLocaleString()}件
            </div>
            {graph.indirectCosts.length === 0 && (
              <div style={{ fontSize: 12, color: '#9ca3af' }}>間接経費の記録はありません</div>
            )}
            {graph.indirectCosts.map((cost, i) => (
              <div key={i} style={{ borderBottom: '1px solid #f1f5f9', padding: '8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cost.category || cost.kind || '（項目なし）'}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#555', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {cost.amount > 0 ? formatYen(cost.amount) : '—'}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  {cost.kind && <span style={{ marginRight: 8 }}>{cost.kind}</span>}
                  {cost.blockHint && <span>{cost.blockHint}</span>}
                </div>
                {cost.note && (
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{cost.note}</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function BlockListRow({ block, selected, onClick }: { block: BlockNode; selected: boolean; onClick: () => void }) {
  const badge = originKindBadgeColor(block.originKind);
  const badgeText = originKindLabel(block.originKind);

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        textAlign: 'left',
        border: 'none',
        borderBottom: '1px solid #f1f5f9',
        background: selected ? '#f8fafc' : 'transparent',
        borderRadius: 0,
        padding: '7px 0',
        margin: 0,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', width: '100%' }}>
        <div title={`${block.blockId} ${block.blockName}`} style={{ flex: 1, fontSize: PANEL_LIST_NAME_FONT_PX, fontWeight: 600, color: selected ? '#111827' : '#333', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {block.blockId} {block.blockName}
        </div>
        <div style={{ fontSize: PANEL_LIST_VALUE_FONT_PX, fontWeight: 600, color: '#555', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(block.totalAmount)}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: PANEL_META_FONT_PX, color: '#888', width: '100%', minWidth: 0 }}>
        <span style={{
          padding: '1px 6px',
          borderRadius: 999,
          background: badge.bg,
          color: badge.fg,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {badgeText}
        </span>
        <span>支出先 {block.recipientCount.toLocaleString()}件</span>
        {block.hasExpenses && (
          <span style={{ color: '#0e7490' }}>費目あり</span>
        )}
        {block.role && (
          <span title={block.role} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {block.role}
          </span>
        )}
      </div>
    </button>
  );
}

function FlowListRow({
  flow, graph, onSelectBlock,
}: {
  flow: BlockEdge;
  graph: SubcontractGraph;
  onSelectBlock: (block: BlockNode) => void;
}) {
  const blockById = new Map(graph.blocks.map(b => [b.blockId, b]));
  const sourceBlock = flow.sourceBlock ? blockById.get(flow.sourceBlock) ?? null : null;
  const targetBlock = blockById.get(flow.targetBlock) ?? null;
  const sourceLabel = flow.sourceBlock === null
    ? `${graph.ministry}（直接）`
    : sourceBlock ? `${sourceBlock.blockId} ${sourceBlock.blockName}` : flow.sourceBlock;
  const targetLabel = targetBlock ? `${targetBlock.blockId} ${targetBlock.blockName}` : flow.targetBlock;
  const badge = flowOriginBadgeColor(flow.origin);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        borderBottom: '1px solid #f1f5f9',
        padding: '6px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: PANEL_META_FONT_PX, color: '#64748b' }}>
        <span style={{
          padding: '1px 6px',
          borderRadius: 999,
          background: badge.bg,
          color: badge.fg,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {flowOriginLabel(flow.origin)}
        </span>
        {flow.targetIncomingBlockCount >= 2 && (
          <span style={{ padding: '1px 6px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontWeight: 700 }}>
            合流 {flow.targetIncomingBlockCount}本
          </span>
        )}
        {flow.isReference && (
          <span style={{ padding: '1px 6px', borderRadius: 999, background: '#f1f5f9', color: '#475569', fontWeight: 700 }}>
            参考標記
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: PANEL_LIST_NAME_FONT_PX, color: '#111827', minWidth: 0 }}>
        {sourceBlock ? (
          <button
            onClick={() => onSelectBlock(sourceBlock)}
            title={sourceLabel}
            style={{ flex: 1, minWidth: 0, fontSize: PANEL_LIST_NAME_FONT_PX, color: '#2563eb', background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {sourceLabel}
          </button>
        ) : (
          <span title={sourceLabel} style={{ flex: 1, minWidth: 0, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sourceLabel}
          </span>
        )}
        <span style={{ color: '#94a3b8', flexShrink: 0 }}>→</span>
        {targetBlock ? (
          <button
            onClick={() => onSelectBlock(targetBlock)}
            title={targetLabel}
            style={{ flex: 1, minWidth: 0, fontSize: PANEL_LIST_NAME_FONT_PX, color: '#2563eb', background: 'none', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {targetLabel}
          </button>
        ) : (
          <span title={targetLabel} style={{ flex: 1, minWidth: 0, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {targetLabel}
          </span>
        )}
      </div>
      {flow.note && (
        <div title={flow.note} style={{ fontSize: PANEL_META_FONT_PX, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {flow.note}
        </div>
      )}
    </div>
  );
}

function RecipientCard({
  recipient, expanded, onToggle, totalAmount, barColor,
}: {
  recipient: BlockRecipient;
  expanded: boolean;
  onToggle: () => void;
  totalAmount: number;
  barColor: string;
}) {
  const hasDetails = recipient.contractSummaries.length > 0 || recipient.expenses.length > 0;
  const share = totalAmount > 0 ? Math.max(2, Math.min(100, (recipient.amount / totalAmount) * 100)) : 0;

  return (
    <div style={{
      borderBottom: '1px solid #f1f5f9',
      fontSize: PANEL_LIST_NAME_FONT_PX,
    }}>
      <div
        style={{
          padding: '7px 0',
          background: 'transparent',
          cursor: hasDetails ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
        onClick={hasDetails ? onToggle : undefined}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <div title={recipient.name || '（氏名なし）'} style={{ flex: 1, minWidth: 0, fontWeight: 600, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{recipient.name || '（氏名なし）'}</div>
            <div style={{ color: '#555', fontSize: PANEL_LIST_VALUE_FONT_PX, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{formatYen(recipient.amount)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <div style={{ width: 52, height: 3, background: '#eef2f7', borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{ width: `${share}%`, height: '100%', background: barColor }} />
            </div>
            <div style={{ color: '#999', fontSize: PANEL_META_FONT_PX, whiteSpace: 'nowrap' }}>構成比 {percentOf(recipient.amount, totalAmount)}</div>
          </div>
          {recipient.corporateNumber && (
            <div style={{ color: '#aaa', fontSize: PANEL_META_FONT_PX, marginTop: 1 }}>法人番号: {recipient.corporateNumber}</div>
          )}
        </div>
        {hasDetails && (
          <span style={{ color: '#aaa', fontSize: 12, marginTop: 1, flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {expanded && (
        <div style={{ padding: '0 0 8px 60px', background: '#fff' }}>
          {recipient.contractSummaries.map((cs, j) => (
            <div key={j} style={{ color: '#555', marginBottom: 4, lineHeight: 1.5 }}>{cs}</div>
          ))}
          {recipient.expenses.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: PANEL_META_FONT_PX, fontWeight: 600, color: '#888', marginBottom: 4 }}>費目・使途</div>
              {recipient.expenses.map((e, j) => (
                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: '#555', gap: 8 }}>
                  <span style={{ color: '#777', minWidth: 0 }}>{e.category} / {e.purpose}</span>
                  <span style={{ whiteSpace: 'nowrap', fontWeight: 500, color: '#555' }}>{formatYen(e.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── メインページ ──────────────────────────────────────────────

function SubcontractDetailPageInner() {
  const params = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const projectId = params.projectId;
  const parsedYear = Number.parseInt(searchParams.get('year') ?? '2025', 10);
  const year = parsedYear === 2024 || parsedYear === 2025 ? parsedYear : 2025;

  const [graph, setGraph] = useState<SubcontractGraph | null>(null);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [orgChain, setOrgChain] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<BlockNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);
  const [activeTab, setActiveTab] = useState<PaneTab>('flow');

  // ノードクリック: 同じブロックなら解除、別ブロックなら選択 + 支出先タブへ
  const handleNodeClick = useCallback((node: BlockNode) => {
    setSelectedBlock((prev) => {
      if (prev?.blockId === node.blockId) return null;
      return node;
    });
    setActiveTab((prev) => (selectedBlock?.blockId === node.blockId ? prev : 'recipients'));
  }, [selectedBlock]);

  // フロー一覧/ブロック一覧の行から選択した場合: 選択 + 支出先タブへ
  const handleSelectFromList = useCallback((node: BlockNode) => {
    setSelectedBlock(node);
    setActiveTab('recipients');
  }, []);

  // ズーム/パン
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [baseZoom, setBaseZoom] = useState(1);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setSelectedBlock(null);
    setActiveTab('flow');
    setHoveredNode(null);
    setProjectDetail(null);
    setOrgChain([]);
    fetch(`/api/subcontracts/${projectId}?year=${year}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: SubcontractGraph) => {
        if (controller.signal.aborted) return;
        setGraph(data);
        // 主語は「事業」。ブロック選択はユーザーの明示クリックを起点とする
        setSelectedBlock(null);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError') return;
        setError(e.message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, year]);

  useEffect(() => {
    if (!graph) return;
    const controller = new AbortController();
    fetch(`/api/project-details/${projectId}?year=${year}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data: ProjectDetail | null) => {
        if (controller.signal.aborted) return;
        setProjectDetail(data);
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError') return;
        setProjectDetail(null);
      });
    return () => controller.abort();
  }, [graph, projectId, year]);

  useEffect(() => {
    if (!graph) return;
    const controller = new AbortController();
    fetch(`/data/project-quality-scores-${year}.json`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : [])
      .then((items: ProjectQualityOrg[]) => {
        if (controller.signal.aborted) return;
        const item = items.find((v) => String(v.pid) === String(projectId));
        const chain = item
          ? [item.bureau, item.division, item.section, item.office, item.team, item.unit]
              .map((v) => v?.trim() ?? '')
              .filter(Boolean)
          : [];
        setOrgChain(chain);
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError') return;
        setOrgChain([]);
      });
    return () => controller.abort();
  }, [graph, projectId, year]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setTransform((prev) => {
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(10, Math.max(0.1, prev.scale * factor));
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, scale: newScale };
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      return {
        scale: newScale,
        x: cx - (cx - prev.x) * (newScale / prev.scale),
        y: cy - (cy - prev.y) * (newScale / prev.scale),
      };
    });
  }, []);

  useEffect(() => {
    if (!graph) return; // SVGがレンダリングされるまで待つ
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel, graph]);

  // ページタイトル
  useEffect(() => {
    if (graph) document.title = `再委託 ${graph.projectName}`;
    return () => { document.title = '再委託構造ブラウザ'; };
  }, [graph]);

  // Hooks はすべて early return より前に呼ぶ必要がある
  const fallbackOrgChain = useMemo(() => {
    const bureau = projectDetail?.bureau?.trim();
    return bureau ? [bureau] : [];
  }, [projectDetail]);
  const visibleOrgChain = orgChain.length > 0 ? orgChain : fallbackOrgChain;

  const layout = useMemo(() => graph ? computeSubcontractLayout(graph) : null, [graph]);

  const applyZoom = useCallback((factor: number) => {
    setTransform((prev) => {
      const newScale = Math.max(0.1, Math.min(10, prev.scale * factor));
      const container = containerRef.current;
      if (!container) return { ...prev, scale: newScale };
      const cx = container.clientWidth / 2;
      const cy = container.clientHeight / 2;
      return {
        scale: newScale,
        x: cx - (cx - prev.x) * (newScale / prev.scale),
        y: cy - (cy - prev.y) * (newScale / prev.scale),
      };
    });
  }, []);

  const resetViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container || !layout) return;
    const cW = container.clientWidth;
    const cH = container.clientHeight;
    const fitZoom = Math.max(0.05, Math.min(10, Math.min(cW / layout.svgWidth, cH / layout.svgHeight) * 0.9));
    setBaseZoom(fitZoom);
    setTransform({
      x: (cW - layout.svgWidth * fitZoom) / 2,
      y: (cH - layout.svgHeight * fitZoom) / 2,
      scale: fitZoom,
    });
  }, [layout]);

  // グラフ読み込み後に全体表示
  useEffect(() => {
    if (layout) resetViewport();
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!isPanning.current) return;
    setTransform((prev) => ({ ...prev, x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y }));
  }
  function onMouseUp() { isPanning.current = false; }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
        <p style={{ color: '#6b7280' }}>読み込み中...</p>
      </div>
    );
  }

  if (error || !graph) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', gap: 12 }}>
        <p style={{ color: '#ef4444' }}>エラー: {error ?? 'データなし'}</p>
        <Link href="/subcontracts" style={{ color: '#2563eb', fontSize: 14 }}>← 一覧に戻る</Link>
      </div>
    );
  }

  // ここに到達した時点で graph は必ず非 null
  const safeLayout = layout!;
  return (
    <div style={{ display: 'flex', height: '100vh', background: COLOR_CANVAS, overflow: 'hidden' }}>
      {/* SVGキャンバス */}
      <div ref={containerRef} style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
        {/* 一覧へ戻る — 左上 */}
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 15 }}>
          <Link
            href={`/subcontracts?year=${year}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 13,
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.95)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              color: '#333',
              cursor: 'pointer',
              textDecoration: 'none',
            }}
          >
            ← 一覧
          </Link>
        </div>

        {/* 年度切替 — 上部中央 */}
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 15 }}>
          <select
            value={year}
            onChange={(e) => router.push(`/subcontracts/${projectId}?year=${e.target.value}`)}
            style={{
              fontSize: 13,
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: '6px 28px 6px 10px',
              background: 'rgba(255,255,255,0.95)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              color: '#333',
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none',
            }}
          >
            <option value={2025}>2025年度</option>
            <option value={2024}>2024年度</option>
          </select>
          <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 24 24" fill="#999" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <path d="M7 10l5 5 5-5z"/>
          </svg>
        </div>

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ cursor: isPanning.current ? 'grabbing' : 'grab', display: 'block' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
            {/* 順方向エッジ */}
            {safeLayout.edges.filter(e => !e.isBackEdge).map((edge, i) => {
              const target = safeLayout.blocks.find((b) => b.blockId === edge.targetBlock);
              const amountLabel = target && target.totalAmount > 0 ? formatYen(target.totalAmount) : null;
              const edgeStyle = flowEdgeStyle(edge.origin);
              const edgeColor = edgeStyle.stroke;
              const noteLabel = edge.note ? truncateChars(edge.note, 18) : null;
              const labelX = (edge.x1 + edge.x2) / 2;
              const labelY = (edge.y1 + edge.y2) / 2 - 8;
              const labelCharCount = Math.max(
                Array.from(amountLabel ?? '').length,
                Array.from(noteLabel ?? '').length,
                4,
              );
              const labelW = Math.min(140, Math.max(54, labelCharCount * 8 + 18));
              const labelH = amountLabel && noteLabel ? 29 : 18;
              return (
                <g key={`fwd-${i}`}>
                  <path
                    d={verticalBezierPath(edge.x1, edge.y1, edge.x2, edge.y2)}
                    fill="none"
                    stroke={edgeColor}
                    strokeWidth={edgeStyle.width}
                    strokeDasharray={edgeStyle.dasharray}
                  />
                  {(amountLabel || noteLabel) && (
                    <g style={{ pointerEvents: 'none' }}>
                      <rect
                        x={labelX - labelW / 2}
                        y={labelY - labelH / 2}
                        width={labelW}
                        height={labelH}
                        rx={8}
                        fill="rgba(255,255,255,0.88)"
                        stroke="rgba(148,163,184,0.5)"
                      />
                      {amountLabel && (
                        <text
                          x={labelX}
                          y={labelY}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={700}
                          fill="#475569"
                        >
                          {amountLabel}
                        </text>
                      )}
                      {noteLabel && (
                        <text
                          x={labelX}
                          y={amountLabel ? labelY + 10 : labelY}
                          textAnchor="middle"
                          fontSize={8}
                          fontWeight={600}
                          fill="#64748b"
                        >
                          {noteLabel}
                        </text>
                      )}
                    </g>
                  )}
                </g>
              );
            })}

            {/* バックエッジ（循環・参照フロー） */}
            {safeLayout.edges.filter(e => e.isBackEdge).map((edge, i) => (
              <g key={`back-${i}`}>
                <path
                  d={edge.isSelfLoop
                    ? selfLoopPath(edge.x1, edge.y1)
                    : backEdgePath(edge.x1, edge.y1, edge.x2, edge.y2)}
                  fill="none"
                  stroke={COLOR_BACK_EDGE}
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                />
              </g>
            ))}

            {/* 事業コンテキストノード */}
            <g
              onClick={() => { setSelectedBlock(null); setActiveTab('flow'); }}
              onMouseEnter={() => setHoveredNode({ kind: 'root' })}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ cursor: 'pointer' }}
            >
              <title>{[graph.projectName, graph.ministry, ...visibleOrgChain].filter(Boolean).join(' / ')}</title>
              <rect
                x={safeLayout.root.x}
                y={safeLayout.root.y}
                width={safeLayout.root.w}
                height={safeLayout.root.h}
                rx={CARD_RADIUS}
                fill="transparent"
                style={{ pointerEvents: 'all' }}
              />
              <path
                d={roundedTopPath(
                  safeLayout.root.x,
                  safeLayout.root.y,
                  safeLayout.root.w,
                  56,
                  CARD_RADIUS,
                )}
                fill={COLOR_ROOT}
                stroke={COLOR_ROOT}
                strokeWidth={CARD_BORDER_W}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
              <path
                d={roundedBottomPath(
                  safeLayout.root.x,
                  safeLayout.root.y + 56,
                  safeLayout.root.w,
                  safeLayout.root.h - 56,
                  CARD_RADIUS,
                )}
                fill={COLOR_CONTEXT_BODY}
                stroke={COLOR_ROOT}
                strokeWidth={CARD_BORDER_W}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
              <text
                x={safeLayout.root.x + 14}
                y={safeLayout.root.y + 18}
                fontSize={9}
                fontWeight={700}
                fill="rgba(255,255,255,0.78)"
                style={{ userSelect: 'none' }}
              >
                事業 / PID {graph.projectId}
              </text>
              <text
                x={safeLayout.root.x + 14}
                y={safeLayout.root.y + 34}
                fontSize={11}
                fontWeight={700}
                fill="#fff"
                style={{ userSelect: 'none' }}
              >
                {labelLines(graph.projectName, 32, 16).map((line, i) => (
                  <tspan key={i} x={safeLayout.root.x + 14} dy={i === 0 ? 0 : 12}>{line}</tspan>
                ))}
              </text>
              <text
                x={safeLayout.root.x + 14}
                y={safeLayout.root.y + 75}
                fontSize={9}
                fontWeight={700}
                fill={COLOR_CONTEXT_BODY_SUBTLE}
                style={{ userSelect: 'none' }}
              >
                府省庁
              </text>
              <text
                x={safeLayout.root.x + 70}
                y={safeLayout.root.y + 75}
                fontSize={10}
                fontWeight={700}
                fill={COLOR_CONTEXT_BODY_TEXT}
                style={{ userSelect: 'none' }}
              >
                {truncateChars(graph.ministry, 18)}
              </text>
              {visibleOrgChain.length > 0 && (
                <>
                  <text
                    x={safeLayout.root.x + 14}
                    y={safeLayout.root.y + 94}
                    fontSize={9}
                    fontWeight={700}
                    fill={COLOR_CONTEXT_BODY_SUBTLE}
                    style={{ userSelect: 'none' }}
                  >
                    担当組織
                  </text>
                  <text
                    x={safeLayout.root.x + 70}
                    y={safeLayout.root.y + 94}
                    fontSize={9}
                    fontWeight={600}
                    fill={COLOR_CONTEXT_BODY_TEXT}
                    style={{ userSelect: 'none' }}
                  >
                    {labelLines(visibleOrgChain.map((v, i) => `${ORG_LEVEL_LABELS[i] ?? '組織'}:${v}`).join(' / '), 34, 17).map((line, i) => (
                      <tspan key={i} x={safeLayout.root.x + 70} dy={i === 0 ? 0 : 11}>{line}</tspan>
                    ))}
                  </text>
                </>
              )}
              <text
                x={safeLayout.root.x + safeLayout.root.w - 14}
                y={safeLayout.root.y + safeLayout.root.h - 24}
                textAnchor="end"
                fontSize={9}
                fontWeight={700}
                fill={COLOR_CONTEXT_BODY_SUBTLE}
                style={{ userSelect: 'none' }}
              >
                <tspan x={safeLayout.root.x + safeLayout.root.w - 14}>予算 {graph.budget > 0 ? formatYen(graph.budget) : '—'}</tspan>
                <tspan x={safeLayout.root.x + safeLayout.root.w - 14} dy={12}>支出 {graph.execution > 0 ? formatYen(graph.execution) : '—'}</tspan>
              </text>
            </g>

            {/* ブロックノード（縦型カードフロー） */}
            {safeLayout.blocks.map((lb) => {
              const isSelected = selectedBlock?.blockId === lb.blockId;
              const palette = originPalette(lb.originKind);
              const nodeColor = palette.header;
              const bodyFill = palette.body;
              const bodyTextColor = palette.bodyText;
              const bodySubtleTextColor = palette.bodySubtle;
              const recipients = lb.node.recipients;
              const topRecipients = sortRecipients(recipients, 'amount-desc').slice(0, 3);
              const clipIdBase = `subcontract-node-${String(lb.blockId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
              const selectedStroke = palette.selectedStroke;
              const roleLine = lb.node.role ? truncateChars(lb.node.role, 24) : '';
              const headerKindLabel = palette.badgeText;

              return (
                <g
                  key={lb.blockId}
                  onClick={() => handleNodeClick(lb.node)}
                  onMouseEnter={() => setHoveredNode({ kind: 'block', block: lb })}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <defs>
                    <clipPath id={`${clipIdBase}-card`}>
                      <rect x={lb.x} y={lb.y} width={lb.w} height={lb.h} rx={CARD_RADIUS} />
                    </clipPath>
                  </defs>
                  <rect
                    x={lb.x}
                    y={lb.y}
                    width={lb.w}
                    height={lb.h}
                    rx={CARD_RADIUS}
                    fill="transparent"
                    style={{ pointerEvents: 'all' }}
                  />

                  <path
                    d={roundedTopPath(
                      lb.x,
                      lb.y,
                      lb.w,
                      CARD_HEADER_H,
                      CARD_RADIUS,
                    )}
                    fill={nodeColor}
                    stroke={nodeColor}
                    strokeWidth={CARD_BORDER_W}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'none' }}
                  />
                  <path
                    d={roundedBottomPath(
                      lb.x,
                      lb.y + CARD_HEADER_H,
                      lb.w,
                      lb.h - CARD_HEADER_H,
                      CARD_RADIUS,
                    )}
                    fill={bodyFill}
                    stroke={isSelected ? selectedStroke : nodeColor}
                    strokeWidth={CARD_BORDER_W}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: 'none' }}
                  />

                  <g clipPath={`url(#${clipIdBase}-card)`} style={{ pointerEvents: 'none' }}>
                    <text x={lb.x + NODE_PAD} y={lb.y + 17}
                      fontSize={10} fontWeight={700} fill="rgba(255,255,255,0.86)" style={{ userSelect: 'none' }}>
                      {headerKindLabel} / ブロック {lb.blockId}
                    </text>
                    <text x={lb.x + NODE_PAD} y={lb.y + 34}
                      fontSize={12} fontWeight={700} fill="#fff" style={{ userSelect: 'none' }}>
                      {truncateChars(lb.blockName, 18)}
                    </text>
                  </g>

                  <g clipPath={`url(#${clipIdBase}-card)`} style={{ pointerEvents: 'none' }}>
                    <text x={lb.x + NODE_PAD} y={lb.y + CARD_HEADER_H + 18}
                      fontSize={11} fontWeight={700} fill={bodyTextColor} style={{ userSelect: 'none' }}>
                      {lb.isZeroAmount ? '金額内訳なし' : `${formatYen(lb.totalAmount)} / 支出先 ${recipients.length.toLocaleString()}件`}
                    </text>
                    {roleLine && (
                      <text x={lb.x + NODE_PAD} y={lb.y + CARD_HEADER_H + 35}
                        fontSize={9} fontWeight={600} fill={bodySubtleTextColor} style={{ userSelect: 'none' }}>
                        {roleLine}
                      </text>
                    )}
                    {!lb.isZeroAmount && topRecipients.map((r, i) => (
                      <text
                        key={`${r.name}-${r.corporateNumber}-${i}`}
                        x={lb.x + NODE_PAD}
                        y={lb.y + CARD_HEADER_H + 56 + i * 16}
                        fontSize={9}
                        fill={bodyTextColor}
                        style={{ userSelect: 'none' }}
                      >
                        <tspan fontWeight={700}>{i + 1}.</tspan>
                        <tspan dx={4}>{truncateChars(r.name || '（氏名なし）', 12)}</tspan>
                        <tspan x={lb.x + lb.w - NODE_PAD} textAnchor="end" fontWeight={700} fill={bodySubtleTextColor}>
                          {formatYen(r.amount)}
                        </tspan>
                      </text>
                    ))}
                  </g>
                </g>
              );
            })}
          </g>

          {hoveredNode && (() => {
            const isRoot = hoveredNode.kind === 'root';
            const lb = hoveredNode.kind === 'block' ? hoveredNode.block : null;
            const world = isRoot
              ? safeLayout.root
              : { x: lb!.x, y: lb!.y, w: lb!.w, h: lb!.h };
            const tipW = 300;
            const tipH = isRoot ? 126 : 142;
            const containerW = containerRef.current?.clientWidth ?? 1000;
            const screenLeft = transform.x + world.x * transform.scale;
            const screenTop = transform.y + world.y * transform.scale;
            const screenW = world.w * transform.scale;
            const tipX = Math.max(8, Math.min(containerW - tipW - 8, screenLeft + screenW / 2 - tipW / 2));
            const tipY = Math.max(8, screenTop - tipH - 8);
            const palette = lb ? originPalette(lb.originKind) : null;
            const headerColor = isRoot ? COLOR_ROOT : palette!.header;
            const bodyColor = isRoot ? COLOR_CONTEXT_BODY : palette!.body;
            const textColor = isRoot ? COLOR_CONTEXT_BODY_TEXT : palette!.bodyText;
            const topRecipients = lb ? sortRecipients(lb.node.recipients, 'amount-desc').slice(0, 3) : [];

            return (
              <foreignObject x={tipX} y={tipY} width={tipW} height={tipH} style={{ pointerEvents: 'none' }}>
                <div style={{
                  width: tipW,
                  height: tipH,
                  boxSizing: 'border-box',
                  border: `1px solid ${headerColor}`,
                  borderRadius: 6,
                  background: bodyColor,
                  boxShadow: '0 8px 22px rgba(15,23,42,0.18)',
                  overflow: 'hidden',
                  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                }}>
                  <div style={{
                    background: headerColor,
                    color: '#fff',
                    padding: '7px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: 1.35,
                  }}>
                    {isRoot
                      ? `事業 / PID ${graph.projectId}`
                      : `${palette!.badgeText} / ブロック ${lb!.blockId}`}
                  </div>
                  <div style={{ padding: '8px 10px', fontSize: 11, lineHeight: 1.45, color: textColor }}>
                    {isRoot ? (
                      <>
                        <div style={{ fontWeight: 700, color: '#111827', marginBottom: 4 }}>{graph.projectName}</div>
                        <div>府省庁: {graph.ministry}</div>
                        {visibleOrgChain.length > 0 && <div>担当組織: {visibleOrgChain.join(' / ')}</div>}
                        <div>予算: {graph.budget > 0 ? formatYen(graph.budget) : '—'} / 支出: {graph.execution > 0 ? formatYen(graph.execution) : '—'}</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontWeight: 700, color: '#111827', marginBottom: 4 }}>{lb!.blockName}</div>
                        <div>{formatYen(lb!.totalAmount)} / 支出先 {lb!.node.recipients.length.toLocaleString()}件</div>
                        {lb!.node.role && <div>{lb!.node.role}</div>}
                        {topRecipients.map((r, i) => (
                          <div key={`${r.name}-${r.corporateNumber}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {r.name || '（氏名なし）'}</span>
                            <span style={{ flexShrink: 0, fontWeight: 700 }}>{formatYen(r.amount)}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </foreignObject>
            );
          })()}
        </svg>

        {/* ズームコントロール — 右下（BlockPanel 表示時は左にシフト） */}
        <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* + / スライダー / - */}
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <button aria-label="ズームイン" onClick={() => applyZoom(1.5)} title="ズームイン" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', borderBottom: '1px solid #e5e7eb', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
            <div style={{ padding: '4px 0', display: 'flex', justifyContent: 'center', borderBottom: '1px solid #e5e7eb' }}>
              <input
                type="range"
                aria-label="ズーム倍率"
                min={Math.log10(0.1)}
                max={Math.log10(10)}
                step={0.01}
                value={Math.log10(Math.max(0.1, Math.min(10, transform.scale)))}
                onChange={e => { const newK = Math.pow(10, parseFloat(e.target.value)); applyZoom(newK / transform.scale); }}
                style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 16, height: 80 }}
                title={`Zoom: ${Math.round(transform.scale / baseZoom * 100)}%`}
              />
            </div>
            <button aria-label="ズームアウト" onClick={() => applyZoom(1 / 1.5)} title="ズームアウト" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', background: 'transparent', border: 'none', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="#555"><path d="M19 13H5v-2h14v2z"/></svg>
            </button>
          </div>
          {/* Zoom% */}
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
            {isEditingZoom ? (
              <input
                type="number"
                autoFocus
                min={1} max={1000} step={1}
                value={zoomInputValue}
                onChange={e => setZoomInputValue(e.target.value)}
                onBlur={() => { const v = Number(zoomInputValue); if (!isNaN(v) && v > 0) applyZoom((v / 100 * baseZoom) / transform.scale); setIsEditingZoom(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { const v = Number(zoomInputValue); if (!isNaN(v) && v > 0) applyZoom((v / 100 * baseZoom) / transform.scale); setIsEditingZoom(false); } else if (e.key === 'Escape') { setIsEditingZoom(false); } }}
                style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '3px 0', border: 'none', outline: 'none', background: 'transparent', color: '#555', boxSizing: 'border-box' }}
              />
            ) : (
              <button
                onClick={() => { setZoomInputValue(String(Math.round(transform.scale / baseZoom * 100))); setIsEditingZoom(true); }}
                title="クリックしてZoom率を入力"
                style={{ width: '100%', fontSize: 10, textAlign: 'center', padding: '4px 0', border: 'none', background: 'transparent', color: '#888', cursor: 'text' }}
              >{Math.round(transform.scale / baseZoom * 100)}%</button>
            )}
          </div>
          {/* 全体表示 */}
          <div style={{ background: 'rgba(255,255,255,0.9)', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.12)', overflow: 'hidden', width: 44 }}>
            <button aria-label="全体表示" onClick={resetViewport} title="全体表示" style={{ width: '100%', padding: '5px 0', display: 'flex', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#666"><path d="M792-576v-120H672v-72h120q30 0 51 21.15T864-696v120h-72Zm-696 0v-120q0-30 21.15-51T168-768h120v72H168v120H96Zm576 384v-72h120v-120h72v120q0 30-21.15 51T792-192H672Zm-504 0q-30 0-51-21.15T96-264v-120h72v120h120v72H168Zm72-144v-288h480v288H240Zm72-72h336v-144H312v144Zm0 0v-144 144Z"/></svg>
            </button>
          </div>
        </div>

      </div>

        {/* サイドパネル */}
        <SidePane
          block={selectedBlock}
          graph={graph}
          projectDetail={projectDetail}
          orgChain={visibleOrgChain}
          year={year}
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          onSelectBlock={handleSelectFromList}
          onDeselectBlock={() => setSelectedBlock(null)}
        />
    </div>
  );
}

export default function SubcontractDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>}>
      <SubcontractDetailPageInner />
    </Suspense>
  );
}
