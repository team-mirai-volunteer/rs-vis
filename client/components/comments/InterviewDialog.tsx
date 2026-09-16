'use client';

/**
 * AIインタビューダイアログ（みらい議会ライク）。
 *
 * 流れ: APIキー確認（BYOK 未登録なら入力） → インタビュー（AIが2〜3回深掘り） →
 * 「意見をまとめる」→ 整形プレビュー（編集可） → 「匿名で公開する」確定 → 完了。
 * LLM は訪問者自身のキーでブラウザから直接呼ぶ。サーバへ送るのは確定した本文と transcript のみ。
 * document.body に portal で出し、背面（サンキー図など）へイベントを伝播させない。
 *
 * 見た目はチームみらいデザインシステムのモーダル作法（rounded-3xl / bg-card / border-mirai-border /
 * shadow-soft、オーバーレイ bg-black/40）。各ステップの確定ボタンは <Button variant="default">、
 * 戻る・補助操作は outline。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { InterviewTurn, PostProjectCommentResponse } from '@/types/project-comments';
import {
  COMMENT_BODY_MAX_CHARS,
  INTERVIEW_INPUT_MAX_CHARS,
  INTERVIEW_MAX_USER_TURNS,
} from '@/types/project-comments';
import { deleteByokSettings, loadByokSettings, saveByokSettings, type ByokSettings } from '@/client/lib/ai/api-key-store';
import { DEFAULT_BYOK_MODEL, testOpenRouterKey } from '@/client/lib/ai/openrouter-caller';
import {
  fetchProjectDetailForInterview,
  nextInterviewerTurn,
  submitOpinion,
  summarizeOpinion,
  SubmitOpinionError,
  type InterviewProjectContext,
} from '@/client/lib/comments/interview-runner';

export interface InterviewDialogProps {
  /** 事業情報（detail は無ければダイアログ側で /api/project-details から補完する） */
  context: InterviewProjectContext;
  onClose: () => void;
  /** 投稿完了時（公開・保留どちらでも呼ぶ）。一覧の再取得に使う */
  onSubmitted?: (result: PostProjectCommentResponse) => void;
}

type Step = 'loading' | 'key' | 'interview' | 'summarizing' | 'review' | 'submitting' | 'done';

const MIN_TURNS_TO_SUMMARIZE = 2;

/** テキスト入力・textarea の共通クラス（フィルタ入力と同系統。ダイアログ用にやや大きめ） */
const INPUT_CLASS =
  'w-full min-w-0 rounded-md border border-mirai-border bg-card px-2.5 py-2 text-[13px] text-mirai-text placeholder:text-mirai-text-placeholder transition-colors focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50';

