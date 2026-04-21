'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import type { SubcontractGraph } from '@/types/subcontract';

type SortKey = 'projectId' | 'budget' | 'execution' | 'maxDepth' | 'totalBlockCount' | 'totalRecipientCount';
type SortDir = 'asc' | 'desc';

function formatYen(v: number): string {
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}兆円`;
  if (v >= 1e10) return `${Math.round(v / 1e8).toLocaleString()}億円`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}億円`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}万円`;
  return `${Math.round(v).toLocaleString()}円`;
}

function SubcontractsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [year, setYear] = useState(() => {
    const y = parseInt(searchParams.get('year') ?? '2024', 10);
    return [2024, 2025].includes(y) ? y : 2024;
  });
  const [graphs, setGraphs] = useState<SubcontractGraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('projectId');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/data/subcontracts-${year}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Record<string, SubcontractGraph>) => {
        setGraphs(Object.values(data));
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, [year]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return graphs;
    return graphs.filter((g) => {
      return (
        String(g.projectId).includes(q) ||
        g.projectName.toLocaleLowerCase().includes(q) ||
        g.ministry.toLocaleLowerCase().includes(q) ||
        g.blocks.some(
          (b) =>
            b.blockName.toLocaleLowerCase().includes(q) ||
            b.recipients.some((r) => r.name.toLocaleLowerCase().includes(q))
        )
      );
    });
  }, [graphs, query]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let va: number, vb: number;
      if (sortKey === 'projectId') { va = a.projectId; vb = b.projectId; }
      else if (sortKey === 'budget') { va = a.budget; vb = b.budget; }
      else if (sortKey === 'execution') { va = a.execution; vb = b.execution; }
      else if (sortKey === 'maxDepth') { va = a.maxDepth; vb = b.maxDepth; }
      else if (sortKey === 'totalBlockCount') { va = a.totalBlockCount; vb = b.totalBlockCount; }
      else { va = a.totalRecipientCount; vb = b.totalRecipientCount; }
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'projectId' ? 'asc' : 'desc');
    }
  }

  function SortIndicator({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span style={{ color: '#bbb', marginLeft: 4 }}>↕</span>;
    return <span style={{ color: '#3b82f6', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const thStyle: React.CSSProperties = {
    padding: '8px 10px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 600,
    color: '#6b7280',
    borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* ヘッダー */}
        <div style={{ marginBottom: 24 }}>
          <Link href="/" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← トップ</Link>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', marginTop: 8, marginBottom: 4 }}>
            🔗 再委託構造ブラウザ
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            事業ごとのブロック間フロー（再委託構造）を一覧・探索できます。
          </p>
        </div>

        {/* コントロール */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={year}
            onChange={(e) => { const y = Number(e.target.value); setYear(y); router.replace(`/subcontracts?year=${y}`); }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              fontSize: 13,
              background: '#fff',
            }}
          >
            <option value={2024}>2024年度</option>
            <option value={2025}>2025年度</option>
          </select>

          <input
            type="text"
            placeholder="検索（PID・事業名・府省庁・ブロック名・支出先名）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              minWidth: 260,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              fontSize: 13,
            }}
          />

          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {filtered.length.toLocaleString()} 件 / {graphs.length.toLocaleString()} 件
          </span>
        </div>

        {/* テーブル */}
        {loading && <p style={{ color: '#6b7280', fontSize: 14 }}>読み込み中...</p>}
        {error && <p style={{ color: '#ef4444', fontSize: 14 }}>エラー: {error}</p>}
        {!loading && !error && (
          <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => toggleSort('projectId')}>
                    PID <SortIndicator k="projectId" />
                  </th>
                  <th style={{ ...thStyle, minWidth: 200 }}>事業名</th>
                  <th style={thStyle}>府省庁</th>
                  <th style={thStyle} onClick={() => toggleSort('budget')}>
                    予算額 <SortIndicator k="budget" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('execution')}>
                    執行額 <SortIndicator k="execution" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('maxDepth')}>
                    再委託階層 <SortIndicator k="maxDepth" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('totalBlockCount')}>
                    総ブロック数 <SortIndicator k="totalBlockCount" />
                  </th>
                  <th style={thStyle} onClick={() => toggleSort('totalRecipientCount')}>
                    総支出先数 <SortIndicator k="totalRecipientCount" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((g, i) => (
                  <tr
                    key={g.projectId}
                    style={{
                      background: i % 2 === 0 ? '#fff' : '#f9fafb',
                      borderBottom: '1px solid #f3f4f6',
                    }}
                  >
                    <td style={{ padding: '8px 10px', color: '#6b7280' }}>{g.projectId}</td>
                    <td style={{ padding: '8px 10px', maxWidth: 300 }}>
                      <Link
                        href={`/subcontracts/${g.projectId}?year=${year}`}
                        style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 500 }}
                      >
                        {g.projectName}
                      </Link>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#374151', whiteSpace: 'nowrap' }}>{g.ministry}</td>
                    <td style={{ padding: '8px 10px', color: '#374151', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {g.budget > 0 ? formatYen(g.budget) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#374151', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {g.execution > 0 ? formatYen(g.execution) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        background: g.maxDepth >= 3 ? '#fef3c7' : g.maxDepth >= 2 ? '#dbeafe' : '#f3f4f6',
                        color: g.maxDepth >= 3 ? '#92400e' : g.maxDepth >= 2 ? '#1d4ed8' : '#6b7280',
                      }}>
                        {g.maxDepth}層
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>{g.totalBlockCount}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>{g.totalRecipientCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SubcontractsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: '#6b7280', fontSize: 14 }}>読み込み中...</div>}>
      <SubcontractsPageInner />
    </Suspense>
  );
}
