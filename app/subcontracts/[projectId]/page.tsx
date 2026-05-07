'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SubcontractGraph, BlockNode, BlockRecipient } from '@/types/subcontract';
import type { ProjectDetail } from '@/types/project-details';
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
const COLOR_CONTEXT_BODY = '#d8f1df';
const COLOR_CONTEXT_BODY_TEXT = '#1f6b3a';
const COLOR_CONTEXT_BODY_SUBTLE = '#2d7d46';
const COLOR_PANEL_BORDER = '#e5e7eb';
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

function chooseDefaultBlock(graph: SubcontractGraph): BlockNode | null {
  const redelegated = graph.blocks
    .filter((b) => !b.isDirect && b.recipients.length > 0)
    .sort((a, b) => b.totalAmount - a.totalAmount);
  if (redelegated[0]) return redelegated[0];
  return [...graph.blocks].sort((a, b) => b.totalAmount - a.totalAmount)[0] ?? null;
}

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

// ─── ブロック詳細ペイン ──────────────────────────────────────────────

function BlockDetailPane({
  block,
  graph,
  projectDetail,
  orgChain,
  onClose,
  onSelectBlock,
}: {
  block: BlockNode | null;
  graph: SubcontractGraph;
  projectDetail: ProjectDetail | null;
  orgChain: string[];
  onClose: () => void;
  onSelectBlock: (block: BlockNode) => void;
}) {
  const [expandedRecipients, setExpandedRecipients] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [recipientSort, setRecipientSort] = useState<'amount-desc' | 'amount-asc' | 'name-asc'>('amount-desc');
  const [blockFilter, setBlockFilter] = useState<'all' | 'direct' | 'subcontract'>('all');
  const [blockSort, setBlockSort] = useState<'amount-desc' | 'name-asc'>('amount-desc');
  const [relationMode, setRelationMode] = useState<'recipients' | 'downstream' | 'upstream'>('recipients');

  useEffect(() => {
    setExpandedRecipients(new Set());
    setQuery('');
    setRelationMode('recipients');
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

  if (!block) {
    const summaryRows = [
      ['PID', graph.projectId],
      ['府省庁', graph.ministry],
      ['担当組織', orgChain.length > 0 ? orgChain.join(' / ') : projectDetail?.bureau ?? '未設定'],
      ['予算額', graph.budget > 0 ? formatYen(graph.budget) : '未設定'],
      ['執行額', graph.execution > 0 ? formatYen(graph.execution) : '未設定'],
    ];

    const filteredBlocks = graph.blocks
      .filter((b) => blockFilter === 'all' || (blockFilter === 'direct' ? b.isDirect : !b.isDirect))
      .filter((b) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return `${b.blockId} ${b.blockName} ${b.role ?? ''}`.toLowerCase().includes(q);
      })
      .sort((a, b) => blockSort === 'name-asc'
        ? `${a.blockId} ${a.blockName}`.localeCompare(`${b.blockId} ${b.blockName}`, 'ja')
        : b.totalAmount - a.totalAmount);

    return (
      <aside style={{
        width: 390,
        minWidth: 390,
        maxWidth: 460,
        background: '#fff',
        borderLeft: `1px solid ${COLOR_PANEL_BORDER}`,
        overflowY: 'auto',
      }}>
        <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${COLOR_PANEL_BORDER}`, position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'inline-block',
              fontSize: 11,
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 4,
              background: '#e7f6ec',
              color: '#2d7d46',
              marginBottom: 6,
            }}>
              事業・組織
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', lineHeight: 1.45 }}>
              {graph.projectName}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              ブロックを選ぶと支出先リストと前後のフローを絞り込めます
            </div>
          </div>
        </div>

        <div style={{ padding: 12, borderBottom: `1px solid ${COLOR_PANEL_BORDER}` }}>
          {summaryRows.map(([label, value]) => (
            <div key={label} style={{
              display: 'grid',
              gridTemplateColumns: '72px 1fr',
              gap: 10,
              padding: '9px 0',
              borderBottom: '1px solid #f1f5f9',
              fontSize: 12,
              lineHeight: 1.55,
            }}>
              <div style={{ color: '#64748b', fontWeight: 700 }}>{label}</div>
              <div style={{ color: '#111827', wordBreak: 'break-word' }}>{value}</div>
            </div>
          ))}
          {projectDetail?.majorExpense && (
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, marginBottom: 4 }}>主要経費</div>
              <div style={{ fontSize: 12, color: '#111827', lineHeight: 1.55 }}>{projectDetail.majorExpense}</div>
            </div>
          )}
        </div>

        <div style={{ padding: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 8, marginBottom: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {([
              ['all', 'すべて'],
              ['direct', '直接'],
              ['subcontract', '再委託'],
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
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{filteredBlocks.length.toLocaleString()}件</div>
          {filteredBlocks.map((b) => (
            <BlockListRow key={b.blockId} block={b} onClick={() => onSelectBlock(b)} selected={false} />
          ))}
        </div>
      </aside>
    );
  }

  const q = query.trim().toLowerCase();
  const sortedRecipients = sortRecipients(block.recipients, recipientSort)
    .filter((r) => !q || `${r.name} ${r.corporateNumber} ${r.contractSummaries.join(' ')}`.toLowerCase().includes(q));
  const relationBlocks = relationMode === 'downstream' ? downstreamBlocks : upstreamBlocks;

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
      {/* ヘッダー */}
      <div style={{
        padding: '16px 16px 12px',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        position: 'sticky',
        top: 0,
        background: '#fff',
        zIndex: 1,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            display: 'inline-block',
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 4,
            background: block.isDirect ? '#f9dddd' : '#fbe3d7',
            color: block.isDirect ? COLOR_DIRECT_BODY_SUBTLE : COLOR_SUBCONTRACT_BODY_SUBTLE,
            marginBottom: 4,
          }}>
            {block.isDirect ? '直接支出' : '再委託'}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{block.blockName}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            ブロック {block.blockId} ／ {formatYen(block.totalAmount)}
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            表示内訳 {block.recipients.length.toLocaleString()}件 ／ 構成比 {percentOf(block.totalAmount, Math.max(graph.execution, graph.budget, block.totalAmount))}
          </div>
          {block.role && (
            <div style={{ fontSize: 11, color: '#374151', marginTop: 4, padding: '3px 6px', background: '#f3f4f6', borderRadius: 4 }}>
              {block.role}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#6b7280', fontSize: 18 }}
          aria-label="閉じる"
        >✕</button>
      </div>

      <div style={{ padding: 12, flex: 1 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {([
            ['recipients', `支出先 ${block.recipients.length}`],
            ['downstream', `下流 ${downstreamBlocks.length}`],
            ['upstream', `上流 ${upstreamBlocks.length}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRelationMode(key)}
              style={{
                flex: 1,
                border: `1px solid ${relationMode === key ? '#94a3b8' : COLOR_PANEL_BORDER}`,
                background: relationMode === key ? '#f1f5f9' : '#fff',
                borderRadius: 6,
                padding: '7px 6px',
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

        {relationMode === 'recipients' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 112px', gap: 8, marginBottom: 8 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="支出先・法人番号・契約概要で検索"
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
                index={i}
                expanded={expandedRecipients.has(i)}
                onToggle={() => toggleRecipient(i)}
                totalAmount={block.totalAmount}
                barColor={block.isDirect ? COLOR_DIRECT : COLOR_SUBCONTRACT}
              />
            ))}
            {sortedRecipients.length === 0 && (
              <p style={{ fontSize: 12, color: '#9ca3af' }}>該当する支出先がありません</p>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
              {relationMode === 'downstream' ? 'このブロックから続く支出ブロック' : 'このブロックへ流入する支出ブロック'}
            </div>
            {relationBlocks.map((b) => (
              <BlockListRow
                key={b.blockId}
                block={b}
                onClick={() => onSelectBlock(b)}
                selected={block.blockId === b.blockId}
              />
            ))}
            {relationBlocks.length === 0 && (
              <p style={{ fontSize: 12, color: '#9ca3af' }}>該当するブロックがありません</p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function BlockListRow({ block, selected, onClick }: { block: BlockNode; selected: boolean; onClick: () => void }) {
  const accent = block.isDirect ? COLOR_DIRECT : COLOR_SUBCONTRACT;

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        border: `1px solid ${selected ? accent : COLOR_PANEL_BORDER}`,
        borderLeft: `4px solid ${accent}`,
        background: selected ? '#fff7ed' : '#fff',
        borderRadius: 6,
        padding: '8px 10px',
        marginBottom: 8,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', minWidth: 0 }}>
          {block.blockId} {block.blockName}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{formatYen(block.totalAmount)}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 5, fontSize: 10, color: '#64748b' }}>
        <span style={{ color: accent, fontWeight: 700 }}>{block.isDirect ? '直接' : '再委託'}</span>
        <span>支出先 {block.recipients.length.toLocaleString()}件</span>
      </div>
      {block.role && (
        <div style={{ fontSize: 11, color: '#475569', marginTop: 4, lineHeight: 1.45 }}>
          {truncateChars(block.role, 52)}
        </div>
      )}
    </button>
  );
}

function RecipientCard({
  recipient, index, expanded, onToggle, totalAmount, barColor,
}: {
  recipient: BlockRecipient;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  totalAmount: number;
  barColor: string;
}) {
  const hasDetails = recipient.contractSummaries.length > 0 || recipient.expenses.length > 0;
  const share = totalAmount > 0 ? Math.max(2, Math.min(100, (recipient.amount / totalAmount) * 100)) : 0;

  return (
    <div style={{
      marginBottom: 8,
      border: '1px solid #e5e7eb',
      borderRadius: 6,
      overflow: 'hidden',
      fontSize: 12,
    }}>
      <div
        style={{
          padding: '8px 10px',
          background: index % 2 === 0 ? '#f9fafb' : '#fff',
          cursor: hasDetails ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
        }}
        onClick={hasDetails ? onToggle : undefined}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 500, color: '#111827' }}>{recipient.name || '（氏名なし）'}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <div style={{ flex: 1, height: 6, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${share}%`, height: '100%', background: barColor }} />
            </div>
            <div style={{ color: '#374151', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatYen(recipient.amount)}</div>
          </div>
          <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 2 }}>構成比 {percentOf(recipient.amount, totalAmount)}</div>
          {recipient.corporateNumber && (
            <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 1 }}>法人番号: {recipient.corporateNumber}</div>
          )}
        </div>
        {hasDetails && (
          <span style={{ color: '#9ca3af', fontSize: 14, marginTop: 2 }}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>

      {expanded && (
        <div style={{ padding: '8px 10px', background: '#f0f9ff', borderTop: '1px solid #e0f2fe' }}>
          {recipient.contractSummaries.map((cs, j) => (
            <div key={j} style={{ color: '#0c4a6e', marginBottom: 4 }}>{cs}</div>
          ))}
          {recipient.expenses.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4 }}>費目・使途</div>
              {recipient.expenses.map((e, j) => (
                <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', color: '#374151', gap: 8 }}>
                  <span style={{ color: '#6b7280' }}>{e.category} / {e.purpose}</span>
                  <span style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{formatYen(e.amount)}</span>
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
  const year = parseInt(searchParams.get('year') ?? '2024', 10);

  const [graph, setGraph] = useState<SubcontractGraph | null>(null);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [orgChain, setOrgChain] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<BlockNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);

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
        setSelectedBlock(chooseDefaultBlock(data));
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
  const directBlocks = graph.blocks.filter((b) => b.isDirect).length;
  const redelegatedBlocks = graph.blocks.filter((b) => !b.isDirect).length;
  const firstDirectBlock = safeLayout.blocks.find((b) => b.depth === 1)?.node;
  const firstRedelegatedBlock = safeLayout.blocks.find((b) => !b.isDirect)?.node;
  const organizationSummary = visibleOrgChain.length > 0 ? visibleOrgChain.join(' -> ') : '担当組織';
  const flowSummary = firstDirectBlock && firstRedelegatedBlock
    ? `${organizationSummary} -> ${graph.projectName} -> ${firstDirectBlock.blockName} -> ${firstRedelegatedBlock.role || firstRedelegatedBlock.blockName}`
    : `${organizationSummary} -> ${graph.projectName} -> ${firstDirectBlock?.blockName ?? '支出先ブロック'}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: COLOR_CANVAS, overflow: 'hidden' }}>
      {/* ヘッダーバー */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        zIndex: 10,
      }}>
        <Link href={`/subcontracts?year=${year}`} style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          ← 一覧
        </Link>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, overflow: 'hidden' }}>
          <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>PID {graph.projectId}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{graph.projectName}</span>
          <span style={{ fontSize: 12, color: '#6b7280', flexShrink: 0 }}>{graph.ministry}</span>
        </div>

        {/* 年度切替 */}
        <select
          value={year}
          onChange={(e) => router.push(`/subcontracts/${projectId}?year=${e.target.value}`)}
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12, background: '#fff' }}
        >
          <option value={2024}>2024年度</option>
          <option value={2025}>2025年度</option>
        </select>

        <button
          onClick={resetViewport}
          style={{ padding: '4px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12, background: '#fff', cursor: 'pointer' }}
        >
          全体表示
        </button>
      </div>

      {/* 資金ルート要約 */}
      <div style={{ padding: '7px 16px', background: '#fafafa', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>資金ルート</div>
        <div style={{ fontSize: 12, color: '#374151', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {flowSummary}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: '#475569' }}>
          <span>予算 <strong style={{ color: '#111827' }}>{graph.budget > 0 ? formatYen(graph.budget) : '—'}</strong></span>
          <span>執行 <strong style={{ color: '#111827' }}>{graph.execution > 0 ? formatYen(graph.execution) : '—'}</strong></span>
          <span style={{ padding: '3px 7px', borderRadius: 999, background: '#f3f4f6' }}>最大{graph.maxDepth}層</span>
          <span style={{ padding: '3px 7px', borderRadius: 999, background: '#f9dddd', color: COLOR_DIRECT_BODY_SUBTLE }}>直接 {directBlocks}件</span>
          <span style={{ padding: '3px 7px', borderRadius: 999, background: '#fbe3d7', color: '#b45309' }}>再委託 {redelegatedBlocks}件</span>
          <span style={{ padding: '3px 7px', borderRadius: 999, background: '#f5f5f5' }}>表示内訳 {graph.totalRecipientCount.toLocaleString()}件</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_DIRECT, display: 'inline-block' }} />
            直接
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_SUBCONTRACT, display: 'inline-block' }} />
            再委託
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      {/* SVGキャンバス */}
      <div ref={containerRef} style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
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
              const edgeColor = target?.isDirect ? COLOR_DIRECT_EDGE : COLOR_SUBCONTRACT_EDGE;
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
                    strokeWidth={2.5}
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
              onClick={() => setSelectedBlock(null)}
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
              const nodeColor = lb.isDirect ? COLOR_DIRECT : COLOR_SUBCONTRACT;
              const bodyFill = lb.isDirect ? COLOR_DIRECT_BODY : COLOR_SUBCONTRACT_BODY;
              const bodyTextColor = lb.isDirect ? COLOR_DIRECT_BODY_TEXT : COLOR_SUBCONTRACT_BODY_TEXT;
              const bodySubtleTextColor = lb.isDirect ? COLOR_DIRECT_BODY_SUBTLE : COLOR_SUBCONTRACT_BODY_SUBTLE;
              const recipients = lb.node.recipients;
              const topRecipients = sortRecipients(recipients, 'amount-desc').slice(0, 3);
              const clipIdBase = `subcontract-node-${String(lb.blockId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
              const selectedStroke = lb.isDirect ? '#991b1b' : '#9a3412';
              const roleLine = lb.node.role ? truncateChars(lb.node.role, 24) : '';

              return (
                <g
                  key={lb.blockId}
                  onClick={() => setSelectedBlock(lb.node)}
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
                      {lb.isDirect ? '直接支出' : '再委託'} / ブロック {lb.blockId}
                    </text>
                    <text x={lb.x + NODE_PAD} y={lb.y + 34}
                      fontSize={12} fontWeight={700} fill="#fff" style={{ userSelect: 'none' }}>
                      {truncateChars(lb.blockName, 18)}
                    </text>
                  </g>

                  <g clipPath={`url(#${clipIdBase}-card)`} style={{ pointerEvents: 'none' }}>
                    <text x={lb.x + NODE_PAD} y={lb.y + CARD_HEADER_H + 18}
                      fontSize={11} fontWeight={700} fill={bodyTextColor} style={{ userSelect: 'none' }}>
                      {formatYen(lb.totalAmount)} / 支出先 {recipients.length.toLocaleString()}件
                    </text>
                    {roleLine && (
                      <text x={lb.x + NODE_PAD} y={lb.y + CARD_HEADER_H + 35}
                        fontSize={9} fontWeight={600} fill={bodySubtleTextColor} style={{ userSelect: 'none' }}>
                        {roleLine}
                      </text>
                    )}
                    {topRecipients.map((r, i) => (
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
            const headerColor = isRoot ? COLOR_ROOT : (lb!.isDirect ? COLOR_DIRECT : COLOR_SUBCONTRACT);
            const bodyColor = isRoot ? COLOR_CONTEXT_BODY : (lb!.isDirect ? COLOR_DIRECT_BODY : COLOR_SUBCONTRACT_BODY);
            const textColor = isRoot ? COLOR_CONTEXT_BODY_TEXT : (lb!.isDirect ? COLOR_DIRECT_BODY_TEXT : COLOR_SUBCONTRACT_BODY_TEXT);
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
                      : `${lb!.isDirect ? '直接支出' : '再委託'} / ブロック ${lb!.blockId}`}
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

        {/* 詳細ペイン */}
        <BlockDetailPane
          block={selectedBlock}
          graph={graph}
          projectDetail={projectDetail}
          orgChain={visibleOrgChain}
          onClose={() => setSelectedBlock(null)}
          onSelectBlock={(block) => setSelectedBlock(block)}
        />
      </div>
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
