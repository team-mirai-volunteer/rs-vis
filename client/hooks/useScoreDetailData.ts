'use client';

/**
 * スコア詳細ダイアログが必要とするデータの取得。
 *
 * `client/components/` の再利用可能UIから直接APIを叩かない（Layer Design Rules）ため、
 * fetch はこのフックに閉じる。`app/lib/` は HTTP 禁止のドメイン層なので置き場にしない。
 *
 * 取得結果はモジュールスコープでキャッシュし、同一事業への同時リクエストを1本にまとめる
 * （React StrictMode の二重実行や、閉じてすぐ開き直した場合の重複を防ぐ）。
 * ただし**失敗は残さない**。一度の通信断でセッション中ずっと「データなし」になるのを避ける。
 */

import { useEffect, useState } from 'react';
import type { RecipientRow } from '@/app/lib/api/quality-recipients-loader';
import type { ProjectDetail } from '@/types/project-details';
import type { PolicyEvaluation } from '@/app/lib/policy-evaluation';

const recipientsCache = new Map<string, Promise<RecipientRow[]>>();
const projectInfoCache = new Map<string, Promise<ProjectDetail | null>>();
const policyCache = new Map<string, Promise<PolicyEvaluation | null>>();

function fetchRecipients(pid: string, year: string): Promise<RecipientRow[]> {
  const key = `${year}-${pid}`;
  const hit = recipientsCache.get(key);
  if (hit) return hit;
  const req = fetch(`/api/quality-scores/recipients?pid=${pid}&year=${year}`)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .catch(e => { recipientsCache.delete(key); throw e; });  // 失敗は残さず再試行可能にする
  recipientsCache.set(key, req);
  return req;
}

function fetchProjectInfo(pid: string, year: string): Promise<ProjectDetail | null> {
  const key = `${year}-${pid}`;
  const hit = projectInfoCache.get(key);
  if (hit) return hit;
  const req = fetch(`/api/project-details/${pid}?year=${year}`)
    .then(res => {
      // 404 =「その事業の詳細が無い」＝確定した答えなのでキャッシュしてよい。
      // 5xx・通信断は一時的な失敗なのでキャッシュから外して再試行できるようにする。
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .catch(e => { projectInfoCache.delete(key); throw e; });
  projectInfoCache.set(key, req);
  return req;
}

function fetchPolicyEvaluation(pid: string, year: string): Promise<PolicyEvaluation | null> {
  const key = `${year}-${pid}`;
  const hit = policyCache.get(key);
  if (hit) return hit;
  const req = fetch(`/api/policy-summary?year=${year}&pid=${pid}`)
    .then(res => {
      // 404 =「その事業の評価が無い」＝確定。5xx・通信断は再試行させる
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    })
    .then((json: { evaluation: PolicyEvaluation } | null) => json?.evaluation ?? null)
    .catch(e => { policyCache.delete(key); throw e; });
  policyCache.set(key, req);
  return req;
}

export interface ScoreDetailData {
  /** null = 取得中 */
  recipients: RecipientRow[] | null;
  recipientsError: boolean;
  /** undefined = 取得中、null = 詳細なし */
  projectInfo: ProjectDetail | null | undefined;
  /** undefined = 取得中または未取得、null = 評価なし */
  policy: PolicyEvaluation | null | undefined;
  /** 政策評価の取得に失敗したときのメッセージ */
  policyError: string | null;
}

/**
 * @param pid 表示中の事業。null ならなにも取りに行かない
 * @param skipPolicy 呼び出し側が政策評価を既に持っている場合（/quality）は取りに行かない
 */
export function useScoreDetailData(
  pid: string | null,
  year: string,
  skipPolicy = false,
): ScoreDetailData {
  const [recipients, setRecipients] = useState<RecipientRow[] | null>(null);
  const [recipientsError, setRecipientsError] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectDetail | null | undefined>(undefined);
  const [policy, setPolicy] = useState<PolicyEvaluation | null | undefined>(undefined);
  const [policyError, setPolicyError] = useState<string | null>(null);

  useEffect(() => {
    setRecipients(null);
    setRecipientsError(false);
    setProjectInfo(undefined);
    setPolicy(undefined);
    setPolicyError(null);
    if (!pid) return;
    // 表示中の事業が切り替わった後に古い応答が届いても反映しない
    let stale = false;
    fetchRecipients(pid, year)
      .then(rows => { if (!stale) setRecipients(rows); })
      .catch(() => { if (!stale) setRecipientsError(true); });
    fetchProjectInfo(pid, year)
      .then(d => { if (!stale) setProjectInfo(d); })
      .catch(() => { if (!stale) setProjectInfo(null); });
    if (!skipPolicy) {
      fetchPolicyEvaluation(pid, year)
        .then(p => { if (!stale) setPolicy(p); })
        .catch((e: Error) => { if (!stale) { setPolicy(null); setPolicyError(e.message || '取得失敗'); } });
    }
    return () => { stale = true; };
  }, [pid, year, skipPolicy]);

  return { recipients, recipientsError, projectInfo, policy, policyError };
}
