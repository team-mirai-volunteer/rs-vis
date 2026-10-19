'use client';

/**
 * AI ナビ（ヘッダーの AI ボタンから開く、全ページ共通の会話パネル）。
 *
 * 自然文で聞くと、AI エージェント（app/lib/ai/chat-core）が公開データをツールで調べ、条件（SankeyQuery）を組み立てる。
 * 結果の扱いはページ次第:
 *   - サンキー図（/budget-sankey）は useAiResultHandler で受け取り手を登録しているので、その場で絞り込みに写す
 *   - 登録の無いページでは「サンキー図で見る」と上位事業の詳細へのリンクで案内する
 * 実行モードは BYOK（訪問者の OpenRouter キー・ブラウザ直）を優先し、無ければサイト提供の /api/ai/sankey-chat（環境変数で有効な場合のみ）。
 * パネルは root layout（AppHeaderProvider）に 1 つだけあるので、ページを移動しても会話は消えない。
 *
 * 見た目はチームみらいデザインシステム。カードは rounded-2xl + border-mirai-border + shadow-soft、ヘッダー帯は bg-mirai-surface-teal、
 * 主 CTA（送信）は <Button variant="default">、補助操作は outline / ghost / link。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ExternalLink, History, LoaderCircle, RotateCcw, Send, Settings2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SankeyChatContext, SankeyChatMessage, SankeyChatResponse, SankeyChatResult } from '@/types/sankey-ai-chat';
import type { GraphData } from '@/types/sankey-svg';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { formatBudgetFromYen } from '@/client/lib/formatBudget';
import { deleteByokSettings, loadByokSettings, saveByokSettings, type ByokSettings } from '@/client/lib/ai/api-key-store';
import { DEFAULT_BYOK_MODEL, testOpenRouterKey } from '@/client/lib/ai/openrouter-caller';
import { runByokChat, LlmUpstreamError } from '@/client/lib/ai/byok-chat';
import { useAiPageStateText, useAiResultTarget } from '@/client/lib/ai/result-handler';
import { projectLinks, sankeyUrlForQuery } from '@/client/lib/ai/result-links';
import { navigateHref, samePath } from '@/client/lib/ai/nav-href';
import {
  deleteAllChatSessions, listChatSessions, loadChatSession, saveChatSession,
  type AiChatUiMessage, type ChatSessionMeta,
} from '@/client/lib/ai/chat-history-store';

type UiMessage = AiChatUiMessage;

const newSessionId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
/** このタブで開いている会話の ID（sessionStorage。タブを閉じると消えるので、開き直したときは新しい会話になる） */
const OPEN_SESSION_KEY = 'ai-nav-open-session';
const readOpenSessionId = (): string | null => { try { return window.sessionStorage.getItem(OPEN_SESSION_KEY); } catch { return null; } };
const writeOpenSessionId = (id: string | null) => { try { if (id) window.sessionStorage.setItem(OPEN_SESSION_KEY, id); else window.sessionStorage.removeItem(OPEN_SESSION_KEY); } catch { /* 保存できない環境では毎回新規 */ } };
const formatSessionTime = (ts: number) => new Date(ts).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const AI_YEARS = new Set(['2024', '2025']);
const EXAMPLES = ['再エネ関連で予算100億円以上の事業', '子育て支援で支出先に自治体が多い事業', 'NTTデータが受注している事業'];
/** 案内リンクに出す上位事業の数 */
const LINKED_PROJECTS = 5;
/** テキスト入力の共通クラス（InterviewDialog と同系統） */
const INPUT_CLASS =
  'w-full min-w-0 rounded-xl border border-mirai-border bg-card px-3 py-2 text-[13px] leading-relaxed text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

