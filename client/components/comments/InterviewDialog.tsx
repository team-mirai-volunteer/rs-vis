'use client';

/**
 * AIインタビューダイアログ（みらい議会ライク）。
 *
 * 流れ: APIキー確認（BYOK 未登録なら入力） → インタビュー（AIが2〜3回深掘り） →
 * 「意見をまとめる」→ 整形プレビュー（編集可） → 「匿名で公開する」確定 → 完了。
 * LLM は訪問者自身のキーでブラウザから直接呼ぶ。サーバへ送るのは確定した本文と transcript のみ。
 * document.body に portal で出し、背面（サンキー図など）へイベントを伝播させない。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { InterviewTurn, PostProjectCommentResponse } from '@/types/project-comments';
import {
  COMMENT_BODY_MAX_CHARS,
  INTERVIEW_INPUT_MAX_CHARS,
  INTERVIEW_MAX_USER_TURNS,
} from '@/types/project-comments';
import { loadByokSettings, saveByokSettings, type ByokSettings } from '@/client/lib/ai/api-key-store';
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

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const cardStyle: React.CSSProperties = {
  width: 'min(640px, 100%)', maxHeight: 'min(85vh, 760px)', display: 'flex', flexDirection: 'column',
  background: '#fff', color: '#222', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', overflow: 'hidden',
  fontSize: 13, lineHeight: 1.6,
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
  background: '#f3efe6', borderBottom: '1px solid #e6dfd0',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: 'none', background: '#1b7f37', color: '#fff',
  fontWeight: 600, cursor: 'pointer', fontSize: 13,
};
const secondaryBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', color: '#333',
  cursor: 'pointer', fontSize: 13,
};
const disabledBtn: React.CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc',
  fontSize: 13, fontFamily: 'inherit', background: '#fff', color: '#222',
};

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

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSaveKey = async () => {
    const apiKey = keyInput.trim();
    if (!apiKey) return;
    const s: ByokSettings = { apiKey, model: modelInput.trim() || DEFAULT_BYOK_MODEL };
    try {
      await saveByokSettings(s);
    } catch {
      // IndexedDB が使えない環境でもこのダイアログ内では続行できる
    }
    setSettings(s);
    setKeyInput('');
    setStep('interview');
  };

  const handleTestKey = async () => {
    const apiKey = keyInput.trim();
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
      style={overlayStyle}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      onWheel={stopPropagation}
      role="presentation"
    >
      <div style={cardStyle} role="dialog" aria-modal="true" aria-labelledby="interview-dialog-title" onMouseDown={stopPropagation}>
        <div style={headerStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="interview-dialog-title" style={{ fontWeight: 700, fontSize: 14, color: '#5a4a2a' }}>
              意見インタビュー
              <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 11, color: '#7a6a4a' }}>匿名・公開は最後に確認します</span>
            </div>
            <div style={{ fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={context.projectName}>
              {context.projectName}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる"
            style={{ border: 'none', background: 'transparent', fontSize: 20, lineHeight: 1, cursor: 'pointer', color: '#666', padding: 4 }}>×</button>
        </div>

        {step === 'loading' && (
          <div style={{ padding: 24, color: '#777' }}>準備しています...</div>
        )}

        {step === 'key' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            <p style={{ margin: 0 }}>
              インタビューの AI は<strong>あなたの OpenRouter API キー</strong>でブラウザから直接動きます。
              キーはこのブラウザにのみ保存され、このサイトのサーバには送信されません。
            </p>
            <p style={{ margin: 0, fontSize: 12, color: '#777' }}>
              利用上限（クレジット制限）を設定したキーの使用をおすすめします。
              キーは <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" style={{ color: '#4a90d9' }}>openrouter.ai/keys</a> で発行できます。
            </p>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: 11, color: '#777', marginBottom: 3 }}>APIキー</span>
              <input type="password" value={keyInput} onChange={e => setKeyInput(e.target.value)} autoComplete="off"
                placeholder="sk-or-v1-..." style={inputStyle} />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ display: 'block', fontSize: 11, color: '#777', marginBottom: 3 }}>モデル（空欄なら {DEFAULT_BYOK_MODEL}）</span>
              <input type="text" value={modelInput} onChange={e => setModelInput(e.target.value)} placeholder={DEFAULT_BYOK_MODEL} style={inputStyle} />
            </label>
            {keyTestMsg && <div style={{ fontSize: 12, color: keyTestMsg === '接続できました' ? '#1b7f37' : '#b00020' }}>{keyTestMsg}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={handleTestKey} disabled={!keyInput.trim() || keyTesting}
                style={{ ...secondaryBtn, ...(!keyInput.trim() || keyTesting ? disabledBtn : {}) }}>
                {keyTesting ? 'テスト中...' : '接続テスト'}
              </button>
              <button type="button" onClick={handleSaveKey} disabled={!keyInput.trim()}
                style={{ ...primaryBtn, ...(!keyInput.trim() ? disabledBtn : {}) }}>
                保存して始める
              </button>
            </div>
          </div>
        )}

        {(step === 'interview' || step === 'summarizing') && (
          <>
            <div ref={logRef} style={{ flex: 1, minHeight: 240, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, background: '#fafaf7' }}>
              {turns.map((t, i) => (
                <div key={i} style={{
                  alignSelf: t.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%', padding: '8px 12px', borderRadius: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: t.role === 'user' ? '#dcefe2' : '#fff',
                  border: t.role === 'user' ? '1px solid #c2e5cf' : '1px solid #e6e6e6',
                }}>
                  {t.content}
                </div>
              ))}
              {(thinking || step === 'summarizing') && (
                <div style={{ alignSelf: 'flex-start', color: '#888', fontSize: 12, padding: '4px 6px' }}>
                  {step === 'summarizing' ? '意見文にまとめています...' : '考えています...'}
                  {retryWaitMs != null && `（混雑のため ${Math.ceil(retryWaitMs / 1000)} 秒待って再試行）`}
                </div>
              )}
              {error && (
                <div style={{ alignSelf: 'stretch', color: '#b00020', fontSize: 12, background: '#fdecee', border: '1px solid #f5c2c7', borderRadius: 8, padding: '6px 10px' }}>
                  {error}
                  {turns.length === 0 && settings && (
                    <button type="button" onClick={() => void askInterviewer([], settings, context)} style={{ ...secondaryBtn, marginLeft: 8, padding: '2px 8px', fontSize: 12 }}>再試行</button>
                  )}
                </div>
              )}
            </div>
            <div style={{ borderTop: '1px solid #eee', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value.slice(0, INTERVIEW_INPUT_MAX_CHARS))}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void handleSend(); } }}
                placeholder={reachedMax ? '発言回数の上限に達しました。「意見をまとめる」へ進んでください' : 'ここに入力（Ctrl+Enter で送信）'}
                rows={2}
                disabled={thinking || step === 'summarizing' || reachedMax}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {input.length}/{INTERVIEW_INPUT_MAX_CHARS}字 ・ 発言 {userTurnCount}/{INTERVIEW_MAX_USER_TURNS}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button" onClick={handleSummarize}
                  disabled={userTurnCount < MIN_TURNS_TO_SUMMARIZE || thinking || step === 'summarizing'}
                  title={userTurnCount < MIN_TURNS_TO_SUMMARIZE ? `${MIN_TURNS_TO_SUMMARIZE}回以上お話しいただくと、意見文にまとめられます` : 'ここまでの内容を公開用の意見文にまとめる'}
                  style={{ ...secondaryBtn, ...(userTurnCount < MIN_TURNS_TO_SUMMARIZE || thinking || step === 'summarizing' ? disabledBtn : {}) }}>
                  意見をまとめる
                </button>
                <button type="button" onClick={handleSend}
                  disabled={!input.trim() || thinking || step === 'summarizing' || reachedMax}
                  style={{ ...primaryBtn, ...(!input.trim() || thinking || step === 'summarizing' || reachedMax ? disabledBtn : {}) }}>
                  送信
                </button>
              </div>
            </div>
          </>
        )}

        {(step === 'review' || step === 'submitting') && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
            <p style={{ margin: 0 }}>
              インタビューの内容を意見文にまとめました。<strong>この内容が匿名で公開されます。</strong>
              必要なら編集してください。個人が特定できる情報は書かないでください。
            </p>
            {stance && <div style={{ fontSize: 12, color: '#777' }}>立場の整理: {stance}</div>}
            <textarea
              value={draftBody}
              onChange={e => setDraftBody(e.target.value.slice(0, COMMENT_BODY_MAX_CHARS))}
              rows={8}
              disabled={step === 'submitting'}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
            />
            <div style={{ fontSize: 11, color: '#999' }}>{draftBody.length}/{COMMENT_BODY_MAX_CHARS}字</div>
            {error && <div style={{ color: '#b00020', fontSize: 12 }}>{error}</div>}
            <p style={{ margin: 0, fontSize: 11, color: '#777' }}>
              公開前に機械的なチェック（連絡先・URL 等）を行います。問題があれば公開を保留します。
              インタビューの全文は公開されず、運営の確認用にのみ保存されます。
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { setStep('interview'); setError(null); }} disabled={step === 'submitting'}
                style={{ ...secondaryBtn, ...(step === 'submitting' ? disabledBtn : {}) }}>
                インタビューに戻る
              </button>
              <button type="button" onClick={handleSubmit}
                disabled={!draftBody.trim() || step === 'submitting'}
                style={{ ...primaryBtn, ...(!draftBody.trim() || step === 'submitting' ? disabledBtn : {}) }}>
                {step === 'submitting' ? '投稿中...' : '匿名で公開する'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.status === 'published' ? (
              <p style={{ margin: 0 }}>ご意見を公開しました。ありがとうございました。</p>
            ) : (
              <p style={{ margin: 0 }}>
                ご意見を受け付けましたが、公開は保留になりました。
                {result.reason && <><br /><span style={{ color: '#777', fontSize: 12 }}>理由: {result.reason}</span></>}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={primaryBtn}>閉じる</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(body, document.body);
}
