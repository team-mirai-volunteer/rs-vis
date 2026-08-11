'use client';

/**
 * サンキーAIチャットパネル（/sankey-svg 右側）。
 *
 * 表示専用コンポーネント: API 呼び出し・チャット状態の保持・結果の適用はすべて
 * page.tsx がコールバック経由で行う（client/components は直接APIコール禁止）。
 * AI の結果は自動適用せず、結果カードの「この条件で図を表示」で明示適用する。
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { SankeyChatProgressEvent, SankeyChatResult } from '@/types/sankey-ai-chat';
import type { ChatSessionMeta } from '@/client/lib/ai/chat-history-store';
import { relativeTime } from '@/client/lib/relative-time';
import { formatYen } from '@/app/lib/sankey-svg-constants';
import { CHAT_MARKDOWN_STYLES } from './chat-markdown-styles';

// Markdown 描画（react-markdown + remark-gfm）は初回メッセージ表示時に遅延ロードし、
// ページ初期バンドルに含めない。ロード完了までは Suspense fallback で本文を平文表示する
// （メッセージはユーザー操作後にのみ存在するため、この lazy が SSR で評価されることはない）
const ChatMarkdown = lazy(() => import('./ChatMarkdown'));

/** ページが保持するチャット表示用メッセージ（API の履歴形式 + 表示用の付加情報） */
export interface AiChatUiMessage {
  role: 'user' | 'assistant';
  content: string;
  /** フィルタ条件が確定した assistant 応答に付く */
  result?: SankeyChatResult;
  /** 次に聞ける質問の提案（最大3件）。assistant 応答に付く */
  suggestions?: string[];
  /** 送信失敗などのエラー表示 */
  isError?: boolean;
}

interface AiChatPanelProps {
  open: boolean;
  onToggle: () => void;
  messages: AiChatUiMessage[];
  sending: boolean;
  /** ストリーミング応答中の最新進行イベント（stream:true時のみ）。日本語ラベルへの変換はこのファイルで行う */
  progress?: SankeyChatProgressEvent | null;
  onSend: (text: string) => void;
  onApplyResult: (result: SankeyChatResult) => void;
  /** 新しい会話を開始する（以前の会話はセッション一覧に残る） */
  onClear: () => void;
  /** 保存済みセッションの一覧（新しい順・IndexedDBのみ） */
  sessions: ChatSessionMeta[];
  activeSessionId: string | null;
  onSwitchSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  /** セッションのタイトル変更（空文字は自動合成タイトルへ戻す） */
  onRenameSession: (id: string, title: string) => void;
  /** レポート応答を発見メモへ保存する（現在の図の状態に紐づく。page 側で exploration-store に委譲） */
  onSaveReport: (reportText: string) => Promise<void>;
  /** 実効パネル幅（ビューポートクランプ済み）。isCompactWidth のときは無視して全幅 */
  width: number;
  isCompactWidth: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  isResizing: boolean;
  onResetWidth: () => void;
  /**
   * 実行モード: 'byok'=使用者キー（ブラウザ→OpenRouter直接） / 'server'=サイト提供 /
   * null=未設定（キー登録の導線を出し、送信は不可）
   */
  mode: 'byok' | 'server' | null;
  /** 登録済み BYOK モデル名（設定ビューの初期値表示用） */
  byokModel: string | null;
  /** BYOK の既定モデル名（未登録時のプレースホルダ） */
  defaultByokModel: string;
  /** キー・モデルの保存（apiKey が null のときは登録済みキーを維持してモデルだけ更新）。保存後は mode が 'byok' になる */
  onSaveByok: (apiKey: string | null, model: string) => Promise<void>;
  /** 登録済みキーの削除 */
  onDeleteByok: () => Promise<void>;
  /** キーの接続テスト（保存前検証。キーはOpenRouterへのみ送信される） */
  onTestByok: (apiKey: string) => Promise<{ ok: boolean; error?: string }>;
}

const EXAMPLE_PROMPTS = [
  '再エネ関連で予算100億円以上の事業だけ見たい',
  'NTTデータはどの事業から受注している？',
  'マイナンバー関連は去年から増えた？',
];

