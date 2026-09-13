'use client';

/**
 * 探索履歴・発見メモのドロップダウン（/sankey-svg 上部・年度セレクト隣）。
 *
 * データは IndexedDB（client/lib/exploration-store.ts）にのみ保存され、サーバへは
 * 送信されない。訪問の自動記録は page.tsx が行い（URL 同期に連動）、このコンポーネントは
 * 一覧・メモ保存・適用・削除の操作面を担う。適用（onApply）は AI チャット結果適用と
 * 同じ URL 復元経路を page 側で使う。
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CHAT_MARKDOWN_STYLES } from './chat-markdown-styles';

// Markdown 描画（チャットと同じ遅延ロード。展開表示時にのみ評価される）
const ChatMarkdown = lazy(() => import('./ChatMarkdown'));
import {
  listEntries,
  saveMemo,
  deleteEntry,
  clearAutoHistory,
  updateEntryTitle,
  type ExplorationEntry,
} from '@/client/lib/exploration-store';
import { relativeTime } from '@/client/lib/relative-time';

interface ExplorationHistoryProps {
  /** 現在の図の状態（メモ保存用）。qs は先頭 ? なしのクエリ文字列 */
  getSnapshot: () => { qs: string; label: string; year: string };
  /** エントリの適用（page 側で pushState + URL 復元経路を通す） */
  onApply: (qs: string) => void;
  /** コントロールのフォントサイズ（年度セレクトと合わせる） */
  fontPx: number;
}

/** 小さなテキストリンク風ボタン（名前変更・URLコピー・削除 等）の共通クラス */
const TEXT_LINK_CLASS = 'font-normal text-mirai-text-muted hover:text-mirai-text hover:opacity-100';

/** ドロップダウン内の入力欄 */
const INPUT_CLASS =
  'min-w-0 flex-1 rounded-md border border-mirai-border bg-card px-2 py-1 text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary';

