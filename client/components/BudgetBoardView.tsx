'use client';

import { useMemo, useState, useCallback, type CSSProperties } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  Position,
  MarkerType,
  type NodeTypes,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TreemapMinistry, ChipCategory } from '@/app/api/map/treemap/route';
import type { CircuitData } from '@/app/api/map/circuit/route';

// ============================================================
// Color palette & chip category config
// ============================================================

const C = {
  board: '#0d1117',
  copper: '#c9a84c',
  silk: '#e2e8f0',
  silkDim: 'rgba(226,232,240,0.35)',
  mask: '#1a472a',
  maskDark: '#0f2d1a',
  pad: '#d4a843',
  grid: '#1e3a28',
  gridLine: '#1a2332',
  fanIn: '#f59e0b',
  fanOut: '#3b82f6',
  direct: '#22c55e',
  indirect: '#8b5cf6',
  power: '#ef4444',
};

// Chip categories: 支出タイプ → 電子部品
const CHIP_META: Record<ChipCategory, { label: string; short: string; color: string; refPrefix: string; desc: string }> = {
  regulator: { label: '電圧レギュレータ', short: 'REG', color: '#ef4444', refPrefix: 'VR', desc: '補助金・交付' },
  processor: { label: 'プロセッサ', short: 'MCU', color: '#3b82f6', refPrefix: 'U', desc: '競争契約' },
  capacitor: { label: 'コンデンサ', short: 'CAP', color: '#a78bfa', refPrefix: 'C', desc: '随意契約' },
  memory:    { label: 'メモリIC', short: 'MEM', color: '#f59e0b', refPrefix: 'M', desc: '国庫債務' },
  resistor:  { label: '抵抗', short: 'RES', color: '#6b7280', refPrefix: 'R', desc: 'その他' },
};

// Scale factor from 実質支出額: 1億 = 1.0, clamped to [1, 3]
function chipScaleFromSpending(spending: number): number {
  if (spending <= 1e8) return 1;
  return Math.max(1, Math.min(3, Math.sqrt(spending / 1e8)));
}

function fmt(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}兆`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}億`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
  return `${v}`;
}

// ============================================================
// Shared: SMD Pad
// ============================================================

function SmdPad({ side, pos, total }: { side: 'left' | 'right' | 'top' | 'bottom'; pos: number; total: number }) {
  const pct = `${((pos + 1) / (total + 1)) * 100}%`;
  const s: CSSProperties = { position: 'absolute', background: C.pad, borderRadius: 1 };

  if (side === 'left' || side === 'right') {
    Object.assign(s, { width: 7, height: 3, top: pct, transform: 'translateY(-50%)' });
    if (side === 'left') s.left = -4; else s.right = -4;
  } else {
    Object.assign(s, { width: 3, height: 7, left: pct, transform: 'translateX(-50%)' });
    if (side === 'top') s.top = -4; else s.bottom = -4;
  }
  return <div style={s} />;
}

// ============================================================
// Node: Ministry QFP chip
// ============================================================

interface MinistryData { label: string; desig: string; budget: number; spending: number; projectCount: number; accountMix: string; pinCount: number; [k: string]: unknown }

function MinistryChipNode({ data }: { data: MinistryData }) {
  const pins = Math.ceil(data.pinCount / 4);
  const size = Math.max(90, 60 + pins * 10);
  const accent = data.accountMix === 'special' ? C.fanIn : data.accountMix === 'mixed' ? C.indirect : C.direct;

  return (
    <div className="relative" style={{ width: size + 16, height: size + 16 }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} id="top" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />

      {/* Silkscreen outline */}
      <div style={{ position: 'absolute', inset: 5, border: `1.5px solid ${C.silkDim}`, borderRadius: 1 }} />
      {/* Pin-1 notch */}
      <div style={{ position: 'absolute', top: 3, left: 12, width: 8, height: 4, borderBottom: `1.5px solid ${C.silkDim}`, borderRadius: '0 0 50% 50%' }} />

      {/* Pads */}
      {[...Array(pins)].map((_, i) => <SmdPad key={`l${i}`} side="left" pos={i} total={pins} />)}
      {[...Array(pins)].map((_, i) => <SmdPad key={`r${i}`} side="right" pos={i} total={pins} />)}
      {[...Array(pins)].map((_, i) => <SmdPad key={`t${i}`} side="top" pos={i} total={pins} />)}
      {[...Array(pins)].map((_, i) => <SmdPad key={`b${i}`} side="bottom" pos={i} total={pins} />)}

      {/* Body */}
      <div style={{
        position: 'absolute', inset: 11,
        background: C.maskDark, border: `1px solid ${C.mask}`, borderRadius: 2,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '4px 6px', overflow: 'hidden',
      }}>
        <div style={{ fontSize: 7, fontFamily: 'monospace', color: C.silkDim, letterSpacing: 1 }}>{data.desig}</div>
        <div style={{ fontSize: Math.min(11, 9 + size / 50), fontWeight: 'bold', color: C.silk, textAlign: 'center', lineHeight: 1.2, maxWidth: size - 28, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
          {data.label}
        </div>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: accent, marginTop: 2 }}>{fmt(data.budget)}</div>
        <div style={{ fontSize: 7, fontFamily: 'monospace', color: C.silkDim }}>{data.projectCount}事業</div>
      </div>
    </div>
  );
}