/**
 * レポート化ボタンの定型プロンプト。「会話整形の1ターン + 出典付記」の品質が確認できた形を
 * そのまま固定する。会話に無い数値の捏造防止を明示するのが要点
 * （要件: docs/ai-chat-architecture-guide.md 5節）
 */
const REPORT_PROMPT =
  'ここまでの調査をレポートとしてまとめてください。数値・事実はこの会話に出てきたものだけを使い、会話に無い数値は書かないでください。' +
  '最後に「再現情報」として、適用したフィルタ条件（SankeyQuery JSON）と、主要な数値がどのツール・条件から得られたかを付記してください。';

const PANEL_Z_INDEX = 210; // 右上の設定ボタン(200)より前面。ScoreDetailDialog は body へ portal されるため影響しない

/**
 * 送信中インジケータの日本語ラベル。progress イベント（構造化データ）を人間向け文言へ変換する。
 * ラベルの対応表は docs/ai-chat-architecture-guide.md 3節のとおり
 */
function progressLabel(progress: SankeyChatProgressEvent | null | undefined): string {
  if (!progress) return '条件を組み立てています…';
  switch (progress.kind) {
    case 'llm_round':
      return progress.round <= 1 ? '要求を解釈しています…' : `結果を確認しています…（${progress.round}回目）`;
    case 'tool':
      if (progress.tool === 'run_sankey_query' && typeof progress.matched === 'number') {
        return `クエリを実行しました — ${progress.matched.toLocaleString()}事業がマッチ`;
      }
      if (progress.tool === 'search_projects' || progress.tool === 'search_recipients') {
        return '語彙を検索しています…';
      }
      return '詳細データを取得しています…';
    case 'retry':
      return '混雑のため待機して再試行します…';
    default:
      return '条件を組み立てています…';
  }
}

