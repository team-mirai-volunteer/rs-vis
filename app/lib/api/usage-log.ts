/**
 * dev 専用の利用ログ（利用分析基盤検討 20260707_0801 の Phase 0）。
 *
 * チャット等の利用イベントを data/usage/usage-log.jsonl（gitignore 済み）へ1行ずつ追記する。
 * 特に「result なしで終わった要求」= 未充足需要の観測が目的（タグ体系・ツール拡充の要求仕様の源泉）。
 * ローカル開発でのみ書き込む: Vercel（永続ストレージなし）と production ビルドでは何もしない。
 * 公開時の収集（KVカウンタ・k-匿名化）は Phase 1 として別実装。
 */
import * as fs from 'fs';
import * as path from 'path';

export interface UsageLogEntry {
  /** イベント種別（当面 'ai_chat' のみ。query API 等に広げる余地を残す） */
  kind: string;
  [key: string]: unknown;
}

function isUsageLogEnabled(): boolean {
  return process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'production';
}

/** 利用イベントを1行追記する。失敗してもリクエスト処理を壊さない（握りつぶしてコンソール警告のみ） */
export function appendUsageLog(entry: UsageLogEntry): void {
  if (!isUsageLogEnabled()) return;
  try {
    // 'data' 直下を参照するとファイルトレーシングが data/ 全体（houjin.db 1GB 等）を
    // 関数に同梱してしまうため、専用サブディレクトリに限定する（リテラルで書くこと）
    const dir = path.join(process.cwd(), 'data', 'usage');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(path.join(dir, 'usage-log.jsonl'), `${line}\n`, 'utf-8');
  } catch (e) {
    console.warn('[usage-log] 書き込みに失敗しました（処理は継続）:', e instanceof Error ? e.message : e);
  }
}