export function ExplorationHistory({ getSnapshot, onApply, fontPx }: ExplorationHistoryProps) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ExplorationEntry[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 長文メモ（チャットのレポート保存等）の展開状態
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // タイトルのインライン編集
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleInput, setTitleInput] = useState('');

  const commitTitle = async (id: string) => {
    await updateEntryTitle(id, titleInput);
    setEditingId(null);
    refresh();
  };
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = () => { listEntries().then(setEntries); };

  // 開いたときに読み直す + 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    refresh();
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const handleSaveMemo = async () => {
    const snap = getSnapshot();
    // 手動保存の入力はタイトルとして扱う（本文はチャットの「メモに保存」由来のみ）
    await saveMemo(snap.qs, snap.label, snap.year, '', noteInput.trim() || undefined);
    setNoteInput('');
    refresh();
  };

  const handleCopy = async (entry: ExplorationEntry) => {
    const url = `${window.location.origin}${window.location.pathname}${entry.qs ? `?${entry.qs}` : ''}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // クリップボード不可の環境では何もしない
    }
  };

  const memos = entries.filter(e => e.pinned);
  const autos = entries.filter(e => !e.pinned);

  const renderEntry = (e: ExplorationEntry) => (
    <div key={e.id} className="flex flex-col gap-0.5 border-b border-border px-2.5 py-1.5">
      {editingId === e.id ? (
        <input
          type="text"
          value={titleInput}
          autoFocus
          onChange={ev => setTitleInput(ev.target.value)}
          onKeyDown={ev => {
            if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) commitTitle(e.id);
            if (ev.key === 'Escape') { ev.stopPropagation(); setEditingId(null); }
          }}
          onBlur={() => commitTitle(e.id)}
          placeholder="タイトル（空にすると自動ラベル表示）"
          className={cn(INPUT_CLASS, 'border-primary')}
          style={{ fontSize: fontPx }}
        />
      ) : (
        <Button
          variant="ghost"
          onClick={() => { onApply(e.qs); setOpen(false); }}
          title="この状態を図に適用"
          className={cn(
            'h-auto w-full justify-start whitespace-normal rounded-md p-0 text-left font-normal leading-normal hover:bg-transparent',
            e.title ? 'text-mirai-text hover:text-primary-accent' : 'text-primary hover:text-primary-accent',
          )}
          style={{ fontSize: fontPx, wordBreak: 'break-word' }}
        >
          <span>
            {e.title ? <b>{e.title}</b> : e.label}
            {e.title && <span className="block font-normal text-primary" style={{ fontSize: fontPx - 2 }}>{e.label}</span>}
          </span>
        </Button>
      )}
      {e.note && (() => {
        const isLong = e.note.length > 160;
        const expanded = expandedIds.has(e.id);
        return (
          <div className="text-mirai-text-subtle" style={{ fontSize: fontPx - 1, wordBreak: 'break-word' }}>
            {/* 省略時も Markdown で描画し、高さクランプで抑える（途中で切ると表等が壊れるため全文を描画して隠す） */}
            <div
              className="ai-chat-md rounded-md border border-border bg-mirai-surface px-2 py-1.5"
              style={expanded ? undefined : { maxHeight: 76, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)' }}
            >
              <Suspense fallback={<span style={{ whiteSpace: 'pre-wrap' }}>{expanded ? e.note : `${e.note.slice(0, 160)}${isLong ? '…' : ''}`}</span>}>
                <ChatMarkdown text={e.note} />
              </Suspense>
            </div>
            {isLong && (
              <Button
                variant="link"
                onClick={() => setExpandedIds(prev => {
                  const next = new Set(prev);
                  if (expanded) next.delete(e.id); else next.add(e.id);
                  return next;
                })}
                className="mt-0.5 block font-normal hover:text-primary-accent hover:opacity-100"
                style={{ fontSize: fontPx - 2 }}
              >{expanded ? '折りたたむ' : '全文を表示'}</Button>
            )}
          </div>
        );
      })()}
      <div className="flex items-center gap-2 text-mirai-text-muted" style={{ fontSize: fontPx - 2 }}>
        <span>{relativeTime(e.ts)}</span>
        <Button
          variant="link"
          onClick={() => { setEditingId(e.id); setTitleInput(e.title ?? ''); }}
          className={TEXT_LINK_CLASS}
          style={{ fontSize: fontPx - 2 }}
        >名前変更</Button>
        <Button
          variant="link"
          onClick={() => handleCopy(e)}
          className={TEXT_LINK_CLASS}
          style={{ fontSize: fontPx - 2 }}
        >{copiedId === e.id ? 'コピーしました' : 'URLコピー'}</Button>
        <Button
          variant="link"
          onClick={() => { deleteEntry(e.id).then(refresh); }}
          className="font-normal text-destructive hover:opacity-80"
          style={{ fontSize: fontPx - 2 }}
        >削除</Button>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} data-pan-disabled="true" style={{ position: 'relative' }}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(v => !v)}
        title="探索履歴・メモ"
        aria-label="探索履歴・メモ"
        aria-expanded={open}
        className={cn(
          'gap-1 border-mirai-border px-2.5',
          open && 'border-primary bg-mirai-surface-teal text-primary-accent hover:bg-mirai-surface-teal',
        )}
        style={{ fontSize: fontPx }}
      >
        <History className="size-3.5 text-mirai-text-subtle" aria-hidden="true" />
        履歴
      </Button>

      {open && (
        <div
          className="rounded-xl border border-mirai-border bg-card shadow-soft"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
            width: 340, maxHeight: '60vh', overflowY: 'auto',
            zIndex: 30, colorScheme: 'light',
          }}
        >
          {/* Markdown プレビュー用スタイル（チャットと共用。ドロップダウン内で1回だけ描画） */}
          <style>{CHAT_MARKDOWN_STYLES}</style>
          {/* 現在の図をメモとして保存 */}
          <div className="rounded-t-xl border-b border-border bg-mirai-surface px-2.5 py-2">
            <div className="mb-1 text-mirai-text-subtle" style={{ fontSize: fontPx - 1 }}>現在の図をメモとして保存</div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSaveMemo(); if (e.key === 'Escape') e.stopPropagation(); }}
                placeholder="タイトル（省略可）"
                className={INPUT_CLASS}
                style={{ fontSize: fontPx }}
              />
              <Button
                variant="outline"
                size="xs"
                onClick={handleSaveMemo}
                className="h-auto whitespace-nowrap border-primary px-3 text-primary-accent hover:bg-mirai-surface-teal"
                style={{ fontSize: fontPx - 1 }}
              >保存</Button>
            </div>
          </div>

          {memos.length > 0 && (
            <div>
              <div className="px-2.5 pb-0.5 pt-1.5 font-bold text-mirai-text-muted" style={{ fontSize: fontPx - 2 }}>メモ</div>
              {memos.map(renderEntry)}
            </div>
          )}

          <div>
            <div className="flex items-center px-2.5 pb-0.5 pt-1.5 font-bold text-mirai-text-muted" style={{ fontSize: fontPx - 2 }}>
              <span style={{ flex: 1 }}>履歴（自動・最新50件）</span>
              {autos.length > 0 && (
                <Button
                  variant="link"
                  onClick={() => { clearAutoHistory().then(refresh); }}
                  className={TEXT_LINK_CLASS}
                  style={{ fontSize: fontPx - 2 }}
                >全削除</Button>
              )}
            </div>
            {autos.length === 0 && (
              <div className="px-2.5 pb-3 pt-2 text-mirai-text-muted" style={{ fontSize: fontPx - 1 }}>
                まだ履歴がありません。図の状態を変えると自動で記録されます
              </div>
            )}
            {autos.map(renderEntry)}
          </div>

          <div className="px-2.5 pb-2 pt-1.5 text-mirai-text-placeholder" style={{ fontSize: fontPx - 2 }}>
            履歴・メモはこのブラウザにのみ保存されます
          </div>
        </div>
      )}
    </div>
  );
}
