'use client';

/**
 * 事業ごとの「みんなの意見」ブロック（4面共通: サンキー側パネル / 評価ダイアログ / バブル選択パネル / 再委託の事業詳細）。
 * 公開済み意見の件数と「意見を伝える」ボタン（AIインタビューへ）を常に出し、意見の一覧はアコーディオンで開閉する
 * （既定は閉じる。パネルの縦を意見で占有しないため）。開くと直近数件、「すべて表示」で全件。
 * データ取得は useProjectComments に閉じ、機能無効時（env 未配布・API 404）は何も描かない。
 *
 * 見た目はチームみらいデザインシステム（.claude/skills/SKILL.md）。「意見を伝える」はこのパネルの
 * プライマリ CTA（グラデ・ピル）。フォントサイズは親のフォントスケール（scaleFont）に従うため inline で渡す。
 */
import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { InterviewProjectContext } from '@/client/lib/comments/interview-runner';
import { useProjectComments } from '@/client/hooks/useProjectComments';
import { relativeTime } from '@/client/lib/relative-time';
import { FEATURE_PROJECT_COMMENTS } from '@/app/lib/feature-flags';
import { InterviewDialog } from './InterviewDialog';

export interface ProjectCommentsProps {
  /** インタビューに渡す事業情報（pid / year / projectName は必須） */
  context: InterviewProjectContext;
  /** 文字サイズの倍率（サンキー側パネルのフォントスケールに合わせる） */
  scaleFont?: (px: number) => number;
  /** 一覧に出す件数（既定 3） */
  previewCount?: number;
  /** 外側の余白・罫線を消す（ダイアログ内など、親がレイアウトを持つ場合） */
  bare?: boolean;
}

export function ProjectComments({ context, scaleFont = px => px, previewCount = 3, bare = false }: ProjectCommentsProps) {
  const enabled = FEATURE_PROJECT_COMMENTS;
  const state = useProjectComments(enabled ? context.pid : null, context.year);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  /** 一覧を開いている事業。事業を切り替えたら自動で閉じる（pid が一致するときだけ開いている扱い） */
  const [listOpenFor, setListOpenFor] = useState<string | null>(null);
  const listId = useId();

  const META_PX = scaleFont(11);

  if (!enabled || state.comments === null) {
    // 本番では機能無効の環境で何も描かない。開発サーバーでは全体のレイアウトを把握できるよう見出しだけ残す
    if (process.env.NODE_ENV !== 'development') return null;
    return (
      <div className={cn(!bare && 'shrink-0 border-b border-border px-3.5 pb-2.5 pt-2')} data-testid="project-comments-disabled">
        <div className="flex items-center gap-2">
          <span className="font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(13) }}>みんなの意見</span>
          <span className="text-mirai-text-placeholder" style={{ fontSize: META_PX }}>この環境では無効（Supabase 未設定）</span>
          <span className="flex-1" />
          <Button variant="default" size="xs" disabled title="この環境では事業コメント機能が無効です" style={{ fontSize: META_PX }}>
            意見を伝える
          </Button>
        </div>
      </div>
    );
  }

  const BODY_PX = scaleFont(12.5);
  const list = state.comments ?? [];
  const shown = expanded ? list : list.slice(0, previewCount);
  const hasList = list.length > 0;
  const listOpen = hasList && listOpenFor === context.pid;
  const countLabel = state.error ? '件数を取得できません' : state.comments === undefined ? '…' : `${state.total}件`;

  return (
    <div className={cn(!bare && 'shrink-0 border-b border-border px-3.5 pb-2.5 pt-2')}>
      <div className="flex items-center gap-2">
        {hasList ? (
          <Button
            variant="ghost"
            aria-expanded={listOpen}
            aria-controls={listId}
            onClick={() => setListOpenFor(listOpen ? null : context.pid)}
            title={listOpen ? '意見の一覧を閉じる' : '意見の一覧を開く'}
            className="-ml-1 h-auto gap-1 rounded-md px-1 py-0.5 font-normal hover:bg-mirai-surface"
          >
            <ChevronRight
              className={cn('size-3.5 text-mirai-text-muted transition-transform', listOpen && 'rotate-90')}
              aria-hidden="true"
            />
            <span className="font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(13) }}>みんなの意見</span>
            <span className="text-mirai-text-muted" style={{ fontSize: META_PX }}>{countLabel}</span>
          </Button>
        ) : (
          <>
            <span className="font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(13) }}>みんなの意見</span>
            <span className="text-mirai-text-muted" style={{ fontSize: META_PX }}>{countLabel}</span>
          </>
        )}
        <span className="flex-1" />
        <Button
          variant="default"
          size="xs"
          onClick={() => setOpen(true)}
          title="AIインタビューでこの事業への意見を伝える（匿名）"
          style={{ fontSize: META_PX }}
        >
          意見を伝える
        </Button>
      </div>

      {state.error && <div role="alert" className="mt-1.5 text-destructive" style={{ fontSize: META_PX }}>{state.error} <Button variant="link" className="text-[length:inherit] font-medium text-current" onClick={() => void state.refresh()}>再読み込みする</Button></div>}

      {state.comments !== undefined && list.length === 0 && !state.error && (
        <div className="mt-1 text-mirai-text-placeholder" style={{ fontSize: META_PX }}>まだ意見はありません。最初の意見を伝えてみませんか。</div>
      )}

      {listOpen && <div id={listId}>
      {shown.length > 0 && (
        <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
          {shown.map(c => (
            <li key={c.id} className="rounded-xl border border-border bg-mirai-surface px-2.5 py-1.5">
              <div className="whitespace-pre-wrap break-words leading-[1.55] text-mirai-text-secondary" style={{ fontSize: BODY_PX }}>{c.body}</div>
              <div className="mt-[3px] text-mirai-text-placeholder" style={{ fontSize: scaleFont(10) }}>匿名 ・ {relativeTime(Date.parse(c.createdAt))}</div>
            </li>
          ))}
        </ul>
      )}

      {(list.length > previewCount || state.nextCursor) && (
        <div className="mt-1.5 flex gap-2.5">
          {list.length > previewCount && (
            <Button variant="link" onClick={() => setExpanded(v => !v)}
              className="font-normal no-underline hover:text-primary-accent hover:underline" style={{ fontSize: META_PX }}>
              {expanded ? '折りたたむ' : `すべて表示（${list.length}件）`}
            </Button>
          )}
          {expanded && state.nextCursor && (
            <Button variant="link" onClick={() => void state.loadMore()} disabled={state.loadingMore}
              className="font-normal no-underline hover:text-primary-accent hover:underline" style={{ fontSize: META_PX }}>
              {state.loadingMore ? '読み込み中...' : 'さらに読み込む'}
            </Button>
          )}
        </div>
      )}
      </div>}

      {open && (
        <InterviewDialog
          context={context}
          onClose={() => setOpen(false)}
          onSubmitted={() => { void state.refresh(); setListOpenFor(context.pid); }}
        />
      )}
    </div>
  );
}
