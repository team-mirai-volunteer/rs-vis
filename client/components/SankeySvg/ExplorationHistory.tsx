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
    <div key={e.id} style={{ padding: '6px 10px', borderBottom: '1px solid #f4f4f4', display: 'flex', flexDirection: 'column', gap: 2 }}>
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
          style={{ fontSize: fontPx, padding: '4px 8px', border: '1px solid #1a73e8', borderRadius: 4, outline: 'none', fontFamily: 'inherit', color: '#333', background: '#fff' }}
        />
      ) : (
        <button
          onClick={() => { onApply(e.qs); setOpen(false); }}
          title="この状態を図に適用"
          style={{ textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: e.title ? '#333' : '#1a73e8', fontSize: fontPx, lineHeight: 1.5, wordBreak: 'break-word' }}
        >
          {e.title ? <b>{e.title}</b> : e.label}
          {e.title && <span style={{ display: 'block', fontWeight: 400, fontSize: fontPx - 2, color: '#1a73e8' }}>{e.label}</span>}
        </button>
      )}
      {e.note && (() => {
        const isLong = e.note.length > 160;
        const expanded = expandedIds.has(e.id);
        return (
          <div style={{ fontSize: fontPx - 1, color: '#555', wordBreak: 'break-word' }}>
            {/* 省略時も Markdown で描画し、高さクランプで抑える（途中で切ると表等が壊れるため全文を描画して隠す） */}
            <div
              className="ai-chat-md"
              style={{
                background: '#fafafa', border: '1px solid #eee', borderRadius: 6, padding: '6px 9px',
                ...(expanded ? {} : { maxHeight: 76, overflow: 'hidden', maskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, #000 55%, transparent 100%)' }),
              }}
            >
              <Suspense fallback={<span style={{ whiteSpace: 'pre-wrap' }}>{expanded ? e.note : `${e.note.slice(0, 160)}${isLong ? '…' : ''}`}</span>}>
                <ChatMarkdown text={e.note} />
              </Suspense>
            </div>
            {isLong && (
              <button
                onClick={() => setExpandedIds(prev => {
                  const next = new Set(prev);
                  if (expanded) next.delete(e.id); else next.add(e.id);
                  return next;
                })}
                style={{ display: 'block', background: 'transparent', border: 'none', padding: 0, marginTop: 2, cursor: 'pointer', color: '#1a73e8', fontSize: fontPx - 2, textDecoration: 'underline' }}
              >{expanded ? '折りたたむ' : '全文を表示'}</button>
            )}
          </div>
        );
      })()}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fontPx - 2, color: '#999' }}>
        <span>{relativeTime(e.ts)}</span>
        <button
          onClick={() => { setEditingId(e.id); setTitleInput(e.title ?? ''); }}
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#888', fontSize: fontPx - 2, textDecoration: 'underline' }}
        >名前変更</button>
        <button
          onClick={() => handleCopy(e)}
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#888', fontSize: fontPx - 2, textDecoration: 'underline' }}
        >{copiedId === e.id ? 'コピーしました' : 'URLコピー'}</button>
        <button
          onClick={() => { deleteEntry(e.id).then(refresh); }}
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#c66', fontSize: fontPx - 2, textDecoration: 'underline' }}
        >削除</button>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} data-pan-disabled="true" style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="探索履歴・メモ"
        aria-label="探索履歴・メモ"
        style={{
          fontSize: fontPx, border: '1px solid #e0e0e0', borderRadius: 8, padding: '6px 10px',
          background: open ? '#eef3ff' : 'rgba(255,255,255,0.95)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
          color: '#333', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="#666"><path d="M480-120q-138 0-240.5-91.5T122-440h82q14 104 92.5 172T480-200q117 0 198.5-81.5T760-480q0-117-81.5-198.5T480-760q-69 0-129 32t-101 88h110v80H120v-240h80v94q51-64 124.5-99T480-840q75 0 140.5 28.5t114 77q48.5 48.5 77 114T840-480q0 75-28.5 140.5t-77 114q-48.5 48.5-114 77T480-120Zm112-192L440-464v-216h80v184l128 128-56 56Z"/></svg>
        履歴
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          width: 340, maxHeight: '60vh', overflowY: 'auto',
          background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 30, colorScheme: 'light',
        }}>
          {/* Markdown プレビュー用スタイル（チャットと共用。ドロップダウン内で1回だけ描画） */}
          <style>{CHAT_MARKDOWN_STYLES}</style>
          {/* 現在の図をメモとして保存 */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #eee', background: '#fafbff' }}>
            <div style={{ fontSize: fontPx - 1, color: '#777', marginBottom: 4 }}>現在の図をメモとして保存</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSaveMemo(); if (e.key === 'Escape') e.stopPropagation(); }}
                placeholder="タイトル（省略可）"
                style={{ flex: 1, minWidth: 0, fontSize: fontPx, padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, outline: 'none', fontFamily: 'inherit', color: '#333', background: '#fff' }}
              />
              <button
                onClick={handleSaveMemo}
                style={{ fontSize: fontPx - 1, fontWeight: 600, color: '#fff', background: '#1a73e8', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >保存</button>
            </div>
          </div>

          {memos.length > 0 && (
            <div>
              <div style={{ padding: '6px 10px 2px', fontSize: fontPx - 2, fontWeight: 700, color: '#888' }}>メモ</div>
              {memos.map(renderEntry)}
            </div>
          )}

          <div>
            <div style={{ padding: '6px 10px 2px', fontSize: fontPx - 2, fontWeight: 700, color: '#888', display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: 1 }}>履歴（自動・最新50件）</span>
              {autos.length > 0 && (
                <button
                  onClick={() => { clearAutoHistory().then(refresh); }}
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#999', fontSize: fontPx - 2, textDecoration: 'underline', fontWeight: 400 }}
                >全削除</button>
              )}
            </div>
            {autos.length === 0 && (
              <div style={{ padding: '8px 10px 12px', fontSize: fontPx - 1, color: '#999' }}>
                まだ履歴がありません。図の状態を変えると自動で記録されます
              </div>
            )}
            {autos.map(renderEntry)}
          </div>

          <div style={{ padding: '6px 10px 8px', fontSize: fontPx - 2, color: '#aaa' }}>
            履歴・メモはこのブラウザにのみ保存されます
          </div>
        </div>
      )}
    </div>
  );
}
