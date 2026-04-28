'use client';

import type { RefObject, MutableRefObject } from 'react';

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
        <canvas
          ref={canvasRef}
          width={minimapW}
          height={minimapH}
          onClick={(e) => { e.stopPropagation(); navigate(e); }}
          onMouseDown={(e) => { e.stopPropagation(); dragging.current = true; navigate(e); }}
          onMouseMove={(e) => { if (dragging.current) navigate(e); }}
          onMouseUp={() => { dragging.current = false; }}
          onMouseLeave={() => { dragging.current = false; }}
          style={{ display: 'block', border: '1px solid #ccc', borderRadius: '4px 4px 0px 4px', cursor: 'crosshair', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}
        />
        <button
          type="button"
          title="ミニマップを隠す"
          onClick={(e) => { e.stopPropagation(); onHide(); }}
          style={{ position: 'absolute', bottom: 0, right: -13, zIndex: 12, background: 'rgba(255,255,255,0.92)', borderTop: '1px solid #ccc', borderRight: '1px solid #ccc', borderBottom: '1px solid #ccc', borderLeft: 'none', borderRadius: '0 4px 4px 0', width: 14, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 0 24 24" width="18px" fill="#aaa"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      data-pan-disabled="true"
      title="ミニマップを表示"
      onClick={(e) => { e.stopPropagation(); onShow(); }}
      style={{ position: 'absolute', left: left + 8, bottom: 16, zIndex: 11, background: 'rgba(255,255,255,0.7)', border: 'none', borderRadius: 6, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, transition: 'left 0.2s ease' }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="#888"><path d="m600-120-240-84-186 72q-20 8-37-4.5T120-170v-560q0-13 7.5-23t20.5-15l212-72 240 84 186-72q20-8 37 4.5t17 33.5v560q0 13-7.5 23T812-192l-212 72Zm-40-98v-468l-160-56v468l160 56Zm80 0 120-40v-474l-120 46v468Zm-440-10 120-46v-468l-120 40v474Zm440-458v468-468Zm-320-56v468-468Z"/></svg>
    </button>
  );
}
