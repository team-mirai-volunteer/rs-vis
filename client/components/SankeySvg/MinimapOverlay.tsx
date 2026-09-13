'use client';

import type { RefObject, MutableRefObject } from 'react';
import { ChevronLeft, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MinimapOverlayProps {
  show: boolean;
  onShow: () => void;
  onHide: () => void;
  left: number;
  minimapW: number;
  minimapH: number;
  canvasRef: RefObject<HTMLCanvasElement>;
  navigate: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  dragging: MutableRefObject<boolean>;
}

export function MinimapOverlay({ show, onShow, onHide, left, minimapW, minimapH, canvasRef, navigate, dragging }: MinimapOverlayProps) {
  if (show) {
    return (
      <div
        data-pan-disabled="true"
        style={{ position: 'absolute', left, bottom: 8, zIndex: 10, transition: 'left 0.2s ease' }}
      >
        {/* ミニマップ本体（canvas 描画）はデータ可視化なので配色はそのまま。枠だけトークン化 */}
        <canvas
          ref={canvasRef}
          width={minimapW}
          height={minimapH}
          onClick={(e) => { e.stopPropagation(); navigate(e); }}
          onMouseDown={(e) => { e.stopPropagation(); dragging.current = true; navigate(e); }}
          onMouseMove={(e) => { if (dragging.current) navigate(e); }}
          onMouseUp={() => { dragging.current = false; }}
          onMouseLeave={() => { dragging.current = false; }}
          className="block cursor-crosshair border border-mirai-border shadow-xs"
          style={{ borderRadius: '4px 4px 0px 4px' }}
        />
        <Button
          variant="ghost"
          title="ミニマップを隠す"
          aria-label="ミニマップを隠す"
          onClick={(e) => { e.stopPropagation(); onHide(); }}
          className="h-5 w-[14px] rounded-none rounded-r-md border border-l-0 border-mirai-border bg-card p-0 text-mirai-text-placeholder hover:bg-mirai-surface hover:text-mirai-text"
          style={{ position: 'absolute', bottom: 0, right: -13, zIndex: 12 }}
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      data-pan-disabled="true"
      title="ミニマップを表示"
      aria-label="ミニマップを表示"
      onClick={(e) => { e.stopPropagation(); onShow(); }}
      className="size-8 rounded-md bg-card text-mirai-text-muted shadow-xs hover:bg-mirai-surface hover:text-mirai-text"
      style={{ position: 'absolute', left: left + 8, bottom: 16, zIndex: 11, transition: 'left 0.2s ease' }}
    >
      <Map className="size-[18px]" aria-hidden="true" />
    </Button>
  );
}
