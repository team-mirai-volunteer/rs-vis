/**
 * 投稿前スクリーニング（ルールベース・サーバ側）。
 *
 * LLM はBYOK（訪問者自身のキー）で動くためサーバでは呼べない。ここでは機械的に判定できる
 * 「個人情報らしきもの」「URL・連絡先」「本文の体をなしていないもの」だけを弾き、
 * 誹謗中傷等の内容判断は運用（Supabase ダッシュボードで status='hidden'）に委ねる。
 * NG は保存はするが公開しない（hidden）。
 */
import { COMMENT_BODY_MAX_CHARS } from '@/types/project-comments';

export interface ScreeningResult {
  ok: boolean;
  /** 利用者向けの理由（ok=false のとき） */
  reason?: string;
}

const RULES: { pattern: RegExp; reason: string }[] = [
  { pattern: /https?:\/\/|www\./i, reason: 'URL を含む意見は公開できません' },
  { pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/, reason: 'メールアドレスを含む意見は公開できません' },
  { pattern: /(?:\+81|0)\d{1,4}[-‐‑–ー\s]?\d{1,4}[-‐‑–ー\s]?\d{3,4}/, reason: '電話番号を含む意見は公開できません' },
  { pattern: /\d{3}[-‐‑–ー]\d{4}(?!\d)/, reason: '郵便番号を含む意見は公開できません' },
  { pattern: /(?:マイナンバー|個人番号)\D{0,6}\d{4}/, reason: '個人番号を含む意見は公開できません' },
  { pattern: /@[A-Za-z0-9_]{3,}/, reason: 'SNS アカウントを含む意見は公開できません' },
];

/** 本文を検査する。長さ・空白のみ・記号のみもここで弾く */
export function screenCommentBody(body: string): ScreeningResult {
  const text = body.trim();
  if (text.length === 0) return { ok: false, reason: '本文が空です' };
  if (text.length > COMMENT_BODY_MAX_CHARS) {
    return { ok: false, reason: `本文は${COMMENT_BODY_MAX_CHARS}字以内にしてください` };
  }
  // 日本語・英数字がほとんど無い（記号の羅列・連打）は意見として扱わない
  const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (letters < Math.min(10, text.length * 0.5)) {
    return { ok: false, reason: '意見として読める本文にしてください' };
  }
  // 同一文字の長い連打
  if (/(.)\1{19,}/u.test(text)) {
    return { ok: false, reason: '同じ文字の繰り返しが多すぎます' };
  }
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return { ok: false, reason: rule.reason };
  }
  return { ok: true };
}
