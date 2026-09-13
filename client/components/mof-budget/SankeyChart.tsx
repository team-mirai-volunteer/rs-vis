'use client';

/**
 * MOF 予算全体ビューのサンキー描画（自前 SVG）。
 *
 * `/sankey-svg` と同じく nivo を使わず SVG を直接組む。ラベルの左右振り分けや
 * 帯の重なり順を制御したいのに、nivo のカスタムレイヤ経由だと座標を後から
 * 拾い直す必要があり、実測で文字が衝突していたため。
 *
 * 配置計算は `app/lib/mof-sankey-layout.ts`（純粋関数）。ここは描画とホバーだけを持つ。
 */

import { useMemo, useState } from 'react';
import type { MOFBudgetNodeDetails } from '@/types/mof-budget-overview';
import type { SankeyNode, SankeyLink } from '@/types/sankey';
import {
  computeMOFSankeyLayout,
  mofRibbonPath,
  type MOFLayoutNode,
} from '@/app/lib/mof-sankey-layout';
import {
  MOF_LEGEND_LABELS,
  MOF_LEGEND_ORDER,
  MOF_SANKEY_LAYOUT,
  mofLegendColor,
  mofLinkColor,
  mofNodeColor,
  type MOFLegendKey,
} from '@/app/lib/mof-sankey-constants';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';

type InputNode = SankeyNode & { name?: string; details?: MOFBudgetNodeDetails };

/** ラベルどうしの最小間隔（px）。これを割ると文字が重なる */
const LABEL_MIN_GAP = 14;

