'use client';

/**
 * 項単位「項→目→RS事業→支出先」サンキーの描画（自前SVG）。
 *
 * `/mof-sankey`（`client/components/mof-section-rs-sankey/SankeyChart.tsx`）と同じ
 * 自前SVG・パン/ズーム・左サイドパネルの作りを、列数の少ないこの図に合わせて簡略化した
 * もの。検索・フィルタ・ミニマップは持たない（設計で対象外とした）。
 * 配置計算は `app/lib/mof-sankey-layout.ts` を共有する。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { computeMOFSankeyLayout, mofRibbonPath } from '@/app/lib/mof-sankey-layout';
import { MOF_KOU_SANKEY_COLUMN_INDEX, MOF_KOU_SANKEY_LAYOUT, mofKouSankeyNodeColor } from '@/app/lib/mof-kou-sankey-constants';
import { koumokuAncestorsOfRsStatus, recipientBreakdown, relatedNodeIds, rsStatusAncestorOfRecipient, rsStatusBreakdown } from '@/app/lib/mof-kou-sankey-focus';
import { MOF_KOU_SANKEY_COLUMN_LABELS, type MOFKouSankeyColumn, type MOFKouSankeyNode } from '@/types/mof-kou-sankey';
import type { SankeyLink } from '@/types/sankey';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import { SidePanelChrome } from '@/client/components/SidePanelChrome';
import { useSidePanel } from '@/client/hooks/useSidePanel';
import { E2E_TEST_IDS_ENABLED, testId } from '@/client/lib/testId';

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.2;
const LABEL_FONT_PX = 11;
const labelSlot = LABEL_FONT_PX + 2;

function shorten(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function SankeyChart({
  nodes,
  links,
  browseNodes,
  browseLinks,
  selectedId,
  onSelect,
  rsYear,
}: {
  /** 図の描画用（TopNで絞ってある） */
  nodes: MOFKouSankeyNode[];
  links: SankeyLink[];
  /** サイドパネル用の全ノード（TopNで絞る前） */
  browseNodes: MOFKouSankeyNode[];
  browseLinks: SankeyLink[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** RS事業一覧の /sankey-svg リンクに使う（RS紐づけデータの対象年度）。無い年度は null */
  rsYear: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1400, height: 800 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const dragged = useRef(false);
  const width = Math.max(viewport.width, 1100);

  const sidePanel = useSidePanel({ side: 'left', viewportWidth: viewport.width });
  const panelOpenWidth = selectedId !== null && !sidePanel.collapsed ? sidePanel.effectiveWidth : 0;

  const related = useMemo(() => (selectedId ? relatedNodeIds(links, selectedId) : null), [selectedId, links]);

  const layout = useMemo(
    () =>
      computeMOFSankeyLayout(
        { nodes, links },
        {
          width,
          height: viewport.height * zoom,
          ...MOF_KOU_SANKEY_LAYOUT,
          minNodeSlot: labelSlot,
          columnOf: node => MOF_KOU_SANKEY_COLUMN_INDEX[node.type as MOFKouSankeyColumn] ?? undefined,
        }
      ),
    [nodes, links, width, viewport.height, zoom]
  );

  const zoomAt = useCallback((factor: number) => {
    setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)));
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    },
    [zoomAt]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-pan-disabled]')) return;
      dragged.current = false;
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      setIsPanning(true);
    },
    [pan]
  );
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panStart.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged.current = true;
    setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
  }, []);
  const onPointerUp = useCallback(() => {
    panStart.current = null;
    setIsPanning(false);
  }, []);

  const selectedNode = useMemo(() => layout.nodes.find(n => n.id === selectedId) ?? null, [layout.nodes, selectedId]);
  const selectedPanelNode = useMemo(
    () => selectedNode ?? browseNodes.find(n => n.id === selectedId) ?? null,
    [selectedNode, browseNodes, selectedId]
  );
  const selectedDetails = selectedPanelNode?.details as MOFKouSankeyNode['details'] | undefined;

  /** タブ列（列名, ノード一覧）を選択ノードの列に応じて組み立てる */
  const tabColumns = useMemo((): Array<{ column: MOFKouSankeyColumn; items: MOFKouSankeyNode[] }> => {
    if (!selectedId || !selectedDetails) return [];
    const allKoumokuIds = browseNodes.filter(n => n.details.column === 'koumoku').map(n => n.id);
    switch (selectedDetails.column) {
      case 'section': {
        const koumoku = browseNodes.filter(n => n.details.column === 'koumoku').sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
        const rsStatus = rsStatusBreakdown(browseNodes, browseLinks, allKoumokuIds);
        const recipient = recipientBreakdown(browseNodes, browseLinks, rsStatus.map(n => n.id));
        return [
          { column: 'koumoku', items: koumoku },
          { column: 'rsStatus', items: rsStatus },
          { column: 'recipient', items: recipient },
        ];
      }
      case 'koumoku': {
        const rsStatus = rsStatusBreakdown(browseNodes, browseLinks, [selectedId]);
        const recipient = recipientBreakdown(browseNodes, browseLinks, rsStatus.map(n => n.id));
        return [
          { column: 'rsStatus', items: rsStatus },
          { column: 'recipient', items: recipient },
        ];
      }
      case 'rsStatus': {
        const koumoku = koumokuAncestorsOfRsStatus(browseNodes, browseLinks, selectedId);
        const recipient = recipientBreakdown(browseNodes, browseLinks, [selectedId]);
        return [
          { column: 'koumoku', items: koumoku },
          { column: 'recipient', items: recipient },
        ];
      }
      case 'recipient': {
        const rsStatus = rsStatusAncestorOfRecipient(browseNodes, browseLinks, selectedId);
        return rsStatus ? [{ column: 'rsStatus', items: [rsStatus] }] : [];
      }
      default:
        return [];
    }
  }, [selectedId, selectedDetails, browseNodes, browseLinks]);

  const tabs = useMemo(
    () => tabColumns.map(t => ({ id: t.column as string, label: MOF_KOU_SANKEY_COLUMN_LABELS[t.column], count: t.items.length })),
    [tabColumns]
  );
  const [panelTab, setPanelTab] = useState<string | null>(null);
  const activeTab = tabs.some(t => t.id === panelTab) ? panelTab : (tabs[0]?.id ?? null);
  useEffect(() => setPanelTab(null), [selectedId]);

  const rsSvgUrlFor = useCallback(
    (node: { name?: string; details?: MOFKouSankeyNode['details'] }) =>
      node.details?.column === 'rsStatus' && node.details.projectId !== undefined && rsYear !== null
        ? sankeySvgProjectUrl(node.details.projectId, node.name ?? '', rsYear)
        : null,
    [rsYear]
  );

  return (
    <div ref={containerRef} className="relative h-full w-full select-none overflow-hidden bg-card">
      <svg
        data-testid={testId('mof-kou-sankey-canvas')}
        width="100%"
        height="100%"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
        onClick={() => onSelect(null)}
      >
        <g transform={`translate(${panelOpenWidth + pan.x},${pan.y})`}>
          {layout.links.map((link, i) => {
            const dim = related !== null && !(related.has(link.source.id) && related.has(link.target.id));
            return (
              <path
                key={`${link.source.id}-${link.target.id}-${i}`}
                data-testid={testId('mof-kou-sankey-link')}
                d={mofRibbonPath(link)}
                fill={mofKouSankeyNodeColor(link.source.details as { column?: MOFKouSankeyColumn; aggregated?: boolean })}
                opacity={dim ? 0.06 : 0.28}
              />
            );
          })}
          {layout.nodes.map(node => {
            const details = node.details as MOFKouSankeyNode['details'] | undefined;
            const color = mofKouSankeyNodeColor({ column: details?.column, aggregated: details?.aggregated });
            const dim = related !== null && !related.has(node.id);
            const isSelected = selectedId === node.id;
            const showLabel = node.height >= labelSlot || E2E_TEST_IDS_ENABLED;
            const labelLeft = node.column === 0;
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                data-testid={testId('mof-kou-sankey-node')}
                data-pan-disabled="true"
                onKeyDown={e => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  onSelect(selectedId === node.id ? null : node.id);
                }}
                onClick={e => {
                  if (dragged.current) return;
                  e.stopPropagation();
                  onSelect(selectedId === node.id ? null : node.id);
                }}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={2}
                  fill={color}
                  opacity={dim ? 0.25 : 1}
                  stroke={isSelected ? '#1f2937' : undefined}
                  strokeWidth={isSelected ? 1.5 : undefined}
                />
                {showLabel && (
                  <text
                    x={labelLeft ? node.x - 6 : node.x + node.width + 6}
                    y={node.y + node.height / 2}
                    textAnchor={labelLeft ? 'end' : 'start'}
                    dominantBaseline="middle"
                    fontSize={LABEL_FONT_PX}
                    fontWeight={isSelected ? 700 : details?.aggregated ? 400 : 500}
                    fill={details?.aggregated ? '#6b7280' : '#1f2937'}
                    stroke="#ffffff"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {shorten(node.name, 26)}（{formatBudgetFromYen(node.value)}）
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div data-pan-disabled="true" className="absolute right-3 top-3 z-30 flex flex-col gap-1 rounded-lg border border-mirai-border bg-card p-1 shadow-xs">
        <Button
          variant="ghost"
          size="icon-sm"
          title="拡大"
          aria-label="拡大"
          onClick={() => zoomAt(ZOOM_STEP)}
          className="rounded text-mirai-text-subtle hover:bg-mirai-surface"
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="縮小"
          aria-label="縮小"
          onClick={() => zoomAt(1 / ZOOM_STEP)}
          className="rounded text-mirai-text-subtle hover:bg-mirai-surface"
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="表示をリセット"
          aria-label="表示をリセット"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="rounded text-mirai-text-subtle hover:bg-mirai-surface"
        >
          <Maximize className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {selectedId !== null && (
        <SidePanelChrome
          side="left"
          open={!sidePanel.collapsed}
          onToggle={sidePanel.toggleCollapsed}
          width={sidePanel.effectiveWidth}
          minWidth={200}
          maxWidth={800}
          onResizeStart={sidePanel.onResizeStart}
          isResizing={sidePanel.isResizing}
          onResetWidth={sidePanel.resetWidth}
          testId={testId('mof-kou-sankey-side-panel')}
        >
          {selectedPanelNode && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex-shrink-0 border-b border-border p-4 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-all text-sm font-semibold text-mirai-text">{selectedPanelNode.name}</div>
                    <div className="mt-0.5 text-lg font-bold text-mirai-text">{formatBudgetFromYen(selectedPanelNode.value ?? 0)}</div>
                    <div className="text-[11px] text-mirai-text-muted">{Math.round(selectedPanelNode.value ?? 0).toLocaleString()}円</div>
                    {!selectedNode && (
                      <div className="mt-1 text-[11px] text-amber-600">表示数の上限から溢れているため図には出ていません</div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="選択を解除"
                    aria-label="選択を解除"
                    onClick={() => onSelect(null)}
                    className="shrink-0 text-mirai-text-muted hover:bg-mirai-surface hover:text-mirai-text-subtle"
                  >
                    ×
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {selectedDetails?.column && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                      style={{ backgroundColor: mofKouSankeyNodeColor({ column: selectedDetails.column, aggregated: false }) }}
                    >
                      {MOF_KOU_SANKEY_COLUMN_LABELS[selectedDetails.column]}
                    </span>
                  )}
                  {selectedDetails?.aggregated && (
                    <span className="rounded-full bg-mirai-border-light px-2 py-0.5 text-[11px] font-medium text-white">集約</span>
                  )}
                  {selectedPanelNode && rsSvgUrlFor(selectedPanelNode) && (
                    <a
                      href={rsSvgUrlFor(selectedPanelNode) ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-primary underline hover:text-primary-accent"
                    >
                      /sankey-svgで開く
                    </a>
                  )}
                </div>
              </div>

              {selectedDetails?.aggregatedTop && selectedDetails.aggregatedTop.length > 0 && (
                <div className="flex-shrink-0 overflow-y-auto p-4 pb-0" style={{ maxHeight: '30%' }}>
                  <div className="text-xs text-mirai-text-subtle">表示数から溢れた {selectedDetails.aggregatedCount?.toLocaleString()} 件</div>
                  <div className="mt-2 border-t border-border pt-2">
                    <div className="mb-1 text-[11px] text-mirai-text-muted">内訳（金額の大きい順）</div>
                    {selectedDetails.aggregatedTop.map((member, index) => (
                      <div key={`${index}-${member.name}`} className="flex justify-between gap-3 text-xs text-mirai-text-secondary">
                        <span className="truncate">{member.name}</span>
                        <span className="shrink-0 tabular-nums text-mirai-text-muted">{formatBudgetFromYen(member.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="h-3" />
                </div>
              )}

              {tabs.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-border">
                  <div role="tablist" className="flex flex-shrink-0 border-b border-border px-2">
                    {tabs.map(({ id, label, count }) => (
                      <Button
                        key={id}
                        variant="ghost"
                        role="tab"
                        aria-selected={activeTab === id}
                        onClick={() => setPanelTab(id)}
                        className={cn(
                          'h-auto flex-1 rounded-none border-b-2 px-1 py-1.5 text-[11px] font-semibold hover:bg-transparent',
                          activeTab === id
                            ? 'border-primary text-mirai-text hover:text-mirai-text'
                            : 'border-transparent text-mirai-text-muted hover:text-mirai-text-subtle'
                        )}
                      >
                        {label}
                        <span className="ml-0.5 font-normal">({count.toLocaleString()})</span>
                      </Button>
                    ))}
                  </div>
                  <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-4 pt-1">
                    {tabColumns
                      .find(t => t.column === activeTab)
                      ?.items.map(item => {
                        const rsLink = rsSvgUrlFor(item);
                        return (
                          <div key={item.id} className="flex w-full items-baseline gap-1 border-b border-border py-1.5">
                            <Button
                              variant="ghost"
                              onClick={() => onSelect(item.id)}
                              className="flex h-auto min-w-0 flex-1 items-baseline justify-between gap-3 whitespace-normal rounded-none p-0 text-left font-normal hover:bg-mirai-surface"
                            >
                              <span className="truncate text-xs text-mirai-text-secondary">{item.name}</span>
                              <span className="shrink-0 text-[11px] tabular-nums text-mirai-text-muted">{formatBudgetFromYen(item.value ?? 0)}</span>
                            </Button>
                            {rsLink && (
                              <a
                                href={rsLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="/sankey-svgで開く"
                                onClick={e => e.stopPropagation()}
                                className="shrink-0 px-0.5 text-mirai-text-muted hover:text-primary-accent"
                              >
                                ↗
                              </a>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
        </SidePanelChrome>
      )}
    </div>
  );
}