export function InterviewDialog({ context: initialContext, onClose, onSubmitted }: InterviewDialogProps) {
  const [step, setStep] = useState<Step>('loading');
  const [context, setContext] = useState<InterviewProjectContext>(initialContext);
  const [settings, setSettings] = useState<ByokSettings | null>(null);
  const [turns, setTurns] = useState<InterviewTurn[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [retryWaitMs, setRetryWaitMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const [stance, setStance] = useState<string | null>(null);
  const [result, setResult] = useState<PostProjectCommentResponse | null>(null);
  // BYOK 入力
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [keyTesting, setKeyTesting] = useState(false);
  const [keyTestMsg, setKeyTestMsg] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const userTurnCount = turns.filter(t => t.role === 'user').length;
  const reachedMax = userTurnCount >= INTERVIEW_MAX_USER_TURNS;

  // 初期化: BYOK 設定と事業概要の読み込み
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [saved, detail] = await Promise.all([
        loadByokSettings().catch(() => null),
        initialContext.detail === undefined
          ? fetchProjectDetailForInterview(initialContext.pid, initialContext.year)
          : Promise.resolve(initialContext.detail),
      ]);
      if (cancelled) return;
      setContext(prev => ({ ...prev, detail }));
      if (saved) {
        setSettings(saved);
        setStep('interview');
      } else {
        setStep('key');
      }
    })();
    return () => { cancelled = true; abortRef.current?.abort(); };
  }, [initialContext]);

  // インタビュアーの発話を取得する（turns の末尾が user、または空のとき）
  const askInterviewer = useCallback(async (current: InterviewTurn[], s: ByokSettings, ctx: InterviewProjectContext) => {
    const aborter = new AbortController();
    abortRef.current = aborter;
    setThinking(true);
    setError(null);
    setRetryWaitMs(null);
    try {
      const text = await nextInterviewerTurn(ctx, current, {
        settings: s, signal: aborter.signal, onRetry: ms => setRetryWaitMs(ms),
      });
      if (aborter.signal.aborted) return;
      setTurns([...current, { role: 'assistant', content: text }]);
    } catch (e) {
      if (aborter.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'AIが応答できませんでした');
    } finally {
      if (abortRef.current === aborter) abortRef.current = null;
      setThinking(false);
      setRetryWaitMs(null);
    }
  }, []);

  // インタビュー開始時に冒頭の問いかけを取る
  useEffect(() => {
    if (step === 'interview' && settings && turns.length === 0 && !thinking && !error) {
      void askInterviewer([], settings, context);
    }
    // context.detail の後着で再実行しないよう、開始条件のみに依存させる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, settings]);

  // ログ末尾へ自動スクロール
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, thinking]);

  // 背面にも window の Escape ハンドラがあるため、先に受けてこの画面だけ閉じる。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const handleSaveKey = async () => {
    // 保存済みのキーがあれば空欄のまま再利用できる（モデル名だけ直す操作を想定）
    const apiKey = keyInput.trim() || settings?.apiKey || '';
    if (!apiKey) return;
    const s: ByokSettings = { apiKey, model: modelInput.trim() || DEFAULT_BYOK_MODEL };
    try {
      await saveByokSettings(s);
    } catch {
      // IndexedDB が使えない環境でもこのダイアログ内では続行できる
    }
    abortRef.current?.abort();
    setSettings(s);
    setKeyInput('');
    setKeyTestMsg(null);
    setTurns([]);
    setError(null);
    setStep('interview');
  };

  /** 誤ったモデル名などで進めなくなったときに設定へ戻る。キーは保持し、モデル欄に現在値を出す */
  const handleOpenSettings = () => {
    abortRef.current?.abort();
    setThinking(false);
    setModelInput(settings?.model ?? '');
    setKeyInput('');
    setKeyTestMsg(null);
    setError(null);
    setStep('key');
  };

  const handleForgetSettings = async () => {
    try { await deleteByokSettings(); } catch { /* 保存されていなければ何もしない */ }
    setSettings(null);
    setModelInput('');
    setKeyInput('');
    setKeyTestMsg(null);
    setTurns([]);
    setError(null);
    setStep('key');
  };

  const handleTestKey = async () => {
    const apiKey = keyInput.trim() || settings?.apiKey || '';
    if (!apiKey) return;
    setKeyTesting(true);
    setKeyTestMsg(null);
    const r = await testOpenRouterKey(apiKey);
    setKeyTestMsg(r.ok ? '接続できました' : r.error);
    setKeyTesting(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || thinking || !settings || reachedMax) return;
    const next: InterviewTurn[] = [...turns, { role: 'user', content: text.slice(0, INTERVIEW_INPUT_MAX_CHARS) }];
    setTurns(next);
    setInput('');
    await askInterviewer(next, settings, context);
    inputRef.current?.focus();
  };

  const handleSummarize = async () => {
    if (!settings || userTurnCount < MIN_TURNS_TO_SUMMARIZE) return;
    abortRef.current?.abort();
    const aborter = new AbortController();
    abortRef.current = aborter;
    setStep('summarizing');
    setError(null);
    try {
      const summary = await summarizeOpinion(context, turns, {
        settings, signal: aborter.signal, onRetry: ms => setRetryWaitMs(ms),
      });
      if (aborter.signal.aborted) return;
      setDraftBody(summary.body);
      setStance(summary.stance);
      setStep('review');
    } catch (e) {
      if (aborter.signal.aborted) return;
      setError(e instanceof Error ? e.message : '意見の整形に失敗しました');
      setStep('interview');
    } finally {
      if (abortRef.current === aborter) abortRef.current = null;
      setRetryWaitMs(null);
    }
  };

  const handleSubmit = async () => {
    const body = draftBody.trim();
    if (!body || body.length > COMMENT_BODY_MAX_CHARS) return;
    setStep('submitting');
    setError(null);
    try {
      const r = await submitOpinion(context.pid, { year: context.year, body, transcript: turns });
      setResult(r);
      setStep('done');
      onSubmitted?.(r);
    } catch (e) {
      setError(e instanceof SubmitOpinionError ? e.message : '投稿に失敗しました。時間をおいて再度お試しください');
      setStep('review');
    }
  };

  const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

  const body = (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4"
      // Portal のイベントは React の親へ伝わる。背面の選択解除・パンに渡さない。
      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onPointerDown={stopPropagation}
      onMouseDown={stopPropagation}
      onMouseMove={stopPropagation}
      onWheel={stopPropagation}
      role="presentation"
    >
      <div
        className="flex w-[min(640px,100%)] max-h-[min(85vh,760px)] flex-col overflow-hidden rounded-3xl border border-mirai-border bg-card text-[13px] leading-relaxed text-mirai-text shadow-soft"
        role="dialog" aria-modal="true" aria-labelledby="interview-dialog-title" onMouseDown={stopPropagation}
      >
        <div className="flex items-center gap-2.5 border-b border-border bg-mirai-surface-teal px-4 py-3">
          <div className="min-w-0 flex-1">
            <div id="interview-dialog-title" className="text-sm font-bold tracking-normal text-mirai-text">
              意見インタビュー
              <span className="ml-2 text-[11px] font-normal text-mirai-text-subtle">匿名・公開は最後に確認します</span>
            </div>
            <div className="truncate text-xs text-mirai-text-subtle" title={context.projectName}>
              {context.projectName}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="閉じる" className="shrink-0 text-mirai-text-subtle hover:bg-card">
            <X aria-hidden="true" />
          </Button>
        </div>

        {step === 'loading' && (
          <div className="p-6 text-mirai-text-muted">準備しています...</div>
        )}

        {step === 'key' && (
          <div className="flex flex-col gap-2.5 overflow-y-auto p-4">
            <p className="m-0">
              インタビューの AI は<strong>あなたの OpenRouter API キー</strong>でブラウザから直接動きます。
              キーはこのブラウザにのみ保存され、このサイトのサーバには送信されません。
            </p>
            <p className="m-0 text-xs text-mirai-text-muted">
              利用上限（クレジット制限）を設定したキーの使用をおすすめします。
              キーは <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary-accent">openrouter.ai/keys</a> で発行できます。
            </p>
            {settings && (
              <p className="m-0 rounded-md bg-mirai-surface-teal px-2.5 py-1.5 text-xs">
                保存済みのキーがあります。キー欄を空のままにすると、そのキーを使ってモデル名だけ更新します。現在のモデル: <code>{settings.model}</code>
              </p>
            )}
            <label className="block">
              <span className="mb-[3px] block text-[11px] text-mirai-text-muted">APIキー{settings && '（変更しない場合は空欄）'}</span>
              <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} autoComplete="off"
                placeholder={settings ? '保存済みのキーを使う' : 'sk-or-v1-...'} className={INPUT_CLASS} />
            </label>
            <label className="block">
              <span className="mb-[3px] block text-[11px] text-mirai-text-muted">モデル（空欄なら {DEFAULT_BYOK_MODEL}）</span>
              <input type="text" value={modelInput} onChange={e => setModelInput(e.target.value)} placeholder={DEFAULT_BYOK_MODEL} className={INPUT_CLASS} />
              <span className="mt-[3px] block text-[11px] text-mirai-text-muted">OpenRouter のモデルID（例: {DEFAULT_BYOK_MODEL}）。存在しないIDだと AI が応答できません。</span>
            </label>
            {keyTestMsg && (
              <div className={cn('text-xs', keyTestMsg === '接続できました' ? 'text-primary-accent' : 'text-destructive')}>{keyTestMsg}</div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {settings && (
                <Button variant="outline" size="sm" onClick={handleForgetSettings} className="mr-auto border-mirai-border text-destructive">
                  保存済みの設定を削除
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleTestKey} disabled={(!keyInput.trim() && !settings) || keyTesting} className="border-mirai-border">
                {keyTesting ? 'テスト中...' : '接続テスト'}
              </Button>
              <Button variant="default" size="sm" onClick={handleSaveKey} disabled={!keyInput.trim() && !settings}>
                保存して始める
              </Button>
            </div>
          </div>
        )}

        {(step === 'interview' || step === 'summarizing') && (
          <>
            <div ref={logRef} className="flex min-h-60 flex-1 flex-col gap-2 overflow-y-auto bg-mirai-surface px-3.5 py-3">
              {turns.map((t, i) => (
                <div key={i} className={cn(
                  'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl border px-3 py-2',
                  t.role === 'user'
                    ? 'self-end border-primary/30 bg-mirai-surface-teal'
                    : 'self-start border-border bg-card',
                )}>
                  {t.content}
                </div>
              ))}
              {(thinking || step === 'summarizing') && (
                <div className="self-start px-1.5 py-1 text-xs text-mirai-text-muted">
                  {step === 'summarizing' ? '意見文にまとめています...' : '考えています...'}
                  {retryWaitMs != null && `（混雑のため ${Math.ceil(retryWaitMs / 1000)} 秒待って再試行）`}
                </div>
              )}
              {error && (
                <div className="flex flex-wrap items-center gap-2 self-stretch rounded-xl border border-destructive/30 bg-stance-against-bg px-2.5 py-1.5 text-xs text-destructive">
                  <span>{error}{settings && <span className="ml-1 text-mirai-text-muted">（モデル: {settings.model}）</span>}</span>
                  {turns.length === 0 && settings && (
                    <Button variant="outline" size="xs" onClick={() => void askInterviewer([], settings, context)} className="border-mirai-border">再試行</Button>
                  )}
                  <Button variant="outline" size="xs" onClick={handleOpenSettings} className="border-mirai-border">キー・モデルを変える</Button>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 border-t border-border px-3.5 py-2.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value.slice(0, INTERVIEW_INPUT_MAX_CHARS))}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSend(); } }}
                placeholder={reachedMax ? '発言回数の上限に達しました。「意見をまとめる」へ進んでください' : 'ここに入力（Ctrl+Enter で送信）'}
                rows={2}
                disabled={thinking || step === 'summarizing' || reachedMax}
                className={cn(INPUT_CLASS, 'resize-y')}
              />
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-mirai-text-muted">
                  {input.length}/{INTERVIEW_INPUT_MAX_CHARS}字 ・ 発言 {userTurnCount}/{INTERVIEW_MAX_USER_TURNS}
                  {' ・ '}<button type="button" onClick={handleOpenSettings} className="underline underline-offset-2 hover:text-mirai-text">設定</button>
                </span>
                <span className="flex-1" />
                <Button variant="outline" size="sm" onClick={handleSummarize}
                  disabled={userTurnCount < MIN_TURNS_TO_SUMMARIZE || thinking || step === 'summarizing'}
                  title={userTurnCount < MIN_TURNS_TO_SUMMARIZE ? `${MIN_TURNS_TO_SUMMARIZE}回以上お話しいただくと、意見文にまとめられます` : 'ここまでの内容を公開用の意見文にまとめる'}
                  className="border-mirai-border">
                  意見をまとめる
                </Button>
                <Button variant="default" size="sm" onClick={handleSend}
                  disabled={!input.trim() || thinking || step === 'summarizing' || reachedMax}>
                  送信
                </Button>
              </div>
            </div>
          </>
        )}

        {(step === 'review' || step === 'submitting') && (
          <div className="flex flex-col gap-2.5 overflow-y-auto p-4">
            <p className="m-0">
              インタビューの内容を意見文にまとめました。<strong>この内容が匿名で公開されます。</strong>
              必要なら編集してください。個人が特定できる情報は書かないでください。
            </p>
            {stance && <div className="text-xs text-mirai-text-muted">立場の整理: {stance}</div>}
            <textarea
              value={draftBody}
              onChange={e => setDraftBody(e.target.value.slice(0, COMMENT_BODY_MAX_CHARS))}
              rows={8}
              disabled={step === 'submitting'}
              className={cn(INPUT_CLASS, 'resize-y leading-relaxed')}
            />
            <div className="text-[11px] text-mirai-text-muted">{draftBody.length}/{COMMENT_BODY_MAX_CHARS}字</div>
            {error && <div className="text-xs text-destructive">{error}</div>}
            <p className="m-0 text-[11px] text-mirai-text-muted">
              公開前に機械的なチェック（連絡先・URL 等）を行います。問題があれば公開を保留します。
              インタビュー全文は投稿条件の確認に使い、データベースには保存しません。公開されるのは確認した本文です。
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setStep('interview'); setError(null); }} disabled={step === 'submitting'} className="border-mirai-border">
                インタビューに戻る
              </Button>
              <Button variant="default" size="sm" onClick={handleSubmit}
                disabled={!draftBody.trim() || step === 'submitting'}>
                {step === 'submitting' ? '投稿中...' : '匿名で公開する'}
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div className="flex flex-col gap-2.5 p-5">
            {result.status === 'published' ? (
              <p className="m-0">ご意見を公開しました。ありがとうございました。</p>
            ) : (
              <p className="m-0">
                ご意見を受け付けましたが、公開は保留になりました。
                {result.reason && <><br /><span className="text-xs text-mirai-text-muted">理由: {result.reason}</span></>}
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="default" size="sm" onClick={onClose}>閉じる</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(body, document.body);
}