/** ラベル欄に収まらない名前は詰める。全文はツールチップに出る */
function shorten(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function SankeyChart({
  nodes,
  links,
  width = 1500,
  height = 780,
  labelMax = 16,
}: {
  nodes: InputNode[];
  links: SankeyLink[];
  width?: number;
  height?: number;
  labelMax?: number;
}) {
  const [hovered, setHovered] = useState<MOFLayoutNode<MOFBudgetNodeDetails> | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const layout = useMemo(
    () =>
      computeMOFSankeyLayout(
        { nodes, links },
        {
          width,
          height,
          ...MOF_SANKEY_LAYOUT,
          // 会計ノードは同じ列に揃える（政府関係機関が一般会計の隣に並ぶのを防ぐ）
          alignToSameColumn: node => node.type === 'account',
        }
      ),
    [nodes, links, width, height]
  );

  /** 図に実際に出ている区分。控除対象は種別と別枠で出す */
  const legendKeys = useMemo(() => {
    const keys = new Set<MOFLegendKey>();
    for (const node of layout.nodes) {
      if (node.details?.isDeduction) keys.add('deduction');
      else if (node.details?.nodeType) keys.add(node.details.nodeType);
    }
    return MOF_LEGEND_ORDER.filter(k => keys.has(k));
  }, [layout]);

  /**
   * ラベルの縦位置。細いノードが隣り合うと文字が重なって読めないので、
   * 列ごとに上から見て最小間隔を確保する（ノード自体は動かさない）。
   */
  const labelY = useMemo(() => {
    const result = new Map<string, number>();
    const byColumn = new Map<number, typeof layout.nodes>();
    for (const node of layout.nodes) {
      const list = byColumn.get(node.column) ?? [];
      list.push(node);
      byColumn.set(node.column, list);
    }
    for (const [, list] of byColumn) {
      let prev = -Infinity;
      for (const node of [...list].sort((a, b) => a.y - b.y)) {
        const y = Math.max(node.y + node.height / 2, prev + LABEL_MIN_GAP);
        result.set(node.id, y);
        prev = y;
      }
    }
    return result;
  }, [layout]);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="財源から会計を経て使途に至る予算の流れ"
      >
        {/* 帯を先に描き、ノードを上に重ねる */}
        <g>
          {layout.links.map((link, i) => {
            const dim =
              hovered !== null &&
              hovered.id !== link.source.id &&
              hovered.id !== link.target.id;
            return (
              <path
                key={`${link.source.id}-${link.target.id}-${i}`}
                d={mofRibbonPath(link)}
                fill={mofLinkColor(link.target.details ?? {})}
                opacity={dim ? 0.08 : 0.32}
              />
            );
          })}
        </g>

        <g>
          {layout.nodes.map(node => {
            const color = mofNodeColor(node.details ?? {});
            // 最初の列は左、それ以外は右にラベルを出す。会計ノードは中間列に来るが、
            // 左に出すと流入の帯に文字が重なるので右で統一する
            const labelLeft = node.column === 0;
            const labelX = labelLeft ? node.x - 8 : node.x + node.width + 8;
            const centerY = node.y + node.height / 2;
            const textY = labelY.get(node.id) ?? centerY;
            const dim = hovered !== null && hovered.id !== node.id;
            return (
              <g
                key={node.id}
                onMouseEnter={e => {
                  setHovered(node);
                  setPointer({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={e => setPointer({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => {
                  setHovered(null);
                  setPointer(null);
                }}
                style={{ cursor: 'default' }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={2}
                  fill={color}
                  opacity={dim ? 0.35 : 1}
                />
                {/* ずらしたラベルは指し先が分かるよう引き出し線を添える */}
                {Math.abs(textY - centerY) > 2 && (
                  <line
                    x1={labelLeft ? node.x - 2 : node.x + node.width + 2}
                    y1={centerY}
                    x2={labelLeft ? node.x - 6 : node.x + node.width + 6}
                    y2={textY}
                    stroke="#cbd5e1"
                    strokeWidth={1}
                  />
                )}
                {/* 会計ノードのラベルは帯の上に重なるので、白い縁取りで浮かせる */}
                <text
                  x={labelX}
                  y={textY}
                  textAnchor={labelLeft ? 'end' : 'start'}
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={500}
                  fill="#1f2937"
                  stroke="#ffffff"
                  strokeWidth={3}
                  paintOrder="stroke"
                  opacity={dim ? 0.4 : 1}
                  pointerEvents="none"
                >
                  {shorten(node.name, labelMax)}
                  {/* 金額はノードの上ではなく名前の後ろに書く。細いノードが隣り合うと
                      上に置いた金額が隣の名前と重なって読めなくなるため */}
                  <tspan fill="#6b7280" fontWeight={400}>
                    {' '}
                    {formatBudgetFromYen(node.value)}
                  </tspan>
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* 凡例。実際に図に出ている区分だけを並べる */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        {legendKeys.map(key => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: mofLegendColor(key) }}
            />
            {MOF_LEGEND_LABELS[key]}
          </span>
        ))}
      </div>

      {hovered && pointer && (
        <div
          className="pointer-events-none fixed z-50 max-w-sm rounded border border-gray-200 bg-white px-3 py-2 shadow-lg"
          style={{ left: pointer.x + 12, top: pointer.y + 12 }}
        >
          <div className="font-semibold text-gray-900">{hovered.name}</div>
          <div className="text-lg font-bold text-gray-800">
            {formatBudgetFromYen(hovered.value)}
          </div>
          {hovered.details?.isDeduction && (
            <div className="mt-1 text-xs font-semibold text-red-600">
              純計では控除する（二重計上になる分）
            </div>
          )}
          {hovered.details?.description && (
            <div className="mt-1 text-xs text-gray-600">{hovered.details.description}</div>
          )}
          {hovered.details?.breakdown && hovered.details.breakdown.length > 0 && (
            <div className="mt-2 border-t border-gray-100 pt-1">
              {hovered.details.breakdown.slice(0, 6).map(item => (
                <div
                  key={item.name}
                  className="flex justify-between gap-3 text-xs text-gray-700"
                >
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatBudgetFromYen(item.amount)}
                  </span>
                </div>
              ))}
              {hovered.details.breakdown.length > 6 && (
                <div className="text-xs text-gray-400">
                  ほか {hovered.details.breakdown.length - 6} 件
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
