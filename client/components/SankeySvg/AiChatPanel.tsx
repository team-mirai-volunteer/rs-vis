'use client';

/**
 * サンキーAIチャットパネル（/sankey-svg 右側）。
 *
 * 表示専用コンポーネント: API 呼び出し・チャット状態の保持・結果の適用はすべて
 * page.tsx がコールバック経由で行う（client/components は直接APIコール禁止）。
 * AI の結果は自動適用せず、結果カードの「この条件で図を表示」で明示適用する。
 *
 * 配色はデザインシステムのトークン（bg-card / mirai-surface / primary）で統一し、
 * インライン style は位置・幅・フォントサイズなどレイアウトにのみ使う。
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ChevronLeft, FileText, Loader2, MessagesSquare, Send, Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
  /**
   * 意見インタビューの対象事業（事業ノードを選択中のときだけ非 null）。
   * 設定されていれば入力欄の上に「この事業に意見を伝える」導線を出す（コメント機能の主導線）
   */
  opinionTarget?: { pid: string; name: string } | null;
  /** 意見インタビューを開く（page 側で InterviewDialog を出す） */
  onStartOpinionInterview?: () => void;
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

/** ヘッダの小さなアイコンボタン（会話一覧・設定）。選択中はティールで示す */
const HEADER_ICON_BUTTON_CLASS = 'rounded-md border-mirai-border text-mirai-text-subtle shadow-none';
const HEADER_ICON_BUTTON_ACTIVE_CLASS = 'border-primary bg-mirai-surface-teal text-primary-accent hover:bg-mirai-surface-teal';

/** パネル内のテキスト入力欄（設定ビュー・セッション名編集） */
const INPUT_CLASS =
  'w-full min-w-0 rounded-md border border-mirai-border bg-card px-2.5 py-1.5 text-xs text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary disabled:bg-mirai-surface';

