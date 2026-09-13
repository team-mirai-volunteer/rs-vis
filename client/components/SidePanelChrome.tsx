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
 * 対象外: AiChatPanel（右・既に同等機能を自前実装済み。閉状態の見た目が異なるため統合しない）。
 */
import type { CSSProperties, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** 浮島パネルの画面端・下端からの余白(px)。ページ側が隣接要素をずらすときは幅 + INSET*2 を使う */
export const SIDE_PANEL_INSET = 12;

export interface SidePanelChromeProps {
  /** パネルの画面上の位置。境界線・リサイズハンドル・開閉タブの向きが side に応じて鏡映する */
  side: 'left' | 'right';
  /** true = 展開（children を表示）。false = 折りたたみ（幅0、開閉タブのみ表示） */
  open: boolean;
  onToggle: () => void;
  /** 展開時の実効幅(px)（ビューポートクランプ済みの値を渡す） */
  width: number;
  minWidth: number;
  maxWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
  isResizing: boolean;
  onResetWidth: () => void;
  /** 開閉タブの title/aria-label（既定はサンキーと同じ文言） */
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
  open,
  onToggle,
  width,
  minWidth,
  maxWidth,
  onResizeStart,
  isResizing,
  onResetWidth,
  expandLabel = 'パネルを展開',
  collapseLabel = 'パネルを折りたたむ',
  zIndex = 25,
  topOffset = 0,
  testId,
  children,
}: SidePanelChromeProps) {
  const isLeft = side === 'left';
  // 折りたたみ時: 画面端へ向く矢印（クリックで展開）。展開時: 画面端側へ戻る矢印（クリックで折りたたみ）
  const pointsLeft = open ? isLeft : !isLeft;
  const ToggleIcon = pointsLeft ? ChevronLeft : ChevronRight;

  // 浮島型: ヘッダー（下余白込み）の下から画面下端 INSET まで、画面端から INSET 離して浮かせる。
  // 折りたたみ時は幅 0 で画面端に寄せ、開閉タブだけを端に出す
  const rootStyle: CSSProperties = {
    position: 'fixed',
    [isLeft ? 'left' : 'right']: open ? SIDE_PANEL_INSET : 0,
    top: `calc(var(--app-header-h, 0px) + ${topOffset}px)`,
    height: `calc(100% - var(--app-header-h, 0px) - ${topOffset + SIDE_PANEL_INSET}px)`,
    width: open ? width : 0,
    zIndex,
    transition: isResizing ? 'none' : 'width 0.2s ease, left 0.2s ease, right 0.2s ease',
    overflow: 'visible',
    cursor: 'default',
  };

  return (
    <div
      data-pan-disabled="true"
      data-testid={testId}
      className={cn(open && 'rounded-2xl border border-mirai-border bg-card shadow-soft')}
      style={rootStyle}
    >
      {/* 幅リサイズハンドル — 内側の境界線側の端 */}
      {open && (
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

      {/* 開閉タブ（折りたたみ/展開の両方でこのボタンのみ画面端に常時表示） */}
      <div
        data-pan-disabled="true"
        className={cn(
          'flex flex-col items-center border-y border-mirai-border bg-card shadow-xs',
          isLeft ? 'rounded-r-xl border-r' : 'rounded-l-xl border-l',
          // 展開時はカードの縁から生える。折りたたみ時は画面端に吸い付く
          !open && (isLeft ? 'border-l-0' : 'border-r-0'),
        )}
        style={{
          position: 'absolute',
          [isLeft ? 'right' : 'left']: -25,
          top: '50%', transform: 'translateY(-50%)',
          width: 25, zIndex: 1,
        }}
      >
        <Button
          variant="ghost"
          data-pan-disabled="true"
          onClick={onToggle}
          title={open ? collapseLabel : expandLabel}
          aria-label={open ? collapseLabel : expandLabel}
          className={cn(
            'h-14 w-[25px] p-0 text-mirai-text-muted hover:bg-mirai-surface hover:text-mirai-text',
            isLeft ? 'rounded-none rounded-r-xl' : 'rounded-none rounded-l-xl',
          )}
        >
          <ToggleIcon className="size-5" strokeWidth={2.5} aria-hidden="true" />
        </Button>
      </div>

      {/* パネル本体（展開時のみ） */}
      {open && (
        <div className="flex h-full flex-col overflow-hidden rounded-2xl">
          {children}
        </div>
      )}
    </div>
  );
}