export function AiAssistant({ open, onClose, sheetYear, page }: {
  open: boolean;
  onClose: () => void;
  /** RS シート年度。予算年度 N の支出は N+1 年版シートにあるので、予算年度をそのまま渡さない */
  sheetYear: number;
  /** いま開いているページの名前（AI の案内の優先と、見出しの表示に使う） */
  page: string;
}) {
  // このページの受け取り手（無ければ案内リンク）。label は「図」「一覧」など適用先の呼び名
  const target = useAiResultTarget();
  const pageState = useAiPageStateText();
  const dispatch = target?.handler ?? null;
  const targetLabel = target?.label ?? '図';
  const [settings, setSettings] = useState<ByokSettings | null>(null);
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [keyTesting, setKeyTesting] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  // 会話の永続化（このブラウザの IndexedDB）。起動時に直近の会話を復元し、以後は変化のたびに保存する
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());
  const [restored, setRestored] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionMeta[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const graphCache = useRef(new Map<string, GraphData>());
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    let cancelled = false;
    loadByokSettings().then(s => { if (!cancelled) setSettings(s); });
    fetch('/api/ai/sankey-chat').then(r => { if (!cancelled) setServerEnabled(r.ok); }).catch(() => { if (!cancelled) setServerEnabled(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages, progress]);

  // 起動時の復元は「このタブで開いていた会話」だけ（sessionStorage はタブを閉じると消える）。
  // ページ移動・リロードでは続きから、タブやブラウザを閉じて開き直したときは新しい会話から始める。
  // 過去の会話は IndexedDB に残り、「過去の会話」から開ける。保存はこの復元が終わってから（空の初期状態で上書きしないため）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const openId = readOpenSessionId();
      const current = openId ? await loadChatSession(openId) : null;
      if (cancelled) return;
      if (current && current.messages.length > 0) { setSessionId(current.id); setMessages(current.messages); }
      else if (openId) writeOpenSessionId(null);
      setRestored(true);
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!restored || messages.length === 0) return;
    void saveChatSession(sessionId, messages);
    writeOpenSessionId(sessionId);
  }, [restored, sessionId, messages]);

  const openHistory = async () => {
    if (showHistory) { setShowHistory(false); return; }
    setSessions(await listChatSessions());
    setShowHistory(true);
  };
  const switchSession = async (id: string) => {
    const session = await loadChatSession(id);
    abortRef.current?.abort();
    setSessionId(id);
    setMessages(session?.messages ?? []);
    writeOpenSessionId(id);
    setShowHistory(false);
  };
  const startNewSession = () => {
    abortRef.current?.abort();
    setSessionId(newSessionId());
    setMessages([]);
    writeOpenSessionId(null);
    setShowHistory(false);
  };

  const mode: 'byok' | 'server' | null = settings ? 'byok' : serverEnabled ? 'server' : null;
  // AI が条件を考えるのに使う支出データの年度。支出データの無い年度（予算年度2025以降）は最も近い年度で代用し、
  // できた条件（府省・事業名・金額・スコアなど）を表示中の年度の図に当てる
  const ownData = AI_YEARS.has(String(sheetYear));
  const yearKey = (ownData ? String(sheetYear) : String(sheetYear > 2025 ? 2025 : 2024)) as SupportedYear;
  const canSend = !!mode && !sending;

  const getGraph = useCallback(async (y: SupportedYear): Promise<GraphData> => {
    const cached = graphCache.current.get(String(y));
    if (cached) return cached;
    const res = await fetch(`/data/sankey-svg-${y}-graph.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${y}年度のデータを取得できませんでした（HTTP ${res.status}）。時間をおいて再度お試しください`);
    const data = await res.json() as GraphData;
    graphCache.current.set(String(y), data);
    return data;
  }, []);

  // navigate_page で移動したあと、移動先のページが受け取り手を登録したら条件を渡す
  const router = useRouter();
  const pathname = usePathname();
  const pendingResultRef = useRef<SankeyChatResult | null>(null);
  useEffect(() => {
    if (!target || !pendingResultRef.current) return;
    const pending = pendingResultRef.current;
    pendingResultRef.current = null;
    target.handler(pending);
  }, [target]);

  /** 結果をページに渡す。受け取り手が無いページでは案内リンクに任せる（false） */
  const applyResult = (result: SankeyChatResult): boolean => {
    if (!dispatch) return false;
    dispatch(result);
    return true;
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !canSend) return;
    const history: SankeyChatMessage[] = [...messages.filter(m => !m.isError).map(m => ({ role: m.role, content: m.content })), { role: 'user', content: trimmed }];
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setInput(''); setSending(true); setProgress(null);
    const aborter = new AbortController(); abortRef.current = aborter;
    const context: SankeyChatContext = { year: yearKey, page, ...(pageState ? { pageState } : {}) };
    try {
      let reply: { message: string; result?: SankeyChatResult; suggestions?: string[]; navigate?: SankeyChatResponse['navigate'] };
      // 例文 3 つはサーバーに 24 時間の応答キャッシュがあるので、BYOK でもサイト提供 AI が使える環境ならそちらを引く
      // （例文は固定の文言なので、会話をサーバーに送らない BYOK の約束は破らない）。それ以外の BYOK はブラウザ直のまま
      const useServerCache = serverEnabled === true && messages.length === 0 && EXAMPLES.includes(trimmed);
      if (mode === 'byok' && settings && !useServerCache) {
        reply = await runByokChat({ messages: history, context, settings, getGraph, signal: aborter.signal,
          onProgress: ev => setProgress(ev.kind === 'retry' ? `混雑のため ${Math.ceil((ev as { waitMs: number }).waitMs / 1000)} 秒待って再試行しています` : ev.kind === 'tool' ? '公開データを検索しています' : null) });
      } else {
        const res = await fetch('/api/ai/sankey-chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history, context, stream: false }), signal: aborter.signal });
        if (!res.ok) { const b = await res.json().catch(() => null) as { error?: string } | null; throw new Error(b?.error ?? `HTTP ${res.status}`); }
        reply = await res.json() as SankeyChatResponse;
      }
      if (reply.navigate) {
        // ページ遷移。サンキー図は条件を URL に写して開く（ページ側が URL から適用する）。
        // 一覧型のページは移動後に受け取り手が登録されてから dispatch する（pendingResult）
        const navHref = navigateHref(reply.navigate, reply.result, yearKey);
        pendingResultRef.current = reply.navigate.key === 'sankey' ? null : reply.result ?? null;
        setMessages(prev => [...prev, { role: 'assistant', content: reply.message, result: reply.result, applied: true, suggestions: reply.suggestions }]);
        if (samePath(navHref, pathname) && /[?#]/.test(navHref)) {
          // 同じページで条件だけ変える。ページは URL を popstate / hashchange で読み直す（作り直すと入力中の状態が消える）
          const hadHash = window.location.hash !== '';
          window.history.pushState(null, '', navHref);
          window.dispatchEvent(new PopStateEvent('popstate'));
          if (hadHash || navHref.includes('#')) window.dispatchEvent(new HashChangeEvent('hashchange'));
        } else {
          router.push(navHref);
        }
        return;
      }
      const applied = reply.result ? applyResult(reply.result) : undefined;
      setMessages(prev => [...prev, { role: 'assistant', content: reply.message, result: reply.result, applied, suggestions: reply.suggestions }]);
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
    // BYOK 中の会話が後からサイト提供 AI（サーバー経由）へ送られないよう、キー削除時は会話も全部消す
    try { await deleteAllChatSessions(); } catch { /* 非対応環境は何もしない */ }
    setSettings(null); setModelInput(''); setKeyInput(''); setKeyMsg(null);
    startNewSession();
  };

  if (!open) return null;
  return <section role="dialog" aria-label="AIに聞く" data-pan-disabled="true" onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
    className="fixed right-3 top-[var(--app-header-h)] z-[250] flex h-[min(72vh,640px)] w-[min(440px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-mirai-border bg-card text-[13px] leading-relaxed text-mirai-text shadow-soft max-sm:inset-x-3 max-sm:bottom-3 max-sm:h-auto max-sm:w-auto">
    {/* ヘッダー帯 */}
    <div className="flex items-center gap-2.5 border-b border-mirai-border bg-mirai-surface-teal px-4 py-3">
      <Sparkles aria-hidden="true" className="size-4 shrink-0 text-primary-accent" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold tracking-normal">AIに聞く</div>
        <div className="truncate text-[11px] text-mirai-text-muted">
          {mode === 'byok' ? `あなたのキー・${settings?.model}` : mode === 'server' ? 'サイト提供のAI' : 'APIキーが未設定'}
          {dispatch ? `・結果は${page}の${targetLabel}に適用` : `・${page}を表示中`}
        </div>
      </div>
      {/* 新しい会話。今の会話は「過去の会話」に残る。入力欄の横だと気づかれにくかったので帯に置く */}
      <Button variant="ghost" size="icon-sm" aria-label="新しい会話を始める" title="新しい会話を始める（今の会話は過去の会話に残る）" disabled={messages.length === 0}
        className="shrink-0 text-mirai-text-subtle hover:bg-card disabled:opacity-40" onClick={startNewSession}>
        <RotateCcw aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="過去の会話" aria-pressed={showHistory} title="過去の会話（このブラウザに保存）"
        className={cn('shrink-0 text-mirai-text-subtle hover:bg-card', showHistory && 'bg-card text-primary-accent')}
        onClick={() => void openHistory()}>
        <History aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="キーとモデルの設定" aria-pressed={showSettings} title="キーとモデルの設定"
        className={cn('shrink-0 text-mirai-text-subtle hover:bg-card', showSettings && 'bg-card text-primary-accent')}
        onClick={() => { setModelInput(settings?.model ?? ''); setShowSettings(v => !v); }}>
        <Settings2 aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="閉じる" className="shrink-0 text-mirai-text-subtle hover:bg-card" onClick={() => { abortRef.current?.abort(); onClose(); }}>
        <X aria-hidden="true" />
      </Button>
    </div>

    {/* 過去の会話（このブラウザの IndexedDB に保存。サーバーには送らない） */}
    {showHistory && <div className="max-h-56 overflow-y-auto border-b border-mirai-border bg-mirai-surface p-2" role="listbox" aria-label="過去の会話">
      <Button variant="ghost" size="xs" className="w-full justify-start font-medium text-primary-accent" onClick={startNewSession}>＋ 新しい会話を始める</Button>
      {sessions && sessions.length === 0 && <p className="m-0 px-2 py-1.5 text-xs text-mirai-text-muted">保存された会話はありません。</p>}
      {sessions?.map(s => (
        <Button key={s.id} variant="ghost" size="xs" role="option" aria-selected={s.id === sessionId} onClick={() => void switchSession(s.id)}
          className={cn('h-auto w-full justify-start gap-2 whitespace-normal py-1.5 text-left font-normal', s.id === sessionId && 'bg-mirai-surface-teal text-primary-accent')}>
          <span className="min-w-0 flex-1 truncate">{s.title}</span>
          <span className="shrink-0 text-[11px] text-mirai-text-muted">{formatSessionTime(s.ts)}・{s.messageCount}件</span>
        </Button>
      ))}
    </div>}

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
      {!ownData && <p className="m-0 rounded-xl border border-mirai-border bg-card px-3 py-2 text-xs leading-relaxed text-mirai-text-secondary">この年度はまだ支出データがないため、条件は{Number(yearKey) - 1}年度の実績データで解釈します。府省・事業名・予算額の条件は効きます。AIが事業を選んだ場合はその年度にある事業だけが対象で、支出先・支出額の条件は効きません。</p>}
      {messages.length === 0 && <div className="space-y-3">
        <p className="m-0 text-xs leading-relaxed text-mirai-text-secondary">
          {dispatch
            ? (targetLabel === '一覧'
              ? `条件を自然文で聞くと、${page}の一覧を当てはまる事業だけに絞り込みます。一覧で判定できない条件（支出先・支出額・再委託）は未適用として示し、サンキー図へのリンクで補います。`
              : '条件を自然文で聞くと、当てはまる事業だけを図に残します。適用した条件は検索ピルの「絞込」に反映され、× で外せます。')
            : '条件を自然文で聞くと、公開データから当てはまる事業を探します。結果はサンキー図で開くリンクと、事業ごとの詳細へのリンクで案内します。'}
        </p>
        {mode === 'server' && <p className="m-0 text-[11px] leading-relaxed text-mirai-text-muted">サイト提供の AI では、入力と応答を当団体が保存し、運営・改善、政策の検討、不正対策に使います（個人を特定する情報とは結びつけません）。ご自身の API キーを使う場合は保存しません。</p>}
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
        {/* 復元した会話を別のページで見ているときは、適用済みでも案内リンクを出す（この図には適用できないため） */}
        {m.result && m.applied && dispatch && <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-stance-for-bg px-2.5 py-0.5 text-xs font-medium text-primary-accent">
            <Check aria-hidden="true" className="size-3.5" />{targetLabel}に適用しました
          </span>
          {m.result.interpretation && <span className="text-xs text-mirai-text-muted">{m.result.interpretation}</span>}
          <Button variant="link" size="xs" className="text-xs" onClick={() => applyResult(m.result!)}>再適用する</Button>
        </div>}
        {m.result && !(m.applied && dispatch) && <ResultLinks result={m.result} sheetYear={yearKey} onNavigate={onClose} />}
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
      <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} rows={2} disabled={!mode || sending}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(input); } }}
        placeholder={mode ? '例: 再エネ関連で予算100億円以上（Ctrl+Enter で送信）' : 'APIキーを設定すると利用できます'} className={cn(INPUT_CLASS, 'resize-y')} />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-mirai-text-muted">
          {dispatch
            ? (targetLabel === '一覧' ? '事業名・所管・金額・AI が選んだ事業で一覧を絞り込みます。' : '事業名・支出先・所管・金額・再委託の条件に写します。表示数やピンは変えません。')
            : '事業名・支出先・所管・金額・再委託の条件で探します。'}
        </span>
        <Button variant="default" size="sm" disabled={!input.trim() || !canSend} onClick={() => void send(input)}>
          <Send aria-hidden="true" />送信する
        </Button>
      </div>
    </div>
  </section>;
}

