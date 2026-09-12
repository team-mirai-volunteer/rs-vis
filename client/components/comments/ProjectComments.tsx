'use client';

/**
 * 事業ごとの「みんなの意見」ブロック（4面共通: サンキー側パネル / 評価ダイアログ / バブル選択パネル / 再委託の事業詳細）。
 * 公開済み意見の件数と直近数件、「意見を伝える」ボタン（AIインタビューへ）を出す。
 * データ取得は useProjectComments に閉じ、機能無効時（env 未配布・API 404）は何も描かない。
 */
import { useState } from 'react';
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

  if (!enabled || state.comments === null) return null;

  const META_PX = scaleFont(11);
  const BODY_PX = scaleFont(12.5);
  const list = state.comments ?? [];
  const shown = expanded ? list : list.slice(0, previewCount);

  return (
    <div style={bare ? undefined : { borderBottom: '1px solid #f0f0f0', padding: '8px 14px 10px', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: scaleFont(13), fontWeight: 600, color: '#555' }}>みんなの意見</span>
        <span style={{ fontSize: META_PX, color: '#999' }}>
          {state.comments === undefined ? '…' : `${state.total}件`}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="AIインタビューでこの事業への意見を伝える（匿名）"
          style={{
            fontSize: META_PX, padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
            border: '1px solid #c2e5cf', background: '#e7f5ec', color: '#1b7f37', fontWeight: 600,
          }}
        >
          意見を伝える
        </button>
      </div>

      {state.error && <div style={{ fontSize: META_PX, color: '#b00020' }}>{state.error}</div>}

      {state.comments !== undefined && list.length === 0 && !state.error && (
        <div style={{ fontSize: META_PX, color: '#aaa' }}>まだ意見はありません。最初の意見を伝えてみませんか。</div>
      )}

      {shown.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shown.map(c => (
            <li key={c.id} style={{ background: '#fafaf7', border: '1px solid #eee', borderRadius: 8, padding: '6px 10px' }}>
              <div style={{ fontSize: BODY_PX, color: '#333', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
              <div style={{ fontSize: scaleFont(10), color: '#aaa', marginTop: 3 }}>匿名 ・ {relativeTime(Date.parse(c.createdAt))}</div>
            </li>
          ))}
        </ul>
      )}

      {(list.length > previewCount || state.nextCursor) && (
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          {list.length > previewCount && (
            <button type="button" onClick={() => setExpanded(v => !v)}
              style={{ fontSize: META_PX, color: '#4a90d9', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              {expanded ? '折りたたむ' : `すべて表示（${list.length}件）`}
            </button>
          )}
          {expanded && state.nextCursor && (
            <button type="button" onClick={() => void state.loadMore()} disabled={state.loadingMore}
              style={{ fontSize: META_PX, color: '#4a90d9', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              {state.loadingMore ? '読み込み中...' : 'さらに読み込む'}
            </button>
          )}
        </div>
      )}

      {open && (
        <InterviewDialog
          context={context}
          onClose={() => setOpen(false)}
          onSubmitted={() => { void state.refresh(); }}
        />
      )}
    </div>
  );
}
