'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SubcontractGraph, BlockNode, BlockRecipient } from '@/types/subcontract';
import {
  computeSubcontractLayout,
  squarifiedTreemap,
  bezierPath,
  backEdgePath,
  selfLoopPath,
  formatYen,
  COLOR_DIRECT,
  COLOR_SUBCONTRACT,
  COLOR_ROOT,
  COLOR_EDGE,
  NODE_PAD,
  type LayoutBlock,
} from '@/app/lib/subcontract-layout';

const COLOR_BACK_EDGE = 'rgba(217,119,6,0.65)'; // amber

// ─── ブロックパネル ──────────────────────────────────────────────

function BlockPanel({ block, onClose }: { block: BlockNode; onClose: () => void }) {
  const [expandedRecipients, setExpandedRecipients] = useState<Set<number>>(new Set());

  function toggleRecipient(i: number) {
    setExpandedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0,
      width: 360,
      height: '100vh',
      background: '#fff',
      boxShadow: '4px 0 20px rgba(0,0,0,0.15)',
      overflowY: 'auto',
      zIndex: 100,
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
            background: block.isDirect ? '#dbeafe' : '#ffedd5',
            color: block.isDirect ? '#1d4ed8' : '#c2410c',
            marginBottom: 4,
          }}>
            {block.isDirect ? '直接支出' : '再委託'}
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{block.blockName}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            ブロック {block.blockId} ／ {formatYen(block.totalAmount)}
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

      {/* 支出先リスト */}
      <div style={{ padding: 12, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
          支出先 ({block.recipients.length}件)
        </div>
        {block.recipients.map((r, i) => (
          <RecipientCard
            key={i}
            recipient={r}
            index={i}
            expanded={expandedRecipients.has(i)}
            onToggle={() => toggleRecipient(i)}
          />
        ))}
        {block.recipients.length === 0 && (
          <p style={{ fontSize: 12, color: '#9ca3af' }}>支出先データなし</p>
        )}
      </div>
    </div>
  );
}

