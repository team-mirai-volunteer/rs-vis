'use client';

/**
 * 統合ビュー用の AI 絞り込みチャット（試作）。
 *
 * 自然文で聞くと、既存の AI エージェント（app/lib/ai/chat-core）が SankeyQuery を組み立て、
 * その結果を統合ビューのフィルターへ写す。検索ピルの「AI」から、検索クラスタの直下に開く。
 * 実行モードは BYOK（訪問者の OpenRouter キー・ブラウザ直）を優先し、無ければサイト提供の
 * /api/ai/sankey-chat を使う（環境変数で有効な場合のみ）。
 *
 * 見た目はチームみらいデザインシステム（.claude/skills/design-system）。カードは rounded-2xl +
 * border-mirai-border + shadow-soft、ヘッダー帯は bg-mirai-surface-teal、主 CTA（送信）は
 * <Button variant="default">（グラデ + 黒ボーダー）、補助操作は outline / ghost / link。
 * 位置は親（UnifiedSankeyChart の searchPopover）が決める。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, RotateCcw, Send, Settings2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SankeyChatMessage, SankeyChatResponse, SankeyChatResult } from '@/types/sankey-ai-chat';
import type { GraphData } from '@/types/sankey-svg';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { deleteByokSettings, loadByokSettings, saveByokSettings, type ByokSettings } from '@/client/lib/ai/api-key-store';
import { DEFAULT_BYOK_MODEL, testOpenRouterKey } from '@/client/lib/ai/openrouter-caller';
import { runByokChat, LlmUpstreamError } from '@/client/lib/ai/byok-chat';

interface UiMessage { role: 'user' | 'assistant'; content: string; result?: SankeyChatResult; suggestions?: string[]; isError?: boolean }

const AI_YEARS = new Set(['2024', '2025']);
const EXAMPLES = ['再エネ関連で予算100億円以上の事業', '子育て支援で支出先に自治体が多い事業', 'NTTデータが受注している事業'];
/** テキスト入力の共通クラス（InterviewDialog と同系統） */
const INPUT_CLASS =
  'w-full min-w-0 rounded-xl border border-mirai-border bg-card px-3 py-2 text-[13px] leading-relaxed text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

