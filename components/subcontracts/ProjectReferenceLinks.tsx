import Link from 'next/link';
import { Waypoints } from 'lucide-react';
import { rsSystemProjectSearchUrl, sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';
import { cn } from '@/lib/utils';

interface ProjectReferenceLinksProps {
  projectId: number;
  projectName: string;
  year: number;
  compact?: boolean;
}

/** 「RS」のワードマーク風アイコン（lucide に該当アイコンが無いためテキストで描く） */
function RsIcon() {
  return (
    <span aria-hidden="true" className="inline-flex h-3.5 items-center text-[10px] font-bold leading-none tracking-tight">
      RS
    </span>
  );
}

/**
 * 事業の参照リンク群（RSシステム / メインSankey）。
 * compact=true は一覧テーブルのセル内用（アイコンのみ・20px 角）、既定はピル型のアウトラインボタン風。
 */
export function ProjectReferenceLinks({
  projectId,
  projectName,
  year,
  compact = false,
}: ProjectReferenceLinksProps) {
  const itemClass = cn(
    'inline-flex shrink-0 items-center justify-center text-primary no-underline transition-colors hover:text-primary-accent focus-visible:ring-[3px] focus-visible:ring-primary/40',
    compact
      ? 'size-5 rounded-md hover:bg-primary/10'
      : 'gap-[5px] rounded-full border border-mirai-border bg-card px-[7px] py-1 text-[11px] font-bold shadow-xs hover:bg-mirai-surface',
  );

  return (
    <div className={cn('flex items-center', compact ? 'flex-nowrap gap-0.5' : 'flex-wrap gap-1.5')}>
      <a
        href={rsSystemProjectSearchUrl(projectName, year)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="RSシステムで開く"
        title="RSシステムで開く"
        className={itemClass}
      >
        <RsIcon />
        {!compact && <span>RSシステム</span>}
      </a>
      <Link
        href={sankeySvgProjectUrl(projectId, projectName, year)}
        aria-label="メイン画面でこの事業を表示（同じタブで開きます）"
        title="メイン画面でこの事業を表示（同じタブで開きます）"
        className={itemClass}
      >
        <Waypoints className="size-3.5" aria-hidden="true" />
        {!compact && <span>Sankey</span>}
      </Link>
    </div>
  );
}