// ============================================================
// Node: Project chip — shape by chipCategory
// ============================================================

interface ProjData {
  label: string; desig: string; projectId: number; budget: number; spending: number;
  qualityScore: number | null; bureau: string; blockCount: number;
  recipientCount: number; chipCategory: ChipCategory; hasRedelegation: boolean;
  chipScale: number;
  onClickProject?: (pid: number) => void; [k: string]: unknown;
}

// Regulator: TO-220 style (3 heatsink pins top, 3 leads bottom)
function RegulatorNode({ data }: { data: ProjData }) {
  const meta = CHIP_META.regulator;
  const sc = data.chipScale ?? 1;
  const W = 90, H = 52;
  return (
    <div className="relative cursor-pointer group" onClick={() => data.onClickProject?.(data.projectId)}
      style={{ width: W * sc, height: H * sc }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div style={{ transform: `scale(${sc})`, transformOrigin: 'top left', width: W, height: H, position: 'absolute', top: 0, left: 0 }}>
        {/* Heatsink tab */}
        <div style={{ position: 'absolute', top: -4, left: 8, right: 8, height: 6, background: '#71717a', borderRadius: '3px 3px 0 0', border: '1px solid #52525b' }}>
          {[...Array(4)].map((_, i) => <div key={i} style={{ position: 'absolute', top: 0, left: 6 + i * 18, width: 8, height: 6, background: '#a1a1aa', borderRadius: '2px 2px 0 0' }} />)}
        </div>
        {/* 3 leads */}
        {[0, 1, 2].map(i => <div key={i} style={{ position: 'absolute', bottom: -5, left: 15 + i * 24, width: 5, height: 7, background: C.pad, borderRadius: '0 0 1px 1px' }} />)}
        {/* Body */}
        <div className="group-hover:brightness-150 transition-all" style={{
          position: 'absolute', inset: '3px 2px 4px 2px',
          background: `linear-gradient(180deg, #1c1917, ${C.maskDark})`, border: `1.5px solid ${meta.color}50`,
          borderRadius: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1px 4px',
        }}>
          <div style={{ fontSize: 6, fontFamily: 'monospace', color: meta.color }}>{data.desig} {meta.short}</div>
          <div style={{ fontSize: 8, color: C.silk, textAlign: 'center', lineHeight: 1.1, maxWidth: 78, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</div>
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: meta.color }}>{fmt(data.spending > 0 ? data.spending : data.budget)}</div>
        </div>
      </div>
    </div>
  );
}

// Processor: QFP/SOIC with many pins
function ProcessorNode({ data }: { data: ProjData }) {
  const meta = CHIP_META.processor;
  const sc = data.chipScale ?? 1;
  const pins = Math.min(data.blockCount, 8);
  const pps = Math.max(2, Math.ceil(pins / 2));
  const W = 100, H = Math.max(52, 24 + pps * 12) + 8;

  return (
    <div className="relative cursor-pointer group" onClick={() => data.onClickProject?.(data.projectId)}
      style={{ width: W * sc, height: H * sc }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div style={{ transform: `scale(${sc})`, transformOrigin: 'top left', width: W, height: H, position: 'absolute', top: 0, left: 0 }}>
        {[...Array(pps)].map((_, i) => <SmdPad key={`l${i}`} side="left" pos={i} total={pps} />)}
        {[...Array(pps)].map((_, i) => <SmdPad key={`r${i}`} side="right" pos={i} total={pps} />)}
        {/* Notch */}
        <div style={{ position: 'absolute', top: 1, left: '50%', transform: 'translateX(-50%)', width: 10, height: 5, border: `1px solid ${C.silkDim}`, borderTop: 'none', borderRadius: '0 0 50% 50%' }} />
        {/* Pin-1 dot */}
        <div style={{ position: 'absolute', top: 8, left: 10, width: 3, height: 3, borderRadius: '50%', background: C.silkDim }} />
        {/* Body */}
        <div className="group-hover:brightness-150 transition-all" style={{
          position: 'absolute', inset: '2px 6px', background: `linear-gradient(135deg, #0c1e3a, ${C.maskDark})`,
          border: `1px solid ${meta.color}40`, borderRadius: 2,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3px 4px',
        }}>
          <div style={{ fontSize: 6, fontFamily: 'monospace', color: meta.color }}>{data.desig} {meta.short}</div>
          <div style={{ fontSize: 8, color: C.silk, textAlign: 'center', lineHeight: 1.1, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</div>
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: meta.color }}>{fmt(data.spending > 0 ? data.spending : data.budget)}</div>
        </div>
      </div>
    </div>
  );
}

// Capacitor: small 2-pad chip (0805 footprint style)
function CapacitorNode({ data }: { data: ProjData }) {
  const meta = CHIP_META.capacitor;
  const sc = data.chipScale ?? 1;
  const W = 74, H = 36;
  return (
    <div className="relative cursor-pointer group" onClick={() => data.onClickProject?.(data.projectId)}
      style={{ width: W * sc, height: H * sc }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div style={{ transform: `scale(${sc})`, transformOrigin: 'top left', width: W, height: H, position: 'absolute', top: 0, left: 0 }}>
        {/* 2 terminal pads */}
        <div style={{ position: 'absolute', left: -3, top: '50%', transform: 'translateY(-50%)', width: 8, height: 14, background: C.pad, borderRadius: '2px 0 0 2px' }} />
        <div style={{ position: 'absolute', right: -3, top: '50%', transform: 'translateY(-50%)', width: 8, height: 14, background: C.pad, borderRadius: '0 2px 2px 0' }} />
        {/* Body */}
        <div className="group-hover:brightness-150 transition-all" style={{
          position: 'absolute', inset: '2px 6px', background: '#1e1b2e', border: `1px solid ${meta.color}50`,
          borderRadius: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1px 2px',
        }}>
          <div style={{ fontSize: 6, fontFamily: 'monospace', color: meta.color }}>{data.desig}</div>
          <div style={{ fontSize: 7, color: C.silk, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 56 }}>{data.label}</div>
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: meta.color }}>{fmt(data.spending > 0 ? data.spending : data.budget)}</div>
        </div>
        {/* Polarity band */}
        <div style={{ position: 'absolute', left: 7, top: 3, bottom: 3, width: 2, background: `${meta.color}30` }} />
      </div>
    </div>
  );
}

// Memory: DIP style (wide body, pins both sides)
function MemoryNode({ data }: { data: ProjData }) {
  const meta = CHIP_META.memory;
  const sc = data.chipScale ?? 1;
  const pins = Math.max(2, Math.min(6, data.blockCount));
  const W = 88, H = Math.max(46, 20 + pins * 10) + 6;

  return (
    <div className="relative cursor-pointer group" onClick={() => data.onClickProject?.(data.projectId)}
      style={{ width: W * sc, height: H * sc }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div style={{ transform: `scale(${sc})`, transformOrigin: 'top left', width: W, height: H, position: 'absolute', top: 0, left: 0 }}>
        {/* DIP pins — thicker, through-hole style */}
        {[...Array(pins)].map((_, i) => {
          const y = ((i + 1) / (pins + 1)) * 100;
          return (
            <div key={`l${i}`}>
              <div style={{ position: 'absolute', left: -6, top: `${y}%`, transform: 'translateY(-50%)', width: 8, height: 3, background: C.pad, borderRadius: 1 }} />
              <div style={{ position: 'absolute', right: -6, top: `${y}%`, transform: 'translateY(-50%)', width: 8, height: 3, background: C.pad, borderRadius: 1 }} />
            </div>
          );
        })}
        {/* Notch */}
        <div style={{ position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)', width: 12, height: 6, borderBottom: `1.5px solid ${C.silkDim}`, borderRadius: '0 0 50% 50%' }} />
        {/* Body */}
        <div className="group-hover:brightness-150 transition-all" style={{
          position: 'absolute', inset: '1px 4px', background: '#1a1510', border: `1px solid ${meta.color}40`,
          borderRadius: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2px 3px',
        }}>
          <div style={{ fontSize: 6, fontFamily: 'monospace', color: meta.color }}>{data.desig} {meta.short}</div>
          <div style={{ fontSize: 8, color: C.silk, textAlign: 'center', lineHeight: 1.1, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</div>
          <div style={{ fontSize: 7, fontFamily: 'monospace', color: meta.color }}>{fmt(data.spending > 0 ? data.spending : data.budget)}</div>
        </div>
      </div>
    </div>
  );
}

// Resistor: tiny 0402 chip
function ResistorNode({ data }: { data: ProjData }) {
  const meta = CHIP_META.resistor;
  const sc = data.chipScale ?? 1;
  const W = 66, H = 30;
  return (
    <div className="relative cursor-pointer group" onClick={() => data.onClickProject?.(data.projectId)}
      style={{ width: W * sc, height: H * sc }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div style={{ transform: `scale(${sc})`, transformOrigin: 'top left', width: W, height: H, position: 'absolute', top: 0, left: 0 }}>
        {/* 2 pads */}
        <div style={{ position: 'absolute', left: -2, top: '50%', transform: 'translateY(-50%)', width: 6, height: 12, background: C.pad, borderRadius: '1px 0 0 1px' }} />
        <div style={{ position: 'absolute', right: -2, top: '50%', transform: 'translateY(-50%)', width: 6, height: 12, background: C.pad, borderRadius: '0 1px 1px 0' }} />
        {/* Body */}
        <div className="group-hover:brightness-150 transition-all" style={{
          position: 'absolute', inset: '2px 5px', background: '#1c1917', border: `1px solid ${meta.color}40`,
          borderRadius: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1px 2px',
        }}>
          <div style={{ fontSize: 6, fontFamily: 'monospace', color: meta.color }}>{data.desig}</div>
          <div style={{ fontSize: 7, color: C.silk, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 50 }}>{data.label}</div>
          <div style={{ fontSize: 6, fontFamily: 'monospace', color: meta.color }}>{fmt(data.spending > 0 ? data.spending : data.budget)}</div>
        </div>
      </div>
    </div>
  );
}

// Router
function ProjectChipNode({ data }: { data: ProjData }) {
  switch (data.chipCategory) {
    case 'regulator':  return <RegulatorNode data={data} />;
    case 'processor':  return <ProcessorNode data={data} />;
    case 'capacitor':  return <CapacitorNode data={data} />;
    case 'memory':     return <MemoryNode data={data} />;
    default:           return <ResistorNode data={data} />;
  }
}

// ============================================================
// Node: Circuit block pad
// ============================================================

interface BlockData { label: string; blockKey: string; amount: number; recipientCount: number; isDirect: boolean; isFanIn: boolean; isFanOut: boolean; [k: string]: unknown }

function BlockPadNode({ data }: { data: BlockData }) {
  const accent = data.isFanIn ? C.fanIn : data.isFanOut ? C.fanOut : data.isDirect ? C.direct : C.indirect;
  return (
    <div className="relative" style={{ width: 120, height: 56 }}>
      <Handle type="target" position={Position.Left} style={{ background: accent, width: 5, height: 5 }} />
      <Handle type="source" position={Position.Right} style={{ background: accent, width: 5, height: 5 }} />
      <div style={{ position: 'absolute', left: -5, top: '50%', transform: 'translateY(-50%)', width: 7, height: 10, background: C.pad, borderRadius: '2px 0 0 2px' }} />
      <div style={{ position: 'absolute', right: -5, top: '50%', transform: 'translateY(-50%)', width: 7, height: 10, background: C.pad, borderRadius: '0 2px 2px 0' }} />
      <div style={{ position: 'absolute', inset: 0, background: C.maskDark, border: `1.5px solid ${accent}`, borderRadius: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2px 4px' }}>
        {(data.isFanIn || data.isFanOut) && (
          <div style={{ position: 'absolute', top: -6, right: -6, width: 14, height: 14, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 'bold', color: '#fff', boxShadow: `0 0 6px ${accent}80` }}>
            {data.isFanIn ? '◆' : '◇'}
          </div>
        )}
        <div style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold', color: C.silk }}>{data.blockKey}</div>
        <div style={{ fontSize: 8, color: C.silkDim, textAlign: 'center', maxWidth: 105, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.label}</div>
        <div style={{ fontSize: 8, fontFamily: 'monospace', color: accent }}>{fmt(data.amount)}</div>
        {data.recipientCount > 0 && <div style={{ fontSize: 7, color: C.silkDim }}>{data.recipientCount}件</div>}
      </div>
    </div>
  );
}

// ============================================================
// Node: Org = Power supply
// ============================================================

interface OrgData { label: string; amount: number; [k: string]: unknown }

function OrgRegNode({ data }: { data: OrgData }) {
  return (
    <div className="relative" style={{ width: 120, height: 50 }}>
      <Handle type="source" position={Position.Right} style={{ background: C.power, width: 5, height: 5 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ background: C.power, width: 5, height: 5 }} />
      {[...Array(5)].map((_, i) => <div key={i} style={{ position: 'absolute', top: -3, left: 12 + i * 18, width: 10, height: 6, background: '#94a3b8', borderRadius: '2px 2px 0 0' }} />)}
      {[0, 1, 2].map(i => <div key={i} style={{ position: 'absolute', bottom: -5, left: 18 + i * 30, width: 5, height: 7, background: C.pad, borderRadius: '0 0 1px 1px' }} />)}
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, #1a1a2e, ${C.maskDark})`, border: `1.5px solid ${C.power}`, borderRadius: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 7, fontFamily: 'monospace', color: C.power, letterSpacing: 2 }}>VCC</div>
        <div style={{ fontSize: 10, fontWeight: 'bold', color: C.silk }}>{data.label}</div>
        <div style={{ fontSize: 8, fontFamily: 'monospace', color: C.power }}>{fmt(data.amount)}</div>
      </div>
    </div>
  );
}

// ============================================================
// Node types
// ============================================================

const nodeTypes: NodeTypes = {
  ministryChip: MinistryChipNode,
  projectChip: ProjectChipNode,
  blockPad: BlockPadNode,
  orgReg: OrgRegNode,
};

// ============================================================
// BOM Panel
// ============================================================

function BOMPanel({ projects }: { projects: { chipCategory: ChipCategory; budget: number }[] }) {
  const bom = useMemo(() => {
    const counts: Record<ChipCategory, { count: number; totalBudget: number }> = {
      regulator: { count: 0, totalBudget: 0 },
      processor: { count: 0, totalBudget: 0 },
      capacitor: { count: 0, totalBudget: 0 },
      memory: { count: 0, totalBudget: 0 },
      resistor: { count: 0, totalBudget: 0 },
    };
    for (const p of projects) {
      counts[p.chipCategory].count++;
      counts[p.chipCategory].totalBudget += p.budget;
    }
    return counts;
  }, [projects]);

  return (
    <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 10, background: '#0f172aee', border: `1px solid ${C.gridLine}`, borderRadius: 4, padding: '6px 8px', fontSize: 9, fontFamily: 'monospace', color: C.silkDim, minWidth: 180 }}>
      <div style={{ color: C.silk, fontWeight: 'bold', marginBottom: 3, letterSpacing: 1 }}>BOM (部品表)</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.gridLine}` }}>
            <th style={{ textAlign: 'left', paddingBottom: 2 }}>種別</th>
            <th style={{ textAlign: 'left', paddingBottom: 2 }}>支出区分</th>
            <th style={{ textAlign: 'right', paddingBottom: 2 }}>数</th>
            <th style={{ textAlign: 'right', paddingBottom: 2 }}>金額</th>
          </tr>
        </thead>
        <tbody>
          {(Object.entries(bom) as [ChipCategory, { count: number; totalBudget: number }][]).filter(([, v]) => v.count > 0).map(([cat, val]) => (
            <tr key={cat} style={{ borderBottom: `1px solid ${C.gridLine}20` }}>
              <td style={{ color: CHIP_META[cat].color, paddingRight: 6 }}>■ {CHIP_META[cat].short}</td>
              <td>{CHIP_META[cat].desc}</td>
              <td style={{ textAlign: 'right' }}>{val.count}</td>
              <td style={{ textAlign: 'right', color: CHIP_META[cat].color }}>{fmt(val.totalBudget)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 3, borderTop: `1px solid ${C.gridLine}`, paddingTop: 2, textAlign: 'right' }}>
        合計: {projects.length}部品
      </div>
    </div>
  );
}

// ============================================================
// Layer toggle
// ============================================================

function LayerPanel({ layers, onChange }: { layers: { copper: boolean; silkscreen: boolean; soldermask: boolean }; onChange: (l: typeof layers) => void }) {
  return (
    <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, background: '#0f172aee', border: `1px solid ${C.gridLine}`, borderRadius: 4, padding: '6px 8px', fontSize: 10, fontFamily: 'monospace', color: C.silkDim }}>
      <div style={{ marginBottom: 3, color: C.silk, fontWeight: 'bold' }}>LAYERS</div>
      {(Object.keys(layers) as (keyof typeof layers)[]).map(key => (
        <label key={key} className="flex items-center gap-1.5 cursor-pointer" style={{ marginBottom: 2 }}>
          <input type="checkbox" checked={layers[key]}
            onChange={() => onChange({ ...layers, [key]: !layers[key] })}
            style={{ width: 10, height: 10, accentColor: key === 'copper' ? C.copper : key === 'soldermask' ? C.mask : C.silk }} />
          <span style={{ color: key === 'copper' ? C.copper : key === 'soldermask' ? C.mask : C.silk }}>
            {key === 'copper' ? 'F.Cu' : key === 'silkscreen' ? 'F.SilkS' : 'F.Mask'}
          </span>
        </label>
      ))}
    </div>
  );
}

// ============================================================
// Main Board View
// ============================================================

export type BoardLevel = 'overview' | 'ministry' | 'circuit';

interface BoardState { level: BoardLevel; ministryName?: string; projectId?: number; projectName?: string }

export function BudgetBoardView({ ministries }: { ministries: TreemapMinistry[] }) {
  const [boardState, setBoardState] = useState<BoardState>({ level: 'overview' });
  const [circuitData, setCircuitData] = useState<CircuitData | null>(null);
  const [circuitLoading, setCircuitLoading] = useState(false);
  const [layers, setLayers] = useState({ copper: true, silkscreen: true, soldermask: true });

  const handleProjectClick = useCallback((pid: number) => {
    setCircuitLoading(true);
    fetch(`/api/map/circuit?pid=${pid}`)
      .then(r => r.json())
      .then((data: CircuitData) => {
        setCircuitData(data);
        setBoardState(prev => ({ level: 'circuit', ministryName: prev.ministryName, projectId: pid, projectName: data.projectName }));
      })
      .catch(console.error)
      .finally(() => setCircuitLoading(false));
  }, []);

  const { nodes: initNodes, edges: initEdges, bomProjects } = useMemo(() => {
    if (boardState.level === 'circuit' && circuitData) {
      return { ...buildCircuitGraph(circuitData), bomProjects: [] };
    }
    if (boardState.level === 'ministry' && boardState.ministryName) {
      const m = ministries.find(m => m.name === boardState.ministryName);
      if (m) return buildMinistryGraph(m, handleProjectClick);
    }
    return { ...buildOverviewGraph(ministries), bomProjects: [] };
  }, [boardState, ministries, circuitData, handleProjectClick]);

  const [rfNodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(initEdges);
  useMemo(() => { setNodes(initNodes); setEdges(initEdges); }, [initNodes, initEdges, setNodes, setEdges]);

  const handleMinistryClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (boardState.level === 'overview' && node.type === 'ministryChip') {
      setBoardState({ level: 'ministry', ministryName: (node.data as MinistryData).label });
    }
  }, [boardState.level]);

  const edgeOpacity = layers.copper ? 0.6 : 0.05;
  const visibleEdges = useMemo(() => rfEdges.map(e => ({ ...e, style: { ...e.style, opacity: edgeOpacity } })), [rfEdges, edgeOpacity]);
  const boardBg: CSSProperties = { background: layers.soldermask ? C.mask : C.board, transition: 'background 0.3s' };

  const breadcrumb = useMemo(() => {
    const p: { label: string; onClick?: () => void }[] = [
      { label: '全体 151兆円', onClick: () => { setBoardState({ level: 'overview' }); setCircuitData(null); } },
    ];
    if (boardState.ministryName) p.push({ label: boardState.ministryName, onClick: () => { setBoardState({ level: 'ministry', ministryName: boardState.ministryName }); setCircuitData(null); } });
    if (boardState.projectName) p.push({ label: `PID:${boardState.projectId} ${boardState.projectName}` });
    return p;
  }, [boardState]);

  return (
    <div className="h-full flex flex-col" style={{ background: C.board }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b" style={{ borderColor: C.gridLine, background: '#0f172a', minHeight: 34 }}>
        <div className="flex items-center gap-2 text-xs">
          {breadcrumb.map((p, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span style={{ color: C.copper, fontFamily: 'monospace' }}>›</span>}
              {p.onClick ? (
                <button onClick={p.onClick} className="hover:underline" style={{ color: i === breadcrumb.length - 1 ? C.copper : C.silkDim }}>{p.label}</button>
              ) : (
                <span style={{ color: C.copper, fontWeight: 'bold' }}>{p.label}</span>
              )}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: C.silkDim }}>
          {boardState.level === 'overview' && <span>CLICK CHIP → EXPAND</span>}
          {boardState.level === 'ministry' && <span>CLICK IC → CIRCUIT VIEW</span>}
          {boardState.level === 'circuit' && circuitData && (
            <>
              {circuitData.fanInBlocks.length > 0 && <span style={{ color: C.fanIn }}>◆FAN-IN:{circuitData.fanInBlocks.length}</span>}
              {circuitData.fanOutBlocks.length > 0 && <span style={{ color: C.fanOut }}>◇FAN-OUT:{circuitData.fanOutBlocks.length}</span>}
            </>
          )}
          <a href="/sankey" style={{ color: C.fanOut }}>Sankey</a>
          <a href="/quality" style={{ color: C.fanOut }}>Quality</a>
        </div>
      </div>

      {circuitLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(10,15,26,0.85)' }}>
          <div className="text-center">
            <div className="animate-spin h-6 w-6 border-2 border-t-transparent rounded-full mx-auto mb-2" style={{ borderColor: C.copper }} />
            <p style={{ color: C.silkDim, fontSize: 11, fontFamily: 'monospace' }}>LOADING NETLIST...</p>
          </div>
        </div>
      )}

      <div className="flex-1 relative">
        <LayerPanel layers={layers} onChange={setLayers} />
        {boardState.level === 'ministry' && bomProjects.length > 0 && <BOMPanel projects={bomProjects} />}

        <ReactFlow
          nodes={rfNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={boardState.level === 'overview' ? handleMinistryClick : undefined}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.08}
          maxZoom={4}
          proOptions={{ hideAttribution: true }}
          style={boardBg}
        >
          <Background variant={BackgroundVariant.Lines} gap={40} size={0.5} color={layers.soldermask ? C.grid : C.gridLine} />
          <Controls showInteractive={false} style={{ background: '#0f172a', border: `1px solid ${C.gridLine}`, borderRadius: 3 }} />
          <MiniMap
            style={{ background: C.maskDark, border: `1px solid ${C.gridLine}` }}
            nodeColor={(n) => {
              if (n.type === 'ministryChip') return C.copper;
              if (n.type === 'orgReg') return C.power;
              if (n.type === 'blockPad') return C.indirect;
              const cat = (n.data as ProjData)?.chipCategory;
              return cat ? CHIP_META[cat].color : C.pad;
            }}
            maskColor="rgba(10,15,26,0.75)"
          />
        </ReactFlow>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-4 px-3 py-1 border-t text-[9px] font-mono" style={{ borderColor: C.gridLine, background: '#0f172a', color: '#334155' }}>
        <span>LEVEL:{boardState.level.toUpperCase()}</span>
        <span>NODES:{rfNodes.length}</span>
        <span>NETS:{visibleEdges.length}</span>
        {Object.entries(CHIP_META).map(([key, meta]) => (
          <span key={key}><span style={{ color: meta.color }}>■</span> {meta.short}={meta.desc}</span>
        ))}
        <span className="ml-auto">PAN:drag ZOOM:scroll SELECT:click</span>
      </div>
    </div>
  );
}

// ============================================================
// Graph Builders
// ============================================================

function buildOverviewGraph(ministries: TreemapMinistry[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const sorted = [...ministries].sort((a, b) => b.totalBudget - a.totalBudget);
  const cols = 6;

  sorted.forEach((m, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const xOff = row % 2 === 1 ? 130 : 0;
    const pinCount = Math.min(40, Math.max(8, Math.ceil(m.projectCount / 20)));

    nodes.push({
      id: `m-${m.name}`,
      type: 'ministryChip',
      position: { x: col * 260 + xOff, y: row * 200 },
      data: { label: m.name, desig: `U${i + 1}`, budget: m.totalBudget, spending: m.totalSpending, projectCount: m.projectCount, accountMix: m.accountMix, pinCount } satisfies MinistryData,
    });
  });

  const traces: [string, string][] = [
    ['復興庁', '総務省'], ['復興庁', '農林水産省'], ['復興庁', '国土交通省'],
    ['財務省', '厚生労働省'], ['財務省', '国土交通省'], ['内閣府', '文部科学省'],
    ['内閣府', '経済産業省'], ['総務省', '厚生労働省'],
  ];
  const edges: Edge[] = traces
    .map(([f, t], i) => nodes.find(n => n.id === `m-${f}`) && nodes.find(n => n.id === `m-${t}`)
      ? { id: `t-${i}`, source: `m-${f}`, target: `m-${t}`, type: 'smoothstep', style: { stroke: C.copper, strokeWidth: 1.5, opacity: 0.3 } } as Edge
      : null)
    .filter((e): e is Edge => e !== null);

  return { nodes, edges };
}

// Base dimensions (unscaled) per chip category
const BASE_DIMS: Record<ChipCategory, { w: number; h: number }> = {
  regulator: { w: 90, h: 52 },
  processor: { w: 100, h: 68 },
  capacitor: { w: 74, h: 36 },
  memory:    { w: 88, h: 58 },
  resistor:  { w: 66, h: 30 },
};

function buildMinistryGraph(ministry: TreemapMinistry, onClickProject: (pid: number) => void): { nodes: Node[]; edges: Edge[]; bomProjects: { chipCategory: ChipCategory; budget: number }[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const projects = ministry.projects.slice(0, 60);

  // Ministry main chip
  const pinCount = Math.min(40, Math.max(8, Math.ceil(ministry.projectCount / 20)));
  nodes.push({
    id: 'main',
    type: 'ministryChip',
    position: { x: 0, y: 0 },
    data: { label: ministry.name, desig: 'U1', budget: ministry.totalBudget, spending: ministry.totalSpending, projectCount: ministry.projectCount, accountMix: ministry.accountMix, pinCount } satisfies MinistryData,
  });

  // Group by chipCategory
  const categoryGroups = new Map<ChipCategory, typeof projects>();
  for (const p of projects) {
    const cat = p.chipCategory || 'resistor';
    if (!categoryGroups.has(cat)) categoryGroups.set(cat, []);
    categoryGroups.get(cat)!.push(p);
  }

  const categoryOrder: ChipCategory[] = ['regulator', 'processor', 'capacitor', 'memory', 'resistor'];
  let zoneX = 300;
  let globalIdx = 0;
  const GAP = 10;
  const MAX_SCALE = 3;

  for (const cat of categoryOrder) {
    const projs = categoryGroups.get(cat);
    if (!projs || projs.length === 0) continue;

    const meta = CHIP_META[cat];
    const base = BASE_DIMS[cat];
    const cols = projs.length > 15 ? 2 : 1;
    // Column width = max possible scaled width + padding
    const colW = Math.round(base.w * MAX_SCALE) + 20;
    const colYTracks = [0, 0];

    projs.forEach((p) => {
      const sc = chipScaleFromSpending(p.spending);
      const h = Math.round(base.h * sc);

      // Greedy: place in column with smallest current Y
      const col = cols === 2 ? (colYTracks[0] <= colYTracks[1] ? 0 : 1) : 0;

      nodes.push({
        id: `p-${p.projectId}`,
        type: 'projectChip',
        position: { x: zoneX + col * colW, y: colYTracks[col] },
        data: {
          label: p.name, desig: `${meta.refPrefix}${globalIdx + 1}`, projectId: p.projectId,
          budget: p.budget, spending: p.spending, chipScale: sc,
          qualityScore: p.qualityScore, bureau: p.bureau,
          blockCount: p.blockCount || 1, recipientCount: p.recipientCount,
          chipCategory: p.chipCategory || 'resistor', hasRedelegation: p.hasRedelegation || false,
          onClickProject,
        } satisfies ProjData,
      });

      edges.push({
        id: `e-p-${p.projectId}`, source: 'main', target: `p-${p.projectId}`, type: 'smoothstep',
        style: { stroke: C.copper, strokeWidth: Math.max(0.5, Math.min(3, (p.budget / ministry.totalBudget) * 40)), opacity: 0.35 },
      });

      colYTracks[col] += h + GAP;
      globalIdx++;
    });

    zoneX += cols * colW + 40;
  }

  // Center main chip vertically
  const maxY = Math.max(...nodes.filter(n => n.id !== 'main').map(n => n.position.y), 0);
  nodes[0].position.y = maxY / 2;

  const bomProjects = projects.map(p => ({ chipCategory: (p.chipCategory || 'resistor') as ChipCategory, budget: p.budget }));
  return { nodes, edges, bomProjects };
}

function buildCircuitGraph(data: CircuitData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const maxAmt = Math.max(...data.nodes.map(n => n.amount), 1);
  const direct = data.nodes.filter(n => n.isDirect && n.id !== 'ORG');
  const indirect = data.nodes.filter(n => !n.isDirect && n.id !== 'ORG');
  const org = data.nodes.find(n => n.id === 'ORG');

  if (org) nodes.push({ id: 'ORG', type: 'orgReg', position: { x: 0, y: Math.max(direct.length, indirect.length) * 40 }, data: { label: org.label, amount: org.amount } satisfies OrgData });

  const dSp = Math.max(75, 450 / Math.max(direct.length, 1));
  direct.forEach((b, i) => nodes.push({ id: b.id, type: 'blockPad', position: { x: 260, y: i * dSp }, data: { label: b.label, blockKey: b.blockKey, amount: b.amount, recipientCount: b.recipientCount, isDirect: true, isFanIn: data.fanInBlocks.includes(b.id), isFanOut: data.fanOutBlocks.includes(b.id) } satisfies BlockData }));

  const iSp = Math.max(75, 450 / Math.max(indirect.length, 1));
  indirect.forEach((b, i) => nodes.push({ id: b.id, type: 'blockPad', position: { x: 520, y: i * iSp }, data: { label: b.label, blockKey: b.blockKey, amount: b.amount, recipientCount: b.recipientCount, isDirect: false, isFanIn: data.fanInBlocks.includes(b.id), isFanOut: data.fanOutBlocks.includes(b.id) } satisfies BlockData }));

  for (const e of data.edges) {
    const w = Math.max(1, Math.min(5, (e.amount / maxAmt) * 5));
    const isX = e.flowType === '移替' || e.flowType === '直接支出';
    edges.push({ id: e.id, source: e.source, target: e.target, type: 'smoothstep', label: fmt(e.amount), labelStyle: { fontSize: 7, fill: C.silkDim, fontFamily: 'monospace' }, style: { stroke: isX ? C.fanOut : C.fanIn, strokeWidth: w, opacity: 0.6 }, markerEnd: { type: MarkerType.ArrowClosed, color: isX ? C.fanOut : C.fanIn, width: 8, height: 8 }, animated: !isX });
  }

  return { nodes, edges };
}