function RecipientCard({
  recipient, index, expanded, onToggle,
}: {
  recipient: BlockRecipient;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetails = recipient.contractSummaries.length > 0 || recipient.expenses.length > 0;

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
          <div style={{ color: '#6b7280', marginTop: 2 }}>{formatYen(recipient.amount)}</div>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<BlockNode | null>(null);

  // ズーム/パン
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [baseZoom, setBaseZoom] = useState(1);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const [hoveredBlock, setHoveredBlock] = useState<LayoutBlock | null>(null);
  type HoveredRecipient = { r: BlockRecipient; x: number; y: number; w: number; h: number; color: string };
  const [hoveredRecipient, setHoveredRecipient] = useState<HoveredRecipient | null>(null);
  const currentHoverKey = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedBlock(null);
    setHoveredBlock(null);
    setHoveredRecipient(null);
    currentHoverKey.current = null;
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    fetch(`/api/subcontracts/${projectId}?year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: SubcontractGraph) => {
        setGraph(data);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [projectId, year]);

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f1f5f9', overflow: 'hidden' }}>
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

        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 6 }}>PID {graph.projectId}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{graph.projectName}</span>
          <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>{graph.ministry}</span>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6b7280', flexWrap: 'wrap' }}>
          <span>予算: <strong style={{ color: '#111827' }}>{graph.budget > 0 ? formatYen(graph.budget) : '—'}</strong></span>
          <span>執行: <strong style={{ color: '#111827' }}>{graph.execution > 0 ? formatYen(graph.execution) : '—'}</strong></span>
          <span>最大{graph.maxDepth}層</span>
          <span>ブロック {graph.totalBlockCount}</span>
          <span>支出先 {graph.totalRecipientCount.toLocaleString()}</span>
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

      {/* 凡例 */}
      <div style={{ padding: '6px 16px', background: '#fff', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 16, fontSize: 11, color: '#6b7280', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: COLOR_DIRECT, display: 'inline-block' }} />
          直接支出ブロック
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: COLOR_SUBCONTRACT, display: 'inline-block' }} />
          再委託ブロック
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="28" height="10" style={{ flexShrink: 0 }}>
            <line x1="0" y1="5" x2="28" y2="5" stroke={COLOR_BACK_EDGE} strokeWidth="1.5" strokeDasharray="5 3" />
          </svg>
          参照フロー（循環）
        </span>
        <span style={{ color: '#9ca3af' }}>ブロックをクリックで詳細表示 ／ ホイールでズーム ／ ドラッグでパン</span>
      </div>

      {/* SVGキャンバス */}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
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
            {/* 矢印マーカー定義 */}
            <defs>
              <marker id="arrow-fwd" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill={COLOR_EDGE} />
              </marker>
              <marker id="arrow-back" markerWidth="6" markerHeight="6" refX="1" refY="3" orient="auto">
                <path d="M6,0 L6,6 L0,3 z" fill={COLOR_BACK_EDGE} />
              </marker>
            </defs>

            {/* 順方向エッジ */}
            {safeLayout.edges.filter(e => !e.isBackEdge).map((edge, i) => (
              <path
                key={`fwd-${i}`}
                d={bezierPath(edge.x1, edge.y1, edge.x2, edge.y2)}
                fill="none"
                stroke={COLOR_EDGE}
                strokeWidth={2}
                markerEnd="url(#arrow-fwd)"
              />
            ))}

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
                  markerEnd="url(#arrow-back)"
                />
              </g>
            ))}

            {/* エッジラベル */}
            {safeLayout.edges.map((edge, i) =>
              edge.note ? (
                <text
                  key={`note-${i}`}
                  x={edge.isSelfLoop ? edge.x1 + 44 : (edge.x1 + edge.x2) / 2}
                  y={edge.isSelfLoop ? edge.y1 : (
                    edge.isBackEdge
                      ? Math.max(edge.y1, edge.y2) + 54
                      : (edge.y1 + edge.y2) / 2 - 6
                  )}
                  textAnchor="middle"
                  fontSize={9}
                  fill={edge.isBackEdge ? '#b45309' : '#94a3b8'}
                >
                  {edge.note}
                </text>
              ) : null
            )}

            {/* 担当組織ルートノード */}
            <g>
              <rect
                x={safeLayout.root.x}
                y={safeLayout.root.y}
                width={safeLayout.root.w}
                height={safeLayout.root.h}
                rx={6}
                fill={COLOR_ROOT}
              />
              <text
                x={safeLayout.root.x + safeLayout.root.w / 2}
                y={safeLayout.root.y + safeLayout.root.h / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={600}
                fill="#fff"
              >
                {graph.ministry}
              </text>
            </g>

            {/* ブロックノード（面積図） */}
            {safeLayout.blocks.map((lb) => {
              const isAmbiguous = lb.node.recipients.length >= 2 && safeLayout.edges.some((e) => e.sourceBlock === lb.blockId);
              const nodeColor = lb.isDirect ? COLOR_DIRECT : COLOR_SUBCONTRACT;
              const recipients = lb.node.recipients;

              // ─ ヘッダーレイアウト ─
              // NODE_W=200, NODE_PAD=16 → 使用可能幅 ~168px
              // 日本語文字: 10px≈9px/char → ~18文字, 8px≈7px/char → ~24文字
              const H_TOP = 5;
              const H_LINE1 = 13; // 10px bold
              const H_LINE2 = 11; // 9px
              const H_LINE3 = 11; // 8px (役割行1)
              const H_LINE4 = 10; // 8px (役割行2)
              const H_BOT = 4;

              const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s;

              // 行1: ブロック番号 ブロック名
              const line1 = `${lb.blockId} ${lb.blockName}`;
              const line1Disp = trunc(line1, 18);

              // 行2: 支出先N社　金額
              const line2 = `支出先 ${recipients.length}社　${formatYen(lb.totalAmount)}`;

              // 行3-4: 役割（最大2行、各24文字）
              const roleLines: string[] = [];
              if (lb.node.role) {
                const R = 21; // (NODE_W - NODE_PAD * 2) / ~8px per char
                const role = lb.node.role;
                if (role.length <= R) {
                  roleLines.push(role);
                } else if (role.length <= R * 2) {
                  roleLines.push(role.slice(0, R));
                  roleLines.push(role.slice(R));
                } else {
                  roleLines.push(role.slice(0, R));
                  roleLines.push(role.slice(R, R * 2 - 1) + '…');
                }
              }

              const HEADER_H = H_TOP + H_LINE1 + H_LINE2 + (roleLines.length >= 1 ? H_LINE3 : 0) + (roleLines.length >= 2 ? H_LINE4 : 0) + H_BOT;


              // squarified treemap で支出先を面積比例配置
              const bodyH2 = lb.h - HEADER_H;
              const treemapItems = recipients.map(r => ({ key: r.name + '|' + r.corporateNumber, value: r.amount }));
              const treemapRect = { x: lb.x + 1, y: lb.y + HEADER_H, w: lb.w - 2, h: bodyH2 };
              const treemapResults = bodyH2 > 0 ? squarifiedTreemap(treemapItems, treemapRect) : [];
              const recipientByKey = new Map(recipients.map(r => [r.name + '|' + r.corporateNumber, r]));

              return (
                <g
                  key={lb.blockId}
                  onClick={() => setSelectedBlock(lb.node)}
                  onMouseOver={(e) => {
                    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
                    const rKey = (e.target as SVGElement).getAttribute('data-rkey');
                    if (rKey) {
                      if (currentHoverKey.current === rKey) return;
                      currentHoverKey.current = rKey;
                      const r = recipientByKey.get(rKey);
                      const tr = treemapResults.find(t => t.key === rKey);
                      if (r && tr) {
                        setHoveredBlock(null);
                        setHoveredRecipient({ r, x: tr.rect.x, y: tr.rect.y, w: tr.rect.w, h: tr.rect.h, color: nodeColor });
                      }
                    } else {
                      const bKey = `b:${lb.blockId}`;
                      if (currentHoverKey.current === bKey) return;
                      currentHoverKey.current = bKey;
                      setHoveredRecipient(null);
                      setHoveredBlock(lb);
                    }
                  }}
                  onMouseOut={(e) => {
                    const related = e.relatedTarget as Node | null;
                    if (related && (e.currentTarget as SVGGElement).contains(related)) return;
                    currentHoverKey.current = null;
                    hoverTimerRef.current = setTimeout(() => { setHoveredBlock(null); setHoveredRecipient(null); }, 120);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {/* 外枠 */}
                  <rect
                    x={lb.x}
                    y={lb.y}
                    width={lb.w}
                    height={lb.h}
                    rx={5}
                    fill="rgba(255,255,255,0.08)"
                    stroke={isAmbiguous ? '#dc2626' : nodeColor}
                    strokeWidth={isAmbiguous ? 1.5 : 1.5}
                    strokeDasharray={isAmbiguous ? '4 2' : undefined}
                  />

                  {/* ヘッダー背景 */}
                  <rect
                    x={lb.x}
                    y={lb.y}
                    width={lb.w}
                    height={HEADER_H}
                    rx={5}
                    fill={nodeColor}
                    style={{ pointerEvents: 'none' }}
                  />
                  <rect
                    x={lb.x}
                    y={lb.y + HEADER_H - 5}
                    width={lb.w}
                    height={5}
                    fill={nodeColor}
                    style={{ pointerEvents: 'none' }}
                  />

                  {/* ヘッダーテキスト */}
                  <g style={{ pointerEvents: 'none' }}>
                    {/* 行1: ブロック番号 ブロック名 */}
                    <text x={lb.x + NODE_PAD} y={lb.y + H_TOP + H_LINE1 - 1}
                      fontSize={10} fontWeight={700} fill="#fff" style={{ userSelect: 'none' }}>
                      {line1Disp}
                    </text>
                    {/* 行2: 支出先数　金額 */}
                    <text x={lb.x + NODE_PAD} y={lb.y + H_TOP + H_LINE1 + H_LINE2 - 1}
                      fontSize={9} fill="rgba(255,255,255,0.88)" style={{ userSelect: 'none' }}>
                      {line2}
                    </text>
                    {/* 行3-4: 役割 */}
                    {roleLines[0] && (
                      <text x={lb.x + NODE_PAD} y={lb.y + H_TOP + H_LINE1 + H_LINE2 + H_LINE3 - 1}
                        fontSize={8} fill="rgba(255,255,255,0.72)" style={{ userSelect: 'none' }}>
                        {roleLines[0]}
                      </text>
                    )}
                    {roleLines[1] && (
                      <text x={lb.x + NODE_PAD} y={lb.y + H_TOP + H_LINE1 + H_LINE2 + H_LINE3 + H_LINE4 - 1}
                        fontSize={8} fill="rgba(255,255,255,0.72)" style={{ userSelect: 'none' }}>
                        {roleLines[1]}
                      </text>
                    )}
                  </g>

                  {/* 支出先 squarified treemap */}
                  {treemapResults.map((tr) => {
                    const r = recipientByKey.get(tr.key);
                    if (!r || tr.rect.w < 1 || tr.rect.h < 1) return null;
                    const showName = tr.rect.h >= 14 && tr.rect.w >= 20;
                    const showAmount = tr.rect.h >= 24 && tr.rect.w >= 30 && r.amount > 0;
                    return (
                      <g key={tr.key} style={{ pointerEvents: 'none' }}>
                        <rect
                          data-rkey={tr.key}
                          x={tr.rect.x}
                          y={tr.rect.y}
                          width={tr.rect.w}
                          height={tr.rect.h}
                          fill={nodeColor}
                          fillOpacity={0.55}
                          stroke="rgba(255,255,255,0.3)"
                          strokeWidth={0.5}
                          style={{ pointerEvents: 'all' }}
                        />
                        {showName && (
                          <text
                            x={tr.rect.x + 4}
                            y={tr.rect.y + (showAmount ? tr.rect.h / 2 - 4 : tr.rect.h / 2)}
                            fontSize={9}
                            fill="rgba(255,255,255,0.95)"
                            dominantBaseline="middle"
                            style={{ userSelect: 'none' }}
                          >
                            {(() => {
                              const maxChars = Math.floor((tr.rect.w - 8) / 6);
                              return r.name.length > maxChars ? r.name.slice(0, Math.max(1, maxChars)) + '…' : r.name;
                            })()}
                          </text>
                        )}
                        {showAmount && (
                          <text
                            x={tr.rect.x + tr.rect.w - 4}
                            y={tr.rect.y + tr.rect.h / 2 + 6}
                            fontSize={8}
                            fill="rgba(255,255,255,0.75)"
                            textAnchor="end"
                            dominantBaseline="middle"
                            style={{ userSelect: 'none' }}
                          >
                            {formatYen(r.amount)}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* 委託元不特定バッジ */}
                  {isAmbiguous && (
                    <text
                      x={lb.x + lb.w - NODE_PAD}
                      y={lb.y + lb.h - 4}
                      textAnchor="end"
                      fontSize={8}
                      fill="#fca5a5"
                      style={{ pointerEvents: 'none' }}
                    >
                      委託元不特定
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* ブロックホバーポップアップ（screen座標で配置） */}
          {hoveredBlock && (() => {
            const lb = hoveredBlock;
            const nodeColor = lb.isDirect ? COLOR_DIRECT : COLOR_SUBCONTRACT;
            const TIP_W = 230;
            const screenLeft = transform.x + lb.x * transform.scale;
            const screenTop  = transform.y + lb.y * transform.scale;
            const blockScreenW = lb.w * transform.scale;
            const tipX = Math.max(4, screenLeft + blockScreenW / 2 - TIP_W / 2);
            const tipY = screenTop - 8;
            return (
              <foreignObject x={tipX} y={tipY} width={TIP_W} height={1} overflow="visible" style={{ pointerEvents: 'none' }}>
                <div style={{
                  background: nodeColor,
                  opacity: 0.95,
                  borderRadius: 6,
                  padding: '6px 10px',
                  color: '#fff',
                  fontSize: 11,
                  lineHeight: 1.45,
                  border: '1.5px solid rgba(255,255,255,0.55)',
                  boxShadow: '0 3px 10px rgba(0,0,0,0.22)',
                  transform: 'translateY(-100%)',
                  wordBreak: 'break-all',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{lb.blockId} {lb.blockName}</div>
                  <div style={{ opacity: 0.88 }}>支出先 {lb.node.recipients.length}社　{formatYen(lb.totalAmount)}</div>
                  {lb.node.role && <div style={{ opacity: 0.78, marginTop: 3, fontSize: 10 }}>{lb.node.role}</div>}
                </div>
              </foreignObject>
            );
          })()}

          {/* 支出先ホバーポップアップ */}
          {hoveredRecipient && (() => {
            const { r, x, y, w, color } = hoveredRecipient;
            const TIP_W = 240;
            const screenLeft = transform.x + x * transform.scale;
            const screenTop  = transform.y + y * transform.scale;
            const rectScreenW = w * transform.scale;
            const tipX = Math.max(4, screenLeft + rectScreenW / 2 - TIP_W / 2);
            const tipY = screenTop - 8;
            return (
              <foreignObject x={tipX} y={tipY} width={TIP_W} height={1} overflow="visible" style={{ pointerEvents: 'none' }}>
                <div style={{
                  background: color,
                  opacity: 0.95,
                  borderRadius: 6,
                  padding: '6px 10px',
                  color: '#fff',
                  fontSize: 11,
                  lineHeight: 1.45,
                  border: '1.5px solid rgba(255,255,255,0.55)',
                  boxShadow: '0 3px 10px rgba(0,0,0,0.22)',
                  transform: 'translateY(-100%)',
                  wordBreak: 'break-all',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{r.name || '（氏名なし）'}</div>
                  <div style={{ opacity: 0.88 }}>{r.amount > 0 ? formatYen(r.amount) : '金額なし'}</div>
                  {r.corporateNumber && (
                    <div style={{ opacity: 0.7, fontSize: 10, marginTop: 2 }}>法人番号: {r.corporateNumber}</div>
                  )}
                  {r.contractSummaries.slice(0, 2).map((cs, i) => (
                    <div key={i} style={{ opacity: 0.78, fontSize: 10, marginTop: 2 }}>{cs}</div>
                  ))}
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

        {/* 詳細パネル */}
        {selectedBlock && (
          <BlockPanel block={selectedBlock} onClose={() => setSelectedBlock(null)} />
        )}
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
