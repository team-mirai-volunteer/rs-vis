'use client';

/**
 * サイドパネルの chrome（枠・開閉タブ・リサイズハンドル）の共通表示コンポーネント。
 *
 * 表示専用: fetch・状態保持は一切行わない。状態は client/hooks/useSidePanel.ts が持ち、
 * 呼び出し側の page.tsx がそれを繋ぐ（app/lib 同様、UI と状態管理は分離する）。
 *
 * 見た目・操作感は app/sankey-svg/page.tsx の左ノード詳細パネル（実装の正）に合わせている:
 * 折りたたみ時は幅0＋画面端の開閉タブのみ、展開時はリサイズハンドル＋children。
 *
 * 対象外: AiChatPanel（右・既に同等機能を自前実装済み。閉状態の見た目が異なるため統合しない）。
 */
import type { CSSProperties, ReactNode } from 'react';

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
  /** ルート要素に付与する data-testid 等の識別用途 */
  testId?: string;
  children: ReactNode;
}

const LEFT_ARROW = '15 6 9 12 15 18'; // "<"
const RIGHT_ARROW = '9 6 15 12 9 18'; // ">"

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
  testId,
  children,
}: SidePanelChromeProps) {
  const isLeft = side === 'left';
  // 折りたたみ時: 画面端へ向く矢印（クリックで展開）。展開時: 画面端側へ戻る矢印（クリックで折りたたみ）
  const toggleIcon = open
    ? (isLeft ? LEFT_ARROW : RIGHT_ARROW)
    : (isLeft ? RIGHT_ARROW : LEFT_ARROW);

  const rootStyle: CSSProperties = {
    position: 'fixed',
    [isLeft ? 'left' : 'right']: 0,
    top: 0,
    height: '100%',
    width: open ? width : 0,
    background: '#fff',
    [isLeft ? 'borderRight' : 'borderLeft']: open ? '1px solid #e0e0e0' : 'none',
    boxShadow: open ? (isLeft ? '2px 0 8px rgba(0,0,0,0.1)' : '-2px 0 8px rgba(0,0,0,0.1)') : 'none',
    zIndex,
    transition: isResizing ? 'none' : 'width 0.2s ease',
    overflow: 'visible',
    cursor: 'default',
  };

  return (
    <div data-pan-disabled="true" data-testid={testId} style={rootStyle}>
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
          <div style={{ width: 3, height: 32, borderRadius: 2, background: isResizing ? '#a0a0a0' : 'transparent' }} />
        </div>
      )}

      {/* 開閉タブ（折りたたみ/展開の両方でこのボタンのみ画面端に常時表示） */}
      <div
        data-pan-disabled="true"
        style={{
          position: 'absolute',
          [isLeft ? 'right' : 'left']: -25,
          top: '50%', transform: 'translateY(-50%)',
          width: 25, zIndex: 1,
          background: '#fff',
          // ショートハンド border と辺別指定を混在させない（side が切り替わる再レンダーで
          // React が競合警告を出すため、4辺を明示指定する）
          borderTop: '1px solid #e0e0e0',
          borderBottom: '1px solid #e0e0e0',
          [isLeft ? 'borderRight' : 'borderLeft']: '1px solid #e0e0e0',
          [isLeft ? 'borderLeft' : 'borderRight']: 'none',
          borderRadius: isLeft ? '0 6px 6px 0' : '6px 0 0 6px',
          boxShadow: isLeft ? '2px 0 4px rgba(0,0,0,0.08)' : '-2px 0 4px rgba(0,0,0,0.08)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}
      >
        <button
          data-pan-disabled="true"
          onClick={onToggle}
          title={open ? collapseLabel : expandLabel}
          aria-label={open ? collapseLabel : expandLabel}
          style={{
            width: 25, height: 56,
            background: 'transparent', border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, borderRadius: isLeft ? '0 6px 6px 0' : '6px 0 0 6px',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={toggleIcon} />
          </svg>
        </button>
      </div>

      {/* パネル本体（展開時のみ） */}
      {open && (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {children}
        </div>
      )}
    </div>
  );
}
