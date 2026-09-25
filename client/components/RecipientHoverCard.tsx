'use client';

/**
 * 詳細パネルの支出先の行にホバーしたときのカード（支出先名・金額・主な契約）。
 * 行のクリックは選択の移動に使うので、表示はホバーだけ。
 * 常にポインタの上側に出す（行の位置で上下が入れ替わると驚くため。パネルの下の方の行でも見切れない）。
 * 横は画面端で内側へ寄せ、上端に届くほど高いときだけ上端に合わせる。
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { RecipientContractSummary } from './RecipientContractSummary';

export interface RecipientHover {
  x: number;
  y: number;
  /** 支出先名（契約を引くキー） */
  name: string;
  /** 見出し。省略時は支出先名。支出先を選んで事業の行にホバーしたときは事業名を出す */
  title?: string;
  /** 見出しの下の補足（例: 「→ 個人A」） */
  subtitle?: string;
  amount: number;
  /** 手元の契約の概要（1事業の再委託構造から）。無ければ year / pids で取得する */
  contracts?: readonly string[];
  year: number | string | null;
  pids: readonly (string | number)[];
}

const CARD_W = 288;
const OFFSET = 14;
const MARGIN = 8;

export function RecipientHoverCard({ hover }: { hover: RecipientHover | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const visible = hover !== null;
  // 契約の読み込みで高さが変わるので、表示中は高さを追う
  useLayoutEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    setHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver(() => setHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  if (!hover || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[100] rounded-xl border border-mirai-border bg-card p-2.5 text-xs shadow-soft"
      style={{ width: CARD_W, left: `clamp(${MARGIN}px, ${hover.x + OFFSET}px, calc(100vw - ${CARD_W + MARGIN}px))`, top: Math.max(MARGIN, hover.y - OFFSET - height) }}
    >
      <p className="font-bold leading-snug text-mirai-text">{hover.title ?? hover.name}</p>
      {hover.subtitle && <p className="text-[11px] text-mirai-text-muted">{hover.subtitle}</p>}
      {Number.isFinite(hover.amount) && <p className="tabular-nums text-mirai-text-secondary">{formatBudgetFromYen(hover.amount)}</p>}
      <RecipientContractSummary className="mt-1.5 border-t border-border pt-1.5" year={hover.year} name={hover.name} pids={hover.pids} contracts={hover.contracts} />
    </div>,
    document.body,
  );
}
