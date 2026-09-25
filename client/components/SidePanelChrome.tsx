'use client';

/**
 * サイドパネルの chrome（枠・開閉タブ・リサイズハンドル）の共通表示コンポーネント。
 *
 * 表示専用: fetch・状態保持は一切行わない。状態は client/hooks/useSidePanel.ts が持ち、
 * 呼び出し側の page.tsx がそれを繋ぐ（app/lib 同様、UI と状態管理は分離する）。
 *
 * 見た目・操作感は app/sankey-svg/page.tsx の左ノード詳細パネル（実装の正）に合わせている:
 * 折りたたみ時は幅0＋画面端の開閉タブのみ、展開時はリサイズハンドル＋children。
 * 配色はデザインシステムのトークン（bg-card / border-mirai-border / shadow-soft）を使い、
 * 位置・幅などレイアウトだけをインライン style で持つ。
 *
 * スマホ幅（640px 未満）ではボトムシートになる: 左右下 INSET、高さ 52vh、幅リサイズ無し。
 * 図のフィット計算はパネル幅を 0 として扱うこと（useIsNarrow で分岐）。
 *
 * 対象外: AiChatPanel（右・既に同等機能を自前実装済み。閉状態の見た目が異なるため統合しない）。
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useIsNarrow } from '@/client/hooks/useMediaQuery';
import { Button } from '@/components/ui/button';

/** 浮島パネルの画面端・下端からの余白(px)。ページ側が隣接要素をずらすときは幅 + INSET*2 を使う */
export const SIDE_PANEL_INSET = 12;

export interface SidePanelChromeProps {
  /** パネルの画面上の位置。境界線・リサイズハンドル・開閉タブの向きが side に応じて鏡映する */
  side: 'left' | 'right';
  /** 互換用。折りたたみ機能は廃止（初見のユーザーが隠したまま戻せなくなったため）。渡しても常に展開 */
  open?: boolean;
  onToggle?: () => void;
  /** 展開時の実効幅(px)（ビューポートクランプ済みの値を渡す） */
  width: number;
  minWidth: number;
  maxWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
  isResizing: boolean;
  onResetWidth: () => void;
  /** 互換用（未使用） */
  expandLabel?: string;
  collapseLabel?: string;
  zIndex?: number;
  /** ヘッダー下からさらに下げる量(px)。検索ボックスなど上部の浮島を押しのけずに、その下から始めたいときに使う */
  topOffset?: number;
  /** ルート要素に付与する data-testid 等の識別用途 */
  testId?: string;
  children: ReactNode;
}

export function SidePanelChrome({
  side,
  width,
  minWidth,
  maxWidth,
  onResizeStart,
  isResizing,
  onResetWidth,
  zIndex = 25,
  topOffset = 0,
  testId,
  children,
}: SidePanelChromeProps) {
  const isLeft = side === 'left';
  const narrow = useIsNarrow();
  const [expanded, setExpanded] = useState(false);

  // 浮島型: ヘッダー（下余白込み）の下から画面下端 INSET まで、画面端から INSET 離して浮かせる。
  // 折りたたみ機能は無い（閉じる＝選択解除はページ側の × ボタンが担う）
  const rootStyle: CSSProperties = narrow
    ? {
        position: 'fixed',
        left: SIDE_PANEL_INSET,
        right: SIDE_PANEL_INSET,
        bottom: SIDE_PANEL_INSET,
        height: expanded ? 'calc(100dvh - var(--app-header-h, 118px) - 24px)' : '72dvh',
        maxHeight: 'calc(100dvh - var(--app-header-h, 118px) - 24px)',
        zIndex: Math.max(zIndex, 35),
        overflow: 'visible',
        cursor: 'default',
      }
    : {
        position: 'fixed',
        [isLeft ? 'left' : 'right']: SIDE_PANEL_INSET,
        top: `calc(var(--app-header-h, 0px) + ${topOffset}px)`,
        height: `calc(100% - var(--app-header-h, 0px) - ${topOffset + SIDE_PANEL_INSET}px)`,
        width,
        zIndex,
        transition: isResizing ? 'none' : 'width 0.2s ease, left 0.2s ease, right 0.2s ease',
        overflow: 'visible',
        cursor: 'default',
      };

  return (
    <div
      data-pan-disabled="true"
      data-testid={testId}
      className="rounded-2xl border border-mirai-border bg-card shadow-soft"
      style={rootStyle}
    >
      {/* 幅リサイズハンドル — 内側の境界線側の端（ボトムシートでは無し） */}
      {!narrow && (
        <div
          data-pan-disabled="true"
          role="separator"
          aria-orientation="vertical"
          aria-label={`${isLeft ? '左側' : '右側'}パネルの幅を変更`}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={Math.round(width)}
          title="ドラッグで幅を変更（ダブルクリックで既定値）"
          onMouseDown={onResizeStart}
          onDoubleClick={onResetWidth}
          style={{
            position: 'absolute',
            [isLeft ? 'right' : 'left']: -3,
            top: 0, width: 6, height: '100%',
            cursor: 'ew-resize', zIndex: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none',
          }}
        >
          <div
            className={cn('h-8 w-[3px] rounded-sm', isResizing ? 'bg-mirai-border-light' : 'bg-transparent')}
          />
        </div>
      )}


      {/* パネル本体 */}
      <div className="flex h-full flex-col overflow-hidden rounded-2xl">
        {narrow && <Button variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
          className="h-auto min-h-9 w-full shrink-0 rounded-none border-b border-border px-3 text-xs font-bold text-primary-accent hover:bg-mirai-surface-teal">
          {expanded ? '詳細を小さく表示' : '詳細を大きく表示'}
        </Button>}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