/** 結果を適用できないページでの案内: サンキー図で開くリンクと、上位事業の詳細へのリンク */
function ResultLinks({ result, sheetYear, onNavigate }: { result: SankeyChatResult; sheetYear: SupportedYear; onNavigate: () => void }) {
  const { projects } = result.summary;
  const top = projects.top.filter(p => p.projectId !== null).slice(0, LINKED_PROJECTS);
  return <div className="mt-2 space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="xs" className="rounded-full font-medium">
        <Link href={sankeyUrlForQuery(result.query, sheetYear)} onClick={onNavigate}>
          <ExternalLink aria-hidden="true" className="size-3.5" />サンキー図で見る（{projects.count.toLocaleString()}事業・{formatBudgetFromYen(projects.budgetTotal)}）
        </Link>
      </Button>
      {result.interpretation && <span className="text-xs text-mirai-text-muted">{result.interpretation}</span>}
    </div>
    {top.length > 0 && <ul className="m-0 list-none space-y-1 p-0 text-xs">
      {top.map(p => {
        const links = projectLinks(p.projectId!, sheetYear);
        return <li key={p.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link href={links.quality} onClick={onNavigate} className="min-w-0 font-medium text-primary-accent underline-offset-4 hover:underline">{p.name}</Link>
          <span className="text-mirai-text-muted">{p.ministry ?? ''}・{formatBudgetFromYen(p.budget)}</span>
          <Link href={links.subcontracts} onClick={onNavigate} className="text-[11px] text-mirai-text-muted underline-offset-4 hover:text-primary-accent hover:underline">委託構造</Link>
        </li>;
      })}
    </ul>}
  </div>;
}
