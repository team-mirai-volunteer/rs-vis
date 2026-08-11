import type { CSSProperties } from 'react';
import type { ProjectDetail } from '@/types/project-details';

/**
 * 事業概要アコーディオンの共有コンポーネント。メインSankey（/sankey-svg）と
 * 再委託ビュー（/subcontracts）で同一の見た目（RS/URLアイコン・折りたたみプレビュー・
 * 展開時の詳細フィールド）を保つ。
 *
 * 折りたたみ時プレビューの高さドラッグ変更はページ側の状態を props で受ける
 * （onResizeStart 指定時のみハンドル表示）。subcontractHref を渡すと再委託アイコンを出す
 * （再委託ページ自身では自己参照になるため渡さない）。逆に再委託ページからは sankeyHref を
 * 渡してメイン画面（/sankey-svg）へのアイコンを出す。どちらも同じタブで遷移する。
 */
export function ProjectOverviewSection({
  detail,
  projectName,
  year,
  subcontractHref,
  sankeyHref,
  scaleFont,
  expanded,
  onToggle,
  previewHeight,
  onResizeStart,
  onResizeReset,
  isLoading = false,
}: {
  detail: ProjectDetail | null | undefined;
  projectName: string;
  year: string | number;
  subcontractHref?: string;
  sankeyHref?: string;
  scaleFont: (px: number) => number;
  expanded: boolean;
  onToggle: () => void;
  previewHeight: number;
  onResizeStart?: (e: React.MouseEvent) => void;
  onResizeReset?: () => void;
  isLoading?: boolean;
}) {
  const META_PX = scaleFont(11);
  const PANEL_META_PX = scaleFont(13);
  const rsUrl = `https://rssystem.go.jp/project?q=${encodeURIComponent(projectName.replace(/\//g, ''))}&fiscalYear=${year}&isSearchTargetProjectName=true`;

  return (
    <div style={{ borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '7px 14px', gap: 4 }}>
        <button type="button" onClick={onToggle}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
        >
          <span style={{ fontSize: META_PX, color: '#888' }}>{expanded ? '▼' : '▶'}</span>
          <span style={{ fontSize: PANEL_META_PX, fontWeight: 600, color: '#555' }}>事業概要</span>
        </button>
        <a href={rsUrl} target="_blank" rel="noopener noreferrer"
          title="RSシステムで開く"
          style={{ display: 'flex', alignItems: 'center', color: '#4a90d9', textDecoration: 'none', flexShrink: 0 }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="14" width="18" viewBox="0 0 24 20" fill="none">
            <text x="12" y="16" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="sans-serif" fill="#4a90d9">RS</text>
          </svg>
        </a>
        {detail?.url && /^https?:\/\//.test(detail.url) && (
          <a href={detail.url} target="_blank" rel="noopener noreferrer"
            title="事業概要URL"
            style={{ display: 'flex', alignItems: 'center', color: '#4a90d9', textDecoration: 'none', flexShrink: 0 }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="#4a90d9">
              <path d="M320-440h320v-80H320v80Zm0 120h320v-80H320v80Zm0 120h200v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"/>
            </svg>
          </a>
        )}
        {subcontractHref && (
          <a href={subcontractHref}
            title="再委託構造を見る（同じタブで開きます）"
            style={{ display: 'flex', alignItems: 'center', color: '#4a90d9', textDecoration: 'none', flexShrink: 0 }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="#4a90d9">
              <path d="M760-120q-39 0-70-22.5T647-200H440q-66 0-113-47t-47-113q0-66 47-113t113-47h80q33 0 56.5-23.5T600-600q0-33-23.5-56.5T520-680H313q-13 35-43.5 57.5T200-600q-50 0-85-35t-35-85q0-50 35-85t85-35q39 0 69.5 22.5T313-760h207q66 0 113 47t47 113q0 66-47 113t-113 47h-80q-33 0-56.5 23.5T360-360q0 33 23.5 56.5T440-280h207q13-35 43.5-57.5T760-360q50 0 85 35t35 85q0 50-35 85t-85 35ZM228.5-691.5Q240-703 240-720t-11.5-28.5Q217-760 200-760t-28.5 11.5Q160-737 160-720t11.5 28.5Q183-680 200-680t28.5-11.5Z"/>
            </svg>
          </a>
        )}
        {sankeyHref && (
          <a href={sankeyHref}
            title="メイン画面でこの事業を表示（同じタブで開きます）"
            style={{ display: 'flex', alignItems: 'center', color: '#4a90d9', textDecoration: 'none', flexShrink: 0 }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="#4a90d9">
              <path d="M760-120q-39 0-70-22.5T647-200H440q-66 0-113-47t-47-113q0-66 47-113t113-47h80q33 0 56.5-23.5T600-600q0-33-23.5-56.5T520-680H313q-13 35-43.5 57.5T200-600q-50 0-85-35t-35-85q0-50 35-85t85-35q39 0 69.5 22.5T313-760h207q66 0 113 47t47 113q0 66-47 113t-113 47h-80q-33 0-56.5 23.5T360-360q0 33 23.5 56.5T440-280h207q13-35 43.5-57.5T760-360q50 0 85 35t35 85q0 50-35 85t-85 35ZM228.5-691.5Q240-703 240-720t-11.5-28.5Q217-760 200-760t-28.5 11.5Q160-737 160-720t11.5 28.5Q183-680 200-680t28.5-11.5Z"/>
            </svg>
          </a>
        )}
      </div>
      {!expanded && detail?.overview && (
        <>
          <div style={{ padding: '0 14px 0', fontSize: PANEL_META_PX, color: '#888', lineHeight: 1.5, height: previewHeight, overflowY: 'auto', wordBreak: 'break-all' }}>
            {detail.overview}
          </div>
          {onResizeStart && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="事業概要プレビューの高さを変更"
              title="ドラッグで高さを変更"
              onMouseDown={onResizeStart}
              onDoubleClick={onResizeReset}
              style={{ height: 10, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}
              data-pan-disabled
            >
              <div style={{ width: 32, height: 3, borderRadius: 2, background: '#d0d0d0' }} />
            </div>
          )}
        </>
      )}
      {expanded && (
        <div style={{ padding: '0 14px 10px', fontSize: PANEL_META_PX, color: '#444', maxHeight: 320, overflowY: 'auto' }}>
          {isLoading && <span style={{ color: '#aaa' }}>読み込み中...</span>}
          {!isLoading && detail === null && <span style={{ color: '#aaa' }}>詳細情報が見つかりませんでした</span>}
          {!isLoading && detail && (() => {
            const d = detail;
            const fieldStyle: CSSProperties = { marginBottom: 8 };
            const labelStyle: CSSProperties = { fontSize: META_PX, color: '#aaa', display: 'block', marginBottom: 2 };
            const textStyle: CSSProperties = { lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
            return (<>
              {d.category && (
                <div style={fieldStyle}>
                  <span style={labelStyle}>事業区分</span>
                  <span>{d.category}</span>
                  {(d.startYear || d.endYear || d.noEndDate) && (
                    <span style={{ marginLeft: 8, color: '#888' }}>
                      {d.startYear ?? (d.startYearUnknown ? '不明' : '?')}年度〜{d.noEndDate ? '終了予定なし' : (d.endYear ? `${d.endYear}年度` : '?')}
                    </span>
                  )}
                </div>
              )}
              {d.implementationMethods.length > 0 && (
                <div style={fieldStyle}>
                  <span style={labelStyle}>実施方法</span>
                  <span>{d.implementationMethods.join('・')}</span>
                </div>
              )}
              {d.overview && (
                <div style={fieldStyle}>
                  <span style={labelStyle}>概要</span>
                  <span style={textStyle}>{d.overview}</span>
                </div>
              )}
              {d.purpose && (
                <div style={fieldStyle}>
                  <span style={labelStyle}>目的</span>
                  <span style={textStyle}>{d.purpose}</span>
                </div>
              )}
              {d.url && (
                <div style={fieldStyle}>
                  <a href={d.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: META_PX, color: '#4a90d9', wordBreak: 'break-all' }}>
                    事業概要URL ↗
                  </a>
                </div>
              )}
            </>);
          })()}
        </div>
      )}
    </div>
  );
}