export function AiFilterChat({ open, onClose, year, onApply }: {
  open: boolean; onClose: () => void; year: number;
  /** 結果をフィルターへ写す */
  onApply: (result: SankeyChatResult) => void;
}) {
  const [settings, setSettings] = useState<ByokSettings | null>(null);
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [keyTesting, setKeyTesting] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const graphCache = useRef(new Map<string, GraphData>());
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  useEffect(() => {
    let cancelled = false;
    loadByokSettings().then(s => { if (!cancelled) setSettings(s); });
    fetch('/api/ai/sankey-chat').then(r => { if (!cancelled) setServerEnabled(r.ok); }).catch(() => { if (!cancelled) setServerEnabled(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages, progress]);

  const mode: 'byok' | 'server' | null = settings ? 'byok' : serverEnabled ? 'server' : null;
  const yearKey = String(year);
  const yearSupported = AI_YEARS.has(yearKey);
  const canSend = !!mode && !sending && yearSupported;

  const getGraph = useCallback(async (y: SupportedYear): Promise<GraphData> => {
    const cached = graphCache.current.get(String(y));
    if (cached) return cached;
    const res = await fetch(`/data/sankey-svg-${y}-graph.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${y}年度のデータを取得できませんでした（HTTP ${res.status}）。時間をおいて再度お試しください`);
    const data = await res.json() as GraphData;
    graphCache.current.set(String(y), data);
    return data;
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !canSend) return;
    const history: SankeyChatMessage[] = [...messages.filter(m => !m.isError).map(m => ({ role: m.role, content: m.content })), { role: 'user', content: trimmed }];
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setInput(''); setSending(true); setProgress(null);
    const aborter = new AbortController(); abortRef.current = aborter;
    try {
      if (mode === 'byok' && settings) {
        const r = await runByokChat({ messages: history, context: { year: yearKey as '2024' | '2025' }, settings, getGraph, signal: aborter.signal,
          onProgress: ev => setProgress(ev.kind === 'retry' ? `混雑のため ${Math.ceil((ev as { waitMs: number }).waitMs / 1000)} 秒待って再試行しています` : ev.kind === 'tool' ? '公開データを検索しています' : null) });
        setMessages(prev => [...prev, { role: 'assistant', content: r.message, result: r.result, suggestions: r.suggestions }]);
        if (r.result) onApply(r.result);
      } else {
        const res = await fetch('/api/ai/sankey-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, context: { year: yearKey }, stream: false }), signal: aborter.signal });
        if (!res.ok) { const b = await res.json().catch(() => null) as { error?: string } | null; throw new Error(b?.error ?? `HTTP ${res.status}`); }
        const data = await res.json() as SankeyChatResponse;
        setMessages(prev => [...prev, { role: 'assistant', content: data.message, result: data.result, suggestions: data.suggestions }]);
        if (data.result) onApply(data.result);
      }
    } catch (e) {
      if (aborter.signal.aborted) return;
      const text = e instanceof LlmUpstreamError ? e.message : e instanceof Error ? e.message : 'AIが応答できませんでした';
      setMessages(prev => [...prev, { role: 'assistant', content: `${text}。条件を言い換えるか、時間をおいて再度お試しください`, isError: true }]);
    } finally {
      if (abortRef.current === aborter) abortRef.current = null;
      setSending(false); setProgress(null);
    }
  };

  const saveKey = async () => {
    const apiKey = keyInput.trim() || settings?.apiKey || '';
    if (!apiKey) return;
    const s = { apiKey, model: modelInput.trim() || DEFAULT_BYOK_MODEL };
    try { await saveByokSettings(s); } catch { /* IndexedDB 不可でもこの画面内では使える */ }
    setSettings(s); setKeyInput(''); setKeyMsg(null); setShowSettings(false);
  };
  const testKey = async () => {
    setKeyTesting(true); setKeyMsg(null);
    const r = await testOpenRouterKey(keyInput.trim() || settings?.apiKey || '');
    setKeyMsg(r.ok ? '接続できました' : r.error);
    setKeyTesting(false);
  };
  const forgetKey = async () => {
    try { await deleteByokSettings(); } catch { /* 保存されていなければ何もしない */ }
    setSettings(null); setModelInput(''); setKeyInput(''); setKeyMsg(null);
  };

  if (!open) return null;
  return <section role="dialog" aria-label="AIに聞いて絞り込む" onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
    className="flex h-[min(72vh,640px)] w-[min(440px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-mirai-border bg-card text-[13px] leading-relaxed text-mirai-text shadow-soft">
    {/* ヘッダー帯 */}
    <div className="flex items-center gap-2.5 border-b border-mirai-border bg-mirai-surface-teal px-4 py-3">
      <Sparkles aria-hidden="true" className="size-4 shrink-0 text-primary-accent" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold tracking-normal">AIに聞いて絞り込む</div>
        <div className="truncate text-[11px] text-mirai-text-muted">
          {mode === 'byok' ? `あなたのキー・${settings?.model}` : mode === 'server' ? 'サイト提供のAI' : 'APIキーが未設定'}
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="キーとモデルの設定" aria-pressed={showSettings} title="キーとモデルの設定"
        className={cn('shrink-0 text-mirai-text-subtle hover:bg-card', showSettings && 'bg-card text-primary-accent')}
        onClick={() => { setModelInput(settings?.model ?? ''); setShowSettings(v => !v); }}>
        <Settings2 aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="閉じる" className="shrink-0 text-mirai-text-subtle hover:bg-card" onClick={() => { abortRef.current?.abort(); onClose(); }}>
        <X aria-hidden="true" />
      </Button>
    </div>

    {/* キー・モデル設定 */}
    {(showSettings || mode === null) && <div className="flex flex-col gap-2.5 border-b border-mirai-border bg-mirai-surface p-4">
      <p className="m-0 text-xs leading-relaxed">
        <strong>あなたの OpenRouter API キー</strong>でブラウザから直接動きます。キーはこのブラウザにのみ保存され、このサイトのサーバには送信されません。利用上限を設定したキーの使用をおすすめします。
      </p>
      {settings && <p className="m-0 text-xs text-mirai-text-muted">保存済みのキーがあります。キー欄を空のままにすると、そのキーでモデルだけ更新します。</p>}
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-mirai-text-muted">APIキー{settings && '（変更しない場合は空欄）'}</span>
        <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} autoComplete="off" placeholder={settings ? '保存済みのキーを使う' : 'sk-or-v1-...'} className={INPUT_CLASS} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-mirai-text-muted">モデル（空欄なら {DEFAULT_BYOK_MODEL}）</span>
        <input type="text" value={modelInput} onChange={e => setModelInput(e.target.value)} placeholder={DEFAULT_BYOK_MODEL} className={INPUT_CLASS} />
        <span className="mt-1 block text-[11px] text-mirai-text-muted">OpenRouter のモデルID。存在しないIDだと AI が応答できません。</span>
      </label>
      {keyMsg && <p className={cn('m-0 text-xs font-medium', keyMsg === '接続できました' ? 'text-primary-accent' : 'text-stance-against')}>{keyMsg}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {settings && <Button variant="link" size="xs" className="mr-auto text-stance-against" onClick={forgetKey}>保存済みの設定を削除する</Button>}
        <Button variant="outline" size="xs" disabled={(!keyInput.trim() && !settings) || keyTesting} onClick={testKey}>{keyTesting ? 'テスト中' : '接続テスト'}</Button>
        <Button variant="default" size="xs" disabled={!keyInput.trim() && !settings} onClick={saveKey}>保存する</Button>
      </div>
    </div>}

    {/* 会話ログ */}
    <div ref={logRef} className="flex flex-1 flex-col gap-2.5 overflow-y-auto bg-mirai-surface px-4 py-3">
      {!yearSupported && <p className="m-0 rounded-xl border border-stance-against/30 bg-stance-against-bg px-3 py-2 text-xs leading-relaxed text-stance-against">AI検索は2024・2025年度のデータにだけ対応しています。ヘッダーの年度を切り替えてください。</p>}
      {messages.length === 0 && <div className="space-y-3">
        <p className="m-0 text-xs leading-relaxed text-mirai-text-secondary">条件を自然文で聞くと、当てはまる事業だけを図に残します。適用した条件は検索ピルの「絞込」に反映され、× で外せます。</p>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map(x => <Button key={x} variant="outline" size="xs" disabled={!canSend} onClick={() => void send(x)} className="h-auto whitespace-normal rounded-full py-1.5 text-left font-medium">{x}</Button>)}
        </div>
      </div>}
      {messages.map((m, i) => <div key={i} className={cn(
        'max-w-[88%] whitespace-pre-wrap break-words rounded-2xl border px-3.5 py-2.5',
        m.role === 'user' ? 'self-end rounded-br-md border-primary/30 bg-mirai-surface-teal'
          : m.isError ? 'self-start rounded-bl-md border-stance-against/30 bg-stance-against-bg text-stance-against'
            : 'self-start rounded-bl-md border-mirai-border bg-card',
      )}>
        {m.content}
        {m.result && <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-stance-for-bg px-2.5 py-0.5 text-xs font-medium text-primary-accent">
            <Check aria-hidden="true" className="size-3.5" />図に適用しました
          </span>
          {m.result.interpretation && <span className="text-xs text-mirai-text-muted">{m.result.interpretation}</span>}
          <Button variant="link" size="xs" className="text-xs" onClick={() => onApply(m.result!)}>再適用する</Button>
        </div>}
        {m.suggestions && m.suggestions.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
          {m.suggestions.map(sg => <Button key={sg} variant="outline" size="xs" disabled={sending} onClick={() => void send(sg)} className="h-auto whitespace-normal rounded-full py-1 text-left text-[11px] font-medium">{sg}</Button>)}
        </div>}
      </div>)}
      {sending && <div className="flex items-center gap-1.5 self-start px-1 text-xs text-mirai-text-muted">
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-primary" />{progress ?? '考えています'}
      </div>}
    </div>

    {/* 入力 */}
    <div className="flex flex-col gap-2 border-t border-mirai-border bg-card px-4 py-3">
      <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} rows={2} disabled={!mode || sending || !yearSupported}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(input); } }}
        placeholder={mode ? '例: 再エネ関連で予算100億円以上（Ctrl+Enter で送信）' : 'APIキーを設定すると利用できます'} className={cn(INPUT_CLASS, 'resize-y')} />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-mirai-text-muted">事業名・支出先・所管・金額・再委託の条件に写します。表示数やピンは変えません。</span>
        <Button variant="ghost" size="xs" disabled={messages.length === 0} onClick={() => { abortRef.current?.abort(); setMessages([]); }} title="新しい会話を始める" aria-label="新しい会話を始める">
          <RotateCcw aria-hidden="true" />
        </Button>
        <Button variant="default" size="sm" disabled={!input.trim() || !canSend} onClick={() => void send(input)}>
          <Send aria-hidden="true" />送信する
        </Button>
      </div>
    </div>
  </section>;
}
