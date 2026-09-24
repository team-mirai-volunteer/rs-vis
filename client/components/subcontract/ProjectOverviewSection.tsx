import { ChevronDown, ChevronRight, FileText, Waypoints } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProjectDetail } from '@/types/project-details';
import { ProjectDescription, formatProjectText } from '@/client/components/ProjectDescription';

/**
 * 事業概要アコーディオンの共有コンポーネント。メインSankey（/sankey-svg）と
 * 再委託ビュー（/subcontracts）で同一の見た目（RS/URLアイコン・折りたたみプレビュー・
 * 展開時の詳細フィールド）を保つ。
 *
 * 折りたたみ時プレビューの高さドラッグ変更はページ側の状態を props で受ける
 * （onResizeStart 指定時のみハンドル表示）。subcontractHref を渡すと再委託アイコンを出す
 * （再委託ページ自身では自己参照になるため渡さない）。逆に再委託ページからは sankeyHref を
 * 渡してメイン画面（/sankey-svg）へのアイコンを出す。どちらも同じタブで遷移する。
 *
 * 色・角丸はチームみらいデザインシステムのトークン（Tailwind クラス）、
 * フォントサイズはページ側のフォントスケール（scaleFont）に従うため inline style で渡す。
 */

/** ヘッダ右側の小さなアイコンリンク（RS / URL / 再委託 / メイン画面）の共通クラス */
const ICON_LINK_CLASS =
  'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-primary no-underline transition-colors hover:bg-primary/10 hover:text-primary-accent';

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
  showBottomBorder = true,
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
  showBottomBorder?: boolean;
}) {
  const META_PX = scaleFont(11);
  const PANEL_META_PX = scaleFont(11);
  const rsUrl = `https://rssystem.go.jp/project?q=${encodeURIComponent(projectName.replace(/\//g, ''))}&fiscalYear=${year}&isSearchTargetProjectName=true`;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const previewText = detail
    ? [detail.purpose, detail.currentIssues, detail.overview].filter(text => text?.trim()).join('\n')
    : '';

  return (
    <div className={showBottomBorder ? 'shrink-0 border-b border-border' : 'shrink-0'}>
      <div className="flex items-center gap-2 px-3.5 py-[7px]">
        <Button
          variant="ghost"
          onClick={onToggle}
          aria-expanded={expanded}
          className="h-auto min-w-0 flex-1 justify-start gap-[5px] rounded-md p-0 text-left font-bold text-mirai-text-subtle hover:bg-transparent hover:text-mirai-text has-[>svg]:px-0"
        >
          <span style={{ fontSize: PANEL_META_PX }}>事業概要</span>
          <Chevron aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: META_PX, height: META_PX }} />
        </Button>
        <div className="flex shrink-0 items-center gap-1">
        <a href={rsUrl} target="_blank" rel="noopener noreferrer"
          title="RSシステムで開く"
          className={ICON_LINK_CLASS}
        >
          <span aria-hidden="true" className="text-[10px] font-bold leading-none tracking-tight">RS</span>
        </a>
        {detail?.url && /^https?:\/\//.test(detail.url) && (
          <a href={detail.url} target="_blank" rel="noopener noreferrer"
            title="事業概要URL"
            aria-label="事業概要URL"
            className={ICON_LINK_CLASS}
          >
            <FileText className="size-3.5" aria-hidden="true" />
          </a>
        )}
        {subcontractHref && (
          <a href={subcontractHref}
            title="再委託構造を見る（同じタブで開きます）"
            className={ICON_LINK_CLASS}
          >
            <Waypoints className="size-3.5" aria-hidden="true" />
          </a>
        )}
        {sankeyHref && (
          <a href={sankeyHref}
            title="メイン画面でこの事業を表示（同じタブで開きます）"
            className={ICON_LINK_CLASS}
          >
            <Waypoints className="size-3.5" aria-hidden="true" />
          </a>
        )}
        </div>
      </div>
      {!expanded && previewText && (
        <>
          <div className="px-3.5 pb-2">
            <div
              className="overflow-hidden whitespace-pre-wrap break-words text-xs leading-relaxed text-mirai-text-subtle"
              style={{
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                // text-xs (12px) × leading-relaxed (1.625)、下余白8pxを除いた行数。
                WebkitLineClamp: Math.max(1, Math.floor((previewHeight - 8) / 19.5)),
              }}
            >
              {formatProjectText(previewText)}
            </div>
          </div>
          {onResizeStart && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="事業概要プレビューの高さを変更"
              title="ドラッグで高さを変更"
              onMouseDown={onResizeStart}
              onDoubleClick={onResizeReset}
              className="flex h-2.5 cursor-ns-resize select-none items-center justify-center"
              data-pan-disabled
            >
              <div className="h-[3px] w-8 rounded-full bg-mirai-border" />
            </div>
          )}
        </>
      )}
      {expanded && (
        <div className="px-3.5 pb-3 text-xs text-mirai-text-secondary">
          {isLoading && <span className="text-mirai-text-placeholder">読み込み中...</span>}
          {!isLoading && detail === null && <span className="text-mirai-text-placeholder">詳細情報が見つかりませんでした</span>}
          {!isLoading && detail && <ProjectDescription detail={detail} showSourceLink={false} />}
        </div>
      )}
    </div>
  );
}