export function AiChatPanel({
  open, onToggle, messages, sending, progress, onSend, onApplyResult, onClear,
  sessions, activeSessionId, onSwitchSession, onDeleteSession, onRenameSession, onSaveReport,
  width, isCompactWidth, onResizeStart, isResizing, onResetWidth,
  mode, byokModel, defaultByokModel, onSaveByok, onDeleteByok, onTestByok,
}: AiChatPanelProps) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  // assistant メッセージのコピー・メモ保存の完了表示（メッセージindexで管理）
  const [copiedMsgIndex, setCopiedMsgIndex] = useState<number | null>(null);
  const [savedMsgIndex, setSavedMsgIndex] = useState<number | null>(null);

  const handleCopyMessage = async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgIndex(index);
      setTimeout(() => setCopiedMsgIndex(prev => (prev === index ? null : prev)), 1500);
    } catch {
      // クリップボード不可の環境では何もしない
    }
  };

  const handleSaveReport = async (index: number, text: string) => {
    try {
      await onSaveReport(text);
      setSavedMsgIndex(index);
      setTimeout(() => setSavedMsgIndex(prev => (prev === index ? null : prev)), 1500);
    } catch {
      // 保存失敗は表示を変えない（IndexedDB 非対応等）
    }
  };
  // 会話セッション一覧ドロップダウン
  const [showSessions, setShowSessions] = useState(false);
  const sessionsRef = useRef<HTMLDivElement>(null);
  // セッションタイトルのインライン編集
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionTitleInput, setSessionTitleInput] = useState('');
  const commitSessionTitle = (id: string) => {
    onRenameSession(id, sessionTitleInput);
    setEditingSessionId(null);
  };
  useEffect(() => {
    if (!showSessions) return;
    const onMouseDown = (e: MouseEvent) => {
      if (sessionsRef.current && !sessionsRef.current.contains(e.target as Node)) setShowSessions(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showSessions]);
  // 設定ビュー（キー登録）。モード未設定でパネルを開いた場合は最初から設定を見せる
  const [showSettings, setShowSettings] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // 新着メッセージ・送信中インジケータで最下部へ自動スクロール
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, sending]);

  const submit = () => {
    const text = input.trim();
    if (!text || sending || mode === null) return;
    setInput('');
    onSend(text);
  };

  const openSettings = () => {
    setKeyInput('');
    setModelInput(byokModel ?? '');
    setSettingsStatus(null);
    setShowSettings(true);
  };

  // 新規キー入力があるか、登録済み（=キー未入力ならモデルのみ更新）なら保存できる
  const canSave = keyInput.trim().length > 0 || mode === 'byok';

  const handleSave = async () => {
    const apiKey = keyInput.trim() || null;
    if (!apiKey && mode !== 'byok') return;
    setSettingsBusy(true);
    setSettingsStatus(null);
    try {
      await onSaveByok(apiKey, modelInput.trim() || defaultByokModel);
      setKeyInput('');
      setSettingsStatus({
        kind: 'ok',
        text: apiKey
          ? 'キーを保存しました。チャットは自分のキーで実行されます'
          : '設定を保存しました（キーは変更していません）',
      });
    } catch {
      setSettingsStatus({ kind: 'error', text: '保存に失敗しました（このブラウザでは IndexedDB が使えない可能性があります）' });
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleTest = async () => {
    const apiKey = keyInput.trim();
    if (!apiKey) return;
    setSettingsBusy(true);
    setSettingsStatus(null);
    const result = await onTestByok(apiKey);
    setSettingsStatus(result.ok
      ? { kind: 'ok', text: '接続テストに成功しました' }
      : { kind: 'error', text: `接続テスト失敗: ${result.error ?? '不明なエラー'}` });
    setSettingsBusy(false);
  };

  const handleDelete = async () => {
    setSettingsBusy(true);
    setSettingsStatus(null);
    try {
      await onDeleteByok();
      setSettingsStatus({ kind: 'ok', text: 'キーを削除しました（会話履歴もクリアしました）' });
    } catch {
      setSettingsStatus({ kind: 'error', text: '削除に失敗しました' });
    } finally {
      setSettingsBusy(false);
    }
  };

  // 深掘り提案チップのタップ: そのテキストをそのままユーザーメッセージとして送信する
  const submitSuggestion = (text: string) => {
    if (sending) return;
    onSend(text);
  };

  // 閉状態: 右端中央の開閉タブのみ表示
  if (!open) {
    return (
      <button
        data-pan-disabled="true"
        onClick={onToggle}
        title="AIアシスタントを開く"
        aria-label="AIアシスタントを開く"
        style={{
          position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)',
          width: 28, height: 64, zIndex: PANEL_Z_INDEX,
          background: '#fff', border: '1px solid #e0e0e0', borderRight: 'none',
          borderRadius: '6px 0 0 6px', boxShadow: '-2px 0 4px rgba(0,0,0,0.08)',
          cursor: 'pointer', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 2, padding: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1a73e8' }}>AI</span>
        <svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 6 9 12 15 18" />
        </svg>
      </button>
    );
  }

  return (
    <div
      data-pan-disabled="true"
      style={{
        position: 'fixed', right: 0, top: 0, height: '100%',
        width: isCompactWidth ? '100%' : width,
        background: '#fff',
        borderLeft: isCompactWidth ? 'none' : '1px solid #e0e0e0',
        boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
        zIndex: PANEL_Z_INDEX,
        transition: isResizing ? 'none' : 'width 0.2s ease',
        display: 'flex', flexDirection: 'column',
        cursor: 'default',
        colorScheme: 'light', color: '#333',
      }}
    >
      {/* 幅リサイズハンドル — 左端（コンパクト幅では非表示） */}
      {!isCompactWidth && (
        <div
          data-pan-disabled="true"
          role="separator"
          aria-orientation="vertical"
          aria-label="AIチャットパネルの幅を変更"
          title="ドラッグで幅を変更（ダブルクリックで既定値）"
          onMouseDown={e => { e.preventDefault(); onResizeStart(e); }}
          onDoubleClick={onResetWidth}
          style={{
            position: 'absolute', left: -3, top: 0, width: 6, height: '100%',
            cursor: 'ew-resize', zIndex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none',
          }}
        >
          <div style={{ width: 3, height: 32, borderRadius: 2, background: isResizing ? '#a0a0a0' : 'transparent' }} />
        </div>
      )}

      {/* ヘッダ */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#333', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          AIアシスタント
          {mode !== null && (
            <span
              title={mode === 'byok' ? 'あなたのAPIキーで実行中（ブラウザからOpenRouterへ直接接続）' : 'サイト提供のAIで実行中'}
              style={{
                fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 9,
                color: mode === 'byok' ? '#1b7f37' : '#6b5b95',
                background: mode === 'byok' ? '#e7f5ec' : '#f1edf9',
                border: `1px solid ${mode === 'byok' ? '#c2e5cf' : '#ddd3f0'}`,
                whiteSpace: 'nowrap',
              }}
            >{mode === 'byok' ? '自分のキー' : 'サイト提供'}</span>
          )}
        </span>
        {/* 会話セッション一覧 */}
        <div ref={sessionsRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowSessions(v => !v)}
            title="会話の一覧"
            aria-label="会話の一覧"
            style={{ background: showSessions ? '#eef3ff' : 'transparent', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', padding: '3px 6px', display: 'flex', alignItems: 'center' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="#666"><path d="M280-240q-17 0-28.5-11.5T240-280v-80h520v-360h80q17 0 28.5 11.5T880-680v600L720-240H280Zm-40-160L80-240v-560q0-17 11.5-28.5T120-840h520q17 0 28.5 11.5T680-800v360q0 17-11.5 28.5T640-400H240Z"/></svg>
          </button>
          {showSessions && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 280, maxHeight: '50vh', overflowY: 'auto',
              background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 5,
            }}>
              <button
                onClick={() => { onClear(); setShowSessions(false); }}
                style={{ width: '100%', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#1a73e8', background: '#f5f8ff', border: 'none', borderBottom: '1px solid #eee', padding: '8px 10px', cursor: 'pointer' }}
              >+ 新しい会話</button>
              {sessions.length === 0 && (
                <div style={{ padding: '10px', fontSize: 11.5, color: '#999' }}>保存された会話はまだありません</div>
              )}
              {sessions.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: '1px solid #f4f4f4', background: s.id === activeSessionId ? '#f5f8ff' : 'transparent' }}>
                  {editingSessionId === s.id ? (
                    <input
                      type="text"
                      value={sessionTitleInput}
                      autoFocus
                      onChange={e => setSessionTitleInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitSessionTitle(s.id);
                        if (e.key === 'Escape') { e.stopPropagation(); setEditingSessionId(null); }
                      }}
                      onBlur={() => commitSessionTitle(s.id)}
                      placeholder="タイトル（空にすると自動）"
                      style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '4px 8px', border: '1px solid #1a73e8', borderRadius: 4, outline: 'none', fontFamily: 'inherit', color: '#333', background: '#fff' }}
                    />
                  ) : (
                    <button
                      onClick={() => { onSwitchSession(s.id); setShowSessions(false); }}
                      disabled={sending}
                      title={s.title}
                      style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: sending ? 'default' : 'pointer' }}
                    >
                      <div style={{ fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                      <div style={{ fontSize: 10.5, color: '#999' }}>{relativeTime(s.ts)}・{s.messageCount}件</div>
                    </button>
                  )}
                  <button
                    onClick={() => { setEditingSessionId(s.id); setSessionTitleInput(s.title); }}
                    disabled={sending}
                    title="タイトルを変更"
                    aria-label="タイトルを変更"
                    style={{ background: 'transparent', border: 'none', padding: 2, cursor: sending ? 'default' : 'pointer', color: '#888', fontSize: 11, flexShrink: 0 }}
                  >変更</button>
                  <button
                    onClick={() => onDeleteSession(s.id)}
                    disabled={sending}
                    title="この会話を削除"
                    aria-label="この会話を削除"
                    style={{ background: 'transparent', border: 'none', padding: 2, cursor: sending ? 'default' : 'pointer', color: '#c66', fontSize: 11, flexShrink: 0 }}
                  >削除</button>
                </div>
              ))}
              <div style={{ padding: '6px 10px', fontSize: 10.5, color: '#aaa' }}>会話はこのブラウザにのみ保存されます</div>
            </div>
          )}
        </div>
        <button
          onClick={() => (showSettings ? setShowSettings(false) : openSettings())}
          title="APIキー設定"
          aria-label="APIキー設定"
          style={{ background: showSettings ? '#eef3ff' : 'transparent', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', padding: '3px 6px', display: 'flex', alignItems: 'center' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="#666"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm112-260q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Z"/></svg>
        </button>
        {messages.length > 0 && (
          <button
            onClick={onClear}
            disabled={sending}
            title="新しい会話を開始（この会話は一覧に残ります）"
            style={{ fontSize: 11, color: '#888', background: 'transparent', border: '1px solid #ddd', borderRadius: 4, padding: '3px 8px', cursor: sending ? 'default' : 'pointer' }}
          >クリア</button>
        )}
        <button
          onClick={onToggle}
          title="パネルを閉じる"
          aria-label="パネルを閉じる"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Markdown 描画用スタイル（メッセージごとではなくパネルで1回だけ描画する） */}
      <style>{CHAT_MARKDOWN_STYLES}</style>

      {/* APIキー設定ビュー（表示中はメッセージリストを隠す） */}
      {showSettings && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', fontSize: 12, color: '#444', lineHeight: 1.7 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#333', marginBottom: 8 }}>あなたのAPIキーで使う</div>
          <p style={{ margin: '0 0 10px' }}>
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: '#1a73e8' }}>OpenRouter</a> のAPIキーを登録すると、AIチャットをあなたのアカウントで実行できます。
          </p>
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: '#666' }}>
            <li>キーは<b>このブラウザ（IndexedDB）にのみ保存</b>され、当サイトのサーバーには送信されません（ブラウザからOpenRouterへ直接接続します）</li>
            <li>会話の本文が当サイトのサーバーへ送られることはありません（データ検索時は<b>検索キーワードのみ</b>公開データAPIに送られます）</li>
            <li>万一に備え、OpenRouter側で<b>利用上限（クレジット制限）を設定したキー</b>のご利用を推奨します</li>
          </ul>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#777', marginBottom: 3 }}>APIキー{mode === 'byok' && '（登録済み。変更する場合のみ入力）'}</span>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="sk-or-…"
              autoComplete="off"
              disabled={settingsBusy}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, outline: 'none', fontFamily: 'inherit', color: '#333', background: '#fff' }}
            />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#777', marginBottom: 3 }}>モデル（OpenRouterのモデルID）</span>
            <input
              type="text"
              value={modelInput}
              onChange={e => setModelInput(e.target.value)}
              placeholder={defaultByokModel}
              autoComplete="off"
              disabled={settingsBusy}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, outline: 'none', fontFamily: 'inherit', color: '#333', background: '#fff' }}
            />
            <span style={{ display: 'block', fontSize: 10.5, color: '#999', marginTop: 3 }}>
              空欄なら既定（{defaultByokModel}）。ツール呼び出し（function calling）対応モデルが必要です
            </span>
          </label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button
              onClick={handleSave}
              disabled={settingsBusy || !canSave}
              style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#fff', background: settingsBusy || !canSave ? '#9e9e9e' : '#1a73e8', border: 'none', borderRadius: 6, padding: '8px 0', cursor: settingsBusy || !canSave ? 'default' : 'pointer' }}
            >保存</button>
            <button
              onClick={handleTest}
              disabled={settingsBusy || !keyInput.trim()}
              style={{ fontSize: 12, color: '#1a73e8', background: '#fff', border: '1px solid #1a73e8', borderRadius: 6, padding: '8px 14px', cursor: settingsBusy || !keyInput.trim() ? 'default' : 'pointer', opacity: settingsBusy || !keyInput.trim() ? 0.5 : 1 }}
            >テスト</button>
            {mode === 'byok' && (
              <button
                onClick={handleDelete}
                disabled={settingsBusy}
                style={{ fontSize: 12, color: '#c62828', background: '#fff', border: '1px solid #e5b4b0', borderRadius: 6, padding: '8px 14px', cursor: settingsBusy ? 'default' : 'pointer' }}
              >削除</button>
            )}
          </div>
          {settingsStatus && (
            <div style={{ fontSize: 11.5, color: settingsStatus.kind === 'ok' ? '#1b7f37' : '#c62828', marginBottom: 8 }}>
              {settingsStatus.text}
            </div>
          )}
          <button
            onClick={() => setShowSettings(false)}
            style={{ fontSize: 11.5, color: '#777', background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0', textDecoration: 'underline' }}
          >チャットに戻る</button>
        </div>
      )}

      {/* メッセージリスト */}
      {!showSettings && (
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 4px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && mode === null && (
          <div style={{ fontSize: 12, color: '#777', lineHeight: 1.7 }}>
            <p style={{ margin: '0 0 8px' }}>
              AIチャットを使うには OpenRouter のAPIキーの登録が必要です。
              キーはこのブラウザにのみ保存され、当サイトのサーバーには送信されません。
            </p>
            <button
              onClick={openSettings}
              style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: '#1a73e8', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' }}
            >APIキーを設定する</button>
          </div>
        )}
        {messages.length === 0 && mode !== null && (
          <div style={{ fontSize: 12, color: '#777', lineHeight: 1.7 }}>
            <p style={{ margin: '0 0 8px' }}>
              見たい条件やデータへの質問を自然な言葉でどうぞ。
              図の絞り込み条件の組み立てのほか、金額・品質スコア・再委託・年度比較の質問に答えます。
              絞り込みは件数を確認してから図に反映できます。
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {EXAMPLE_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => setInput(p)}
                  style={{ textAlign: 'left', fontSize: 12, color: '#1a73e8', background: '#f5f8ff', border: '1px solid #dbe6ff', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', lineHeight: 1.5 }}
                >{p}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '88%',
              padding: '7px 11px',
              borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
              background: m.role === 'user' ? '#e8f0fe' : m.isError ? '#fdecea' : '#f4f4f4',
              color: m.isError ? '#c62828' : '#333',
              fontSize: 13, lineHeight: 1.6,
              // assistant の通常応答は Markdown が段落を扱うため pre-wrap にしない（二重改行を防ぐ）
              whiteSpace: m.role === 'assistant' && !m.isError ? 'normal' : 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {m.role === 'assistant' && !m.isError
                ? (
                  <Suspense fallback={<span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>}>
                    <ChatMarkdown text={m.content} />
                  </Suspense>
                )
                : m.content}
            </div>
            {m.role === 'assistant' && !m.isError && (
              <div style={{ display: 'flex', gap: 10, marginTop: 3, paddingLeft: 4 }}>
                <button
                  onClick={() => handleCopyMessage(i, m.content)}
                  title="この応答をMarkdownでコピー"
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#999', fontSize: 10.5, textDecoration: 'underline' }}
                >{copiedMsgIndex === i ? 'コピーしました' : 'コピー'}</button>
                <button
                  onClick={() => handleSaveReport(i, m.content)}
                  title="この応答を発見メモ（履歴パネル）に保存"
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: '#999', fontSize: 10.5, textDecoration: 'underline' }}
                >{savedMsgIndex === i ? '保存しました' : 'メモに保存'}</button>
              </div>
            )}
            {m.result && (
              <div style={{ marginTop: 6, maxWidth: '88%', minWidth: '70%', border: '1px solid #dbe6ff', borderRadius: 8, background: '#f9fbff', padding: '8px 11px', fontSize: 12 }}>
                {m.result.interpretation && (
                  <div style={{ marginBottom: 6, fontSize: 11, color: '#777' }}>
                    解釈: {m.result.interpretation}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, color: '#444' }}>
                  <div>マッチ事業: <b>{m.result.summary.projects.count.toLocaleString()}件</b>（予算 {formatYen(m.result.summary.projects.budgetTotal)}）</div>
                  <div>支出先: <b>{m.result.summary.recipients.count.toLocaleString()}件</b> ／ 府省庁: <b>{m.result.summary.ministries.count}</b></div>
                </div>
                <button
                  onClick={() => onApplyResult(m.result!)}
                  disabled={m.result.summary.projects.count === 0}
                  style={{ marginTop: 8, width: '100%', fontSize: 12, fontWeight: 600, color: '#fff', background: m.result.summary.projects.count > 0 ? '#1a73e8' : '#9e9e9e', border: 'none', borderRadius: 6, padding: '7px 0', cursor: m.result.summary.projects.count > 0 ? 'pointer' : 'default' }}
                >この条件で図を表示</button>
              </div>
            )}
            {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && (
              <div style={{ marginTop: 6, maxWidth: '88%', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {m.suggestions.map((s, si) => (
                  <button
                    key={si}
                    onClick={() => submitSuggestion(s)}
                    disabled={sending}
                    title={s}
                    style={{
                      fontSize: 11.5, color: '#1a73e8', background: '#f5f8ff', border: '1px solid #dbe6ff',
                      borderRadius: 14, padding: '4px 10px', cursor: sending ? 'default' : 'pointer',
                      opacity: sending ? 0.6 : 1,
                    }}
                  >{s}</button>
                ))}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#888', fontSize: 12, padding: '2px 4px' }}>
            <span style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid #d0d0d0', borderTopColor: '#1a73e8',
              animation: 'ai-chat-spin 0.9s linear infinite', display: 'inline-block',
            }} />
            {progressLabel(progress)}
            <style>{'@keyframes ai-chat-spin { to { transform: rotate(360deg); } }'}</style>
          </div>
        )}
      </div>
      )}

      {/* レポート化ボタン — 調査（assistant応答あり）が進んだ会話でのみ表示 */}
      {!showSettings && mode !== null && !sending && messages.some(m => m.role === 'assistant' && !m.isError) && (
        <div style={{ flexShrink: 0, padding: '6px 10px 0' }}>
          <button
            onClick={() => onSend(REPORT_PROMPT)}
            title="ここまでの会話を、出典付きのレポートにまとめます"
            style={{
              width: '100%', fontSize: 11.5, color: '#1a73e8', background: '#f5f8ff',
              border: '1px solid #dbe6ff', borderRadius: 6, padding: '6px 10px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" height="13" width="13" viewBox="0 -960 960 960" fill="#1a73e8"><path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520Z"/></svg>
            この会話をレポートにまとめる
          </button>
        </div>
      )}

      {/* 入力欄 */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #f0f0f0', padding: 10, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            // Escape はページ全体のノード選択解除ショートカットに奪わせない
            if (e.key === 'Escape') { e.stopPropagation(); return; }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={mode === null ? 'APIキーを設定すると利用できます' : '例: 再エネ関連で予算100億円以上'}
          rows={2}
          disabled={sending || mode === null}
          style={{
            flex: 1, minWidth: 0, resize: 'none', fontSize: 13, lineHeight: 1.5,
            padding: '7px 10px', border: '1px solid #ddd', borderRadius: 8,
            outline: 'none', fontFamily: 'inherit', background: sending || mode === null ? '#fafafa' : '#fff',
            boxSizing: 'border-box', color: '#333',
          }}
        />
        <button
          onClick={submit}
          disabled={sending || !input.trim() || mode === null}
          title="送信（Enter）"
          aria-label="送信"
          style={{
            width: 36, height: 36, flexShrink: 0, borderRadius: 8, border: 'none',
            background: sending || !input.trim() || mode === null ? '#e0e0e0' : '#1a73e8',
            cursor: sending || !input.trim() || mode === null ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="18" width="18" viewBox="0 -960 960 960" fill="#fff"><path d="M120-160v-640l760 320-760 320Zm72-110 474-210-474-210v147l240 63-240 63v147Zm0 0v-420 420Z"/></svg>
        </button>
      </div>
    </div>
  );
}