/** 文中の小さなテキストリンク風ボタン（コピー・メモに保存・チャットに戻る 等） */
const TEXT_LINK_CLASS = 'font-normal text-mirai-text-muted hover:text-mirai-text hover:opacity-100';

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
  opinionTarget = null, onStartOpinionInterview,
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
      <Button
        variant="ghost"
        data-pan-disabled="true"
        onClick={onToggle}
        title="AIアシスタントを開く"
        aria-label="AIアシスタントを開く"
        className="h-16 w-7 flex-col gap-0.5 rounded-none rounded-l-md border border-r-0 border-mirai-border bg-card p-0 text-mirai-text-muted shadow-xs hover:bg-mirai-surface hover:text-mirai-text"
        style={{
          position: 'fixed', right: 0, top: '50%', transform: 'translateY(-50%)',
          zIndex: PANEL_Z_INDEX,
        }}
      >
        <span className="text-[11px] font-bold text-primary-accent">AI</span>
        <ChevronLeft className="size-4" strokeWidth={2.5} aria-hidden="true" />
      </Button>
    );
  }

  return (
    <div
      data-pan-disabled="true"
      className={cn(
        'flex flex-col bg-card text-mirai-text shadow-soft',
        !isCompactWidth && 'border-l border-mirai-border',
      )}
      style={{
        position: 'fixed', right: 0, top: 0, height: '100%',
        width: isCompactWidth ? '100%' : width,
        zIndex: PANEL_Z_INDEX,
        transition: isResizing ? 'none' : 'width 0.2s ease',
        cursor: 'default',
        colorScheme: 'light',
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
          <div className={cn('h-8 w-[3px] rounded-sm', isResizing ? 'bg-mirai-border-light' : 'bg-transparent')} />
        </div>
      )}

      {/* ヘッダ */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-bold text-mirai-text">
          AIアシスタント
          {mode !== null && (
            <Badge
              variant="outline"
              title={mode === 'byok' ? 'あなたのAPIキーで実行中（ブラウザからOpenRouterへ直接接続）' : 'サイト提供のAIで実行中'}
              className={cn(
                'rounded-full px-1.5 py-0 text-[10px] font-bold',
                mode === 'byok'
                  ? 'border-primary bg-stance-for-bg text-primary-accent'
                  : 'border-mirai-border bg-mirai-surface-light text-mirai-text-secondary',
              )}
            >{mode === 'byok' ? '自分のキー' : 'サイト提供'}</Badge>
          )}
        </span>
        {/* 会話セッション一覧 */}
        <div ref={sessionsRef} style={{ position: 'relative' }}>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setShowSessions(v => !v)}
            title="会話の一覧"
            aria-label="会話の一覧"
            aria-expanded={showSessions}
            className={cn(HEADER_ICON_BUTTON_CLASS, showSessions && HEADER_ICON_BUTTON_ACTIVE_CLASS)}
          >
            <MessagesSquare aria-hidden="true" />
          </Button>
          {showSessions && (
            <div
              className="rounded-xl border border-mirai-border bg-card shadow-soft"
              style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 280, maxHeight: '50vh', overflowY: 'auto',
                zIndex: 5,
              }}
            >
              <Button
                variant="ghost"
                onClick={() => { onClear(); setShowSessions(false); }}
                className="h-auto w-full justify-start rounded-none rounded-t-xl border-b border-border bg-mirai-surface-teal px-2.5 py-2 text-xs font-bold text-primary-accent hover:bg-mirai-surface-teal hover:text-primary-accent"
              >+ 新しい会話</Button>
              {sessions.length === 0 && (
                <div className="p-2.5 text-[11.5px] text-mirai-text-muted">保存された会話はまだありません</div>
              )}
              {sessions.map(s => (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center gap-1.5 border-b border-border px-2.5 py-[7px]',
                    s.id === activeSessionId ? 'bg-mirai-surface-teal' : 'bg-transparent',
                  )}
                >
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
                      className={cn(INPUT_CLASS, 'flex-1 border-primary px-2 py-1')}
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => { onSwitchSession(s.id); setShowSessions(false); }}
                      disabled={sending}
                      title={s.title}
                      className="h-auto min-w-0 flex-1 flex-col items-start rounded-md p-0 text-left font-normal hover:bg-transparent disabled:opacity-100"
                    >
                      <span className="block w-full truncate text-xs text-mirai-text">{s.title}</span>
                      <span className="block text-[10.5px] text-mirai-text-muted">{relativeTime(s.ts)}・{s.messageCount}件</span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => { setEditingSessionId(s.id); setSessionTitleInput(s.title); }}
                    disabled={sending}
                    title="タイトルを変更"
                    aria-label="タイトルを変更"
                    className="h-auto shrink-0 rounded-md p-0.5 text-[11px] font-normal text-mirai-text-muted hover:bg-transparent hover:text-mirai-text"
                  >変更</Button>
                  <Button
                    variant="ghost"
                    onClick={() => onDeleteSession(s.id)}
                    disabled={sending}
                    title="この会話を削除"
                    aria-label="この会話を削除"
                    className="h-auto shrink-0 rounded-md p-0.5 text-[11px] font-normal text-destructive hover:bg-transparent hover:text-destructive"
                  >削除</Button>
                </div>
              ))}
              <div className="px-2.5 py-1.5 text-[10.5px] text-mirai-text-placeholder">会話はこのブラウザにのみ保存されます</div>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => (showSettings ? setShowSettings(false) : openSettings())}
          title="APIキー設定"
          aria-label="APIキー設定"
          aria-expanded={showSettings}
          className={cn(HEADER_ICON_BUTTON_CLASS, showSettings && HEADER_ICON_BUTTON_ACTIVE_CLASS)}
        >
          <Settings aria-hidden="true" />
        </Button>
        {messages.length > 0 && (
          <Button
            variant="outline"
            size="xs"
            onClick={onClear}
            disabled={sending}
            title="新しい会話を開始（この会話は一覧に残ります）"
            className="rounded-md border-mirai-border text-[11px] font-normal text-mirai-text-muted shadow-none hover:text-mirai-text"
          >クリア</Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          title="パネルを閉じる"
          aria-label="パネルを閉じる"
          className="text-mirai-text-muted hover:text-mirai-text"
        >
          <X className="size-[18px]" strokeWidth={2.5} aria-hidden="true" />
        </Button>
      </div>

      {/* Markdown 描画用スタイル（メッセージごとではなくパネルで1回だけ描画する） */}
      <style>{CHAT_MARKDOWN_STYLES}</style>

      {/* APIキー設定ビュー（表示中はメッセージリストを隠す） */}
      {showSettings && (
        <div className="flex-1 overflow-y-auto px-3.5 pb-2 pt-3.5 text-xs leading-relaxed text-mirai-text-secondary">
          <div className="mb-2 text-[13px] font-bold text-mirai-text">あなたのAPIキーで使う</div>
          <p className="mb-2.5">
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary-accent">OpenRouter</a> のAPIキーを登録すると、AIチャットをあなたのアカウントで実行できます。
          </p>
          <ul className="mb-3 list-disc pl-[18px] text-mirai-text-subtle">
            <li>キーは<b>このブラウザ（IndexedDB）にのみ保存</b>され、当サイトのサーバーには送信されません（ブラウザからOpenRouterへ直接接続します）</li>
            <li>会話の本文が当サイトのサーバーへ送られることはありません（データ検索時は<b>検索キーワードのみ</b>公開データAPIに送られます）</li>
            <li>万一に備え、OpenRouter側で<b>利用上限（クレジット制限）を設定したキー</b>のご利用を推奨します</li>
          </ul>
          <label className="mb-2.5 block">
            <span className="mb-0.5 block text-[11px] text-mirai-text-subtle">APIキー{mode === 'byok' && '（登録済み。変更する場合のみ入力）'}</span>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="sk-or-…"
              autoComplete="off"
              disabled={settingsBusy}
              className={INPUT_CLASS}
            />
          </label>
          <label className="mb-3 block">
            <span className="mb-0.5 block text-[11px] text-mirai-text-subtle">モデル（OpenRouterのモデルID）</span>
            <input
              type="text"
              value={modelInput}
              onChange={e => setModelInput(e.target.value)}
              placeholder={defaultByokModel}
              autoComplete="off"
              disabled={settingsBusy}
              className={INPUT_CLASS}
            />
            <span className="mt-0.5 block text-[10.5px] text-mirai-text-muted">
              空欄なら既定（{defaultByokModel}）。ツール呼び出し（function calling）対応モデルが必要です
            </span>
          </label>
          <div className="mb-2 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={settingsBusy || !canSave}
              className="flex-1 border-primary text-xs text-primary-accent hover:bg-mirai-surface-teal"
            >保存</Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={settingsBusy || !keyInput.trim()}
              className="border-mirai-border text-xs"
            >テスト</Button>
            {mode === 'byok' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={settingsBusy}
                className="border-destructive text-xs text-destructive hover:bg-stance-against-bg"
              >削除</Button>
            )}
          </div>
          {settingsStatus && (
            <div className={cn('mb-2 text-[11.5px]', settingsStatus.kind === 'ok' ? 'text-primary-accent' : 'text-destructive')}>
              {settingsStatus.text}
            </div>
          )}
          <Button
            variant="link"
            onClick={() => setShowSettings(false)}
            className={cn(TEXT_LINK_CLASS, 'py-1 text-[11.5px] text-mirai-text-subtle')}
          >チャットに戻る</Button>
        </div>
      )}

      {/* メッセージリスト */}
      {!showSettings && (
      <div ref={listRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-1 pt-3">
        {messages.length === 0 && mode === null && (
          <div className="text-xs leading-relaxed text-mirai-text-subtle">
            <p className="mb-2">
              AIチャットを使うには OpenRouter のAPIキーの登録が必要です。
              キーはこのブラウザにのみ保存され、当サイトのサーバーには送信されません。
            </p>
            <Button
              variant="default"
              size="sm"
              onClick={openSettings}
              className="text-xs"
            >APIキーを設定する</Button>
          </div>
        )}
        {messages.length === 0 && mode !== null && (
          <div className="text-xs leading-relaxed text-mirai-text-subtle">
            <p className="mb-2">
              見たい条件やデータへの質問を自然な言葉でどうぞ。
              図の絞り込み条件の組み立てのほか、金額・品質スコア・再委託・年度比較の質問に答えます。
              絞り込みは件数を確認してから図に反映できます。
            </p>
            <div className="flex flex-col gap-1.5">
              {EXAMPLE_PROMPTS.map(p => (
                <Button
                  key={p}
                  variant="outline"
                  onClick={() => setInput(p)}
                  className="h-auto justify-start whitespace-normal rounded-md border-mirai-border bg-mirai-surface px-2.5 py-1.5 text-left text-xs font-normal leading-normal text-primary-accent shadow-none hover:border-primary hover:bg-mirai-surface-teal"
                >{p}</Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'max-w-[88%] px-[11px] py-[7px] text-[13px] leading-relaxed',
                m.role === 'user'
                  ? 'rounded-[12px_12px_3px_12px] bg-mirai-surface-teal text-mirai-text'
                  : m.isError
                    ? 'rounded-[12px_12px_12px_3px] bg-stance-against-bg text-stance-against'
                    : 'rounded-[12px_12px_12px_3px] bg-mirai-surface text-mirai-text',
              )}
              style={{
                // assistant の通常応答は Markdown が段落を扱うため pre-wrap にしない（二重改行を防ぐ）
                whiteSpace: m.role === 'assistant' && !m.isError ? 'normal' : 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.role === 'assistant' && !m.isError
                ? (
                  <Suspense fallback={<span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>}>
                    <ChatMarkdown text={m.content} />
                  </Suspense>
                )
                : m.content}
            </div>
            {m.role === 'assistant' && !m.isError && (
              <div className="mt-[3px] flex gap-2.5 pl-1">
                <Button
                  variant="link"
                  onClick={() => handleCopyMessage(i, m.content)}
                  title="この応答をMarkdownでコピー"
                  className={cn(TEXT_LINK_CLASS, 'text-[10.5px]')}
                >{copiedMsgIndex === i ? 'コピーしました' : 'コピー'}</Button>
                <Button
                  variant="link"
                  onClick={() => handleSaveReport(i, m.content)}
                  title="この応答を発見メモ（履歴パネル）に保存"
                  className={cn(TEXT_LINK_CLASS, 'text-[10.5px]')}
                >{savedMsgIndex === i ? '保存しました' : 'メモに保存'}</Button>
              </div>
            )}
            {m.result && (
              <div className="mt-1.5 min-w-[70%] max-w-[88%] rounded-xl border border-mirai-border bg-card px-[11px] py-2 text-xs shadow-xs">
                {m.result.interpretation && (
                  <div className="mb-1.5 text-[11px] text-mirai-text-subtle">
                    解釈: {m.result.interpretation}
                  </div>
                )}
                <div className="flex flex-col gap-[3px] text-mirai-text-secondary">
                  <div>マッチ事業: <b>{m.result.summary.projects.count.toLocaleString()}件</b>（予算 {formatYen(m.result.summary.projects.budgetTotal)}）</div>
                  <div>支出先: <b>{m.result.summary.recipients.count.toLocaleString()}件</b> ／ 府省庁: <b>{m.result.summary.ministries.count}</b></div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onApplyResult(m.result!)}
                  disabled={m.result.summary.projects.count === 0}
                  className="mt-2 h-8 w-full border-primary text-xs text-primary-accent hover:bg-mirai-surface-teal"
                >この条件で図を表示</Button>
              </div>
            )}
            {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && (
              <div className="mt-1.5 flex max-w-[88%] flex-wrap gap-1.5">
                {m.suggestions.map((s, si) => (
                  <Button
                    key={si}
                    variant="outline"
                    size="xs"
                    onClick={() => submitSuggestion(s)}
                    disabled={sending}
                    title={s}
                    className="h-auto whitespace-normal border-mirai-border bg-card px-2.5 py-1 text-left text-[11.5px] font-normal leading-normal text-primary-accent shadow-none hover:border-primary hover:bg-mirai-surface-teal"
                  >{s}</Button>
                ))}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 px-1 py-0.5 text-xs text-mirai-text-muted" role="status">
            <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
            {progressLabel(progress)}
          </div>
        )}
      </div>
      )}

      {/* レポート化ボタン — 調査（assistant応答あり）が進んだ会話でのみ表示 */}
      {!showSettings && mode !== null && !sending && messages.some(m => m.role === 'assistant' && !m.isError) && (
        <div className="shrink-0 px-2.5 pt-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={() => onSend(REPORT_PROMPT)}
            title="ここまでの会話を、出典付きのレポートにまとめます"
            className="h-auto w-full gap-1.5 rounded-md border-mirai-border bg-mirai-surface px-2.5 py-1.5 text-[11.5px] font-normal text-primary-accent shadow-none hover:border-primary hover:bg-mirai-surface-teal"
          >
            <FileText className="size-[13px]" aria-hidden="true" />
            この会話をレポートにまとめる
          </Button>
        </div>
      )}

      {/* 意見インタビューへの導線（事業選択中のみ）。解説チャットと混同させないため別枠・別配色で出す */}
      {opinionTarget && onStartOpinionInterview && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-2.5 pt-1.5">
          <span className="min-w-0 flex-1 truncate text-[11px] text-mirai-text-muted" title={opinionTarget.name}>
            選択中: {opinionTarget.name}
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={onStartOpinionInterview}
            title="この事業への意見をAIインタビューで伝える（匿名・公開は最後に確認）"
            className="h-auto shrink-0 border-primary bg-stance-for-bg px-2.5 py-[3px] text-[11px] text-primary-accent shadow-none hover:bg-mirai-surface-teal"
          >
            この事業に意見を伝える
          </Button>
        </div>
      )}

      {/* 入力欄 */}
      <div className="flex shrink-0 items-end gap-2 border-t border-border p-2.5">
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
          className="min-w-0 flex-1 resize-none rounded-lg border border-mirai-border bg-card px-2.5 py-[7px] text-[13px] leading-normal text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary disabled:bg-mirai-surface"
        />
        <Button
          variant="default"
          size="icon"
          onClick={submit}
          disabled={sending || !input.trim() || mode === null}
          title="送信（Enter）"
          aria-label="送信"
          className="shrink-0"
        >
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
