'use client';

/**
 * サイドパネルの「目」タブが必要とするデータの取得。
 *
 * `client/components/` の再利用可能UIから直接APIを叩かない（Layer Design Rules）ため、
 * fetch はこのフックに閉じる。`app/lib/` は HTTP 禁止のドメイン層なので置き場にしない。
 *
 * mode='section' は /api/mof-kou/detail（項の目一覧＋RS紐づけ）、
 * mode='project' は /api/mof-sankey/rs-project（RS事業が計上されている目の一覧）、
 * mode='sections' は /api/mof-kou/detail-batch（複数項の目一覧をまとめて合算）を叩く。
 */

import { useEffect, useState } from 'react';

export interface KouMokuRow {
  sectionName?: string;
  subItemName: string;
  amount: number;
  rsProjectNames?: string[];
  /** 目の出典ページ番号。突合できない場合は null・無い場合は undefined（RS事業選択時の目一覧は未対応） */
  page?: number | null;
  /** page が無いときは空文字列・undefined */
  sourceUrl?: string;
}

interface KouMokuLeafLike {
  key: string;
  sectionName: string;
  subItemName: string;
  amount: number;
  page: number | null;
  sourceUrl: string;
}

interface RsLinkLike {
  kouMokuKey: string;
  projectName: string;
}

interface SectionDetailResponse {
  kouMokuItems?: KouMokuLeafLike[];
  rsLinks?: RsLinkLike[];
}

interface RsProjectLinkRow {
  sectionName: string;
  subItemName: string;
  rsAmount: number;
}

interface RsProjectResponse {
  rows?: RsProjectLinkRow[];
}

export type KouMokuDetailParams =
  | { mode: 'section'; fiscalYear: number; sectionId: string }
  | { mode: 'project'; fiscalYear: number; budgetType: string; projectId: number }
  | { mode: 'sections'; fiscalYear: number; sectionIds: string[] };

function fetchSectionRows(fiscalYear: number, sectionId: string): Promise<KouMokuRow[]> {
  return fetch(`/api/mof-kou/detail?year=${fiscalYear}&id=${encodeURIComponent(sectionId)}`)
    .then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<SectionDetailResponse>;
    })
    .then(({ kouMokuItems = [], rsLinks = [] }) => {
      const rsByKey = new Map<string, string[]>();
      for (const link of rsLinks) {
        const list = rsByKey.get(link.kouMokuKey) ?? [];
        list.push(link.projectName);
        rsByKey.set(link.kouMokuKey, list);
      }
      return kouMokuItems
        .map(k => ({
          // 目名が空欄の項（予備費のように目を細分しない項が実データに存在する）は
          // 項名にフォールバックする。項自体は既にサイドパネルのヘッダーに出ているが、
          // フォールバックしないと一覧の行が空白のまま金額しか見えなくなるため
          subItemName: k.subItemName || k.sectionName,
          amount: k.amount,
          rsProjectNames: rsByKey.get(k.key),
          page: k.page,
          sourceUrl: k.sourceUrl,
        }))
        .sort((a, b) => b.amount - a.amount);
    });
}

/** 所管丸ごとなど数百件になりうるため、URL長制限に掛かるGETクエリではなくPOSTのJSONボディで送る */
function fetchSectionsRows(fiscalYear: number, sectionIds: string[]): Promise<KouMokuRow[]> {
  return fetch('/api/mof-kou/detail-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year: fiscalYear, ids: sectionIds }),
  })
    .then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<{ rows?: KouMokuRow[] }>;
    })
    .then(({ rows = [] }) => rows);
}

function fetchProjectRows(fiscalYear: number, projectId: number, budgetType: string): Promise<KouMokuRow[]> {
  const qs = `year=${fiscalYear}&projectId=${projectId}&budgetType=${encodeURIComponent(budgetType)}`;
  return fetch(`/api/mof-sankey/rs-project?${qs}`)
    .then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<RsProjectResponse>;
    })
    .then(({ rows: linkRows = [] }) =>
      linkRows
        .map(l => ({ sectionName: l.sectionName, subItemName: l.subItemName, amount: l.rsAmount }))
        .sort((a, b) => b.amount - a.amount)
    );
}

export function useKouMokuDetail(params: KouMokuDetailParams): { rows: KouMokuRow[] | null; error: boolean } {
  const [rows, setRows] = useState<KouMokuRow[] | null>(null);
  const [error, setError] = useState(false);
  const { mode, fiscalYear } = params;
  const sectionId = params.mode === 'section' ? params.sectionId : undefined;
  const projectId = params.mode === 'project' ? params.projectId : undefined;
  const budgetType = params.mode === 'project' ? params.budgetType : undefined;
  const sectionIds = params.mode === 'sections' ? params.sectionIds : undefined;
  // 配列を依存に直接使うと参照が毎レンダー変わりうるため、内容で比較できる文字列に落とす
  // （IDにカンマを含みうる・配列の境界を保つため join ではなく JSON.stringify を使う）
  const sectionIdsKey = sectionIds ? JSON.stringify(sectionIds) : undefined;

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(false);

    const request =
      mode === 'section' && sectionId !== undefined
        ? fetchSectionRows(fiscalYear, sectionId)
        : mode === 'sections' && sectionIds !== undefined
          ? fetchSectionsRows(fiscalYear, sectionIds)
          : projectId !== undefined && budgetType !== undefined
            ? fetchProjectRows(fiscalYear, projectId, budgetType)
            : null;
    if (!request) return;

    request
      .then(items => {
        if (!cancelled) setRows(items);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, fiscalYear, sectionId, projectId, budgetType, sectionIdsKey]);

  return { rows, error };
}
