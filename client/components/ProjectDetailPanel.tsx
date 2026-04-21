'use client';

import { useState, useEffect } from 'react';
import type { ProjectDetail } from '@/types/project-details';

interface ProjectDetailPanelProps {
  projectId: number;
  projectName: string;
}

/**
 * 事業詳細パネルコンポーネント
 * 事業ビューで事業名の下に表示される
 */
export default function ProjectDetailPanel({ projectId, projectName }: ProjectDetailPanelProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    async function fetchDetail() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/project-details/${projectId}`);

        if (!response.ok) {
          if (response.status === 404) {
            setError('事業詳細情報が見つかりません');
          } else {
            setError('事業詳細情報の取得に失敗しました');
          }
          return;
        }

        const data = await response.json();
        setDetail(data);
      } catch (err) {
        console.error('Failed to fetch project details:', err);
        setError('事業詳細情報の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    }

    fetchDetail();
  }, [projectId]);

  if (loading) {
    return (
      <div className="text-sm text-gray-500 italic">読み込み中...</div>
    );
  }

  if (error || !detail) {
    return (
      <div className="text-sm text-yellow-700">{error || '事業詳細情報が見つかりません'}</div>
    );
  }

  return (
    <div className="mt-3">
      {!isExpanded ? (
        /* 折りたたみ時: コンパクト表示 */
        <div className="text-sm text-gray-700">
          {/* 基本情報（1行） */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
            <span className="text-gray-600">
              <span className="font-medium">府省庁:</span> {detail.ministry}
            </span>
            {detail.bureau && (
              <span className="text-gray-600">
                <span className="font-medium">局・庁:</span> {detail.bureau}
              </span>
            )}
            <span>
              <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">
                {detail.category}
              </span>
            </span>
            <span className="text-gray-600">
              {detail.startYearUnknown ? '不明' : detail.startYear || '不明'}年
              {' 〜 '}
              {detail.noEndDate ? '継続中' : detail.endYear ? `${detail.endYear}年` : '不明'}
            </span>
            {detail.implementationMethods.length > 0 && (
              <span>
                {detail.implementationMethods.map(method => (
                  <span
                    key={method}
                    className="inline-block px-2 py-0.5 bg-green-100 text-green-800 rounded text-xs mr-1"
                  >
                    {method}
                  </span>
                ))}
              </span>
            )}
            {detail.url && (
              <a
                href={detail.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-blue-600 hover:text-blue-800 text-xs font-medium"
              >
                <svg className="w-3 h-3 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                詳細
              </a>
            )}
          </div>

          {/* 事業の目的（プレビュー） */}
          {detail.purpose && (
            <div className="flex items-center gap-2 mb-2">
              <span className="font-medium text-gray-900 shrink-0">目的:</span>
              <p className="text-gray-700 flex-1 min-w-0 line-clamp-1">
                {detail.purpose}
              </p>
            </div>
          )}

          {/* 展開ボタン */}
          <button
            onClick={() => setIsExpanded(true)}
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span>詳細を表示</span>
          </button>
        </div>
      ) : (
        /* 展開時: カード形式で詳細表示 */
        <div className="space-y-3 max-w-full">
          {/* 基本情報カード */}
          <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm break-words">
              <div>
                <span className="font-semibold text-gray-700">府省庁:</span>
                <span className="ml-2 text-gray-900">{detail.ministry}</span>
              </div>
              {detail.bureau && (
                <div>
                  <span className="font-semibold text-gray-700">局・庁:</span>
                  <span className="ml-2 text-gray-900">{detail.bureau}</span>
                </div>
              )}
              <div>
                <span className="font-semibold text-gray-700">事業区分:</span>
                <span className="ml-2">
                  <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                    {detail.category}
                  </span>
                </span>
              </div>
              <div>
                <span className="font-semibold text-gray-700">事業期間:</span>
                <span className="ml-2 text-gray-900">
                  {detail.startYearUnknown ? '不明' : detail.startYear || '不明'}年
                  {' 〜 '}
                  {detail.noEndDate ? '継続中' : detail.endYear ? `${detail.endYear}年` : '不明'}
                </span>
              </div>
              {detail.majorExpense && (
                <div>
                  <span className="font-semibold text-gray-700">主要経費:</span>
                  <span className="ml-2 text-gray-900">{detail.majorExpense}</span>
                </div>
              )}
              {detail.implementationMethods.length > 0 && (
                <div>
                  <span className="font-semibold text-gray-700">実施方法:</span>
                  <span className="ml-2">
                    {detail.implementationMethods.map(method => (
                      <span
                        key={method}
                        className="inline-block px-2 py-1 bg-green-100 text-green-800 rounded text-xs mr-1 mb-1"
                      >
                        {method}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>

            {detail.url && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <a
                  href={detail.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  事業概要の詳細（外部リンク）
                </a>
              </div>
            )}
          </div>

          {/* 事業の目的 */}
          {detail.purpose && (
            <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <h3 className="font-semibold text-gray-900 mb-2">事業の目的</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed break-words">
                {detail.purpose}
              </p>
            </div>
          )}

          {/* 現状・課題 */}
          {detail.currentIssues && (
            <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <h3 className="font-semibold text-gray-900 mb-2">現状・課題</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed break-words">
                {detail.currentIssues}
              </p>
            </div>
          )}

          {/* 事業の概要 */}
          {detail.overview && (
            <div className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <h3 className="font-semibold text-gray-900 mb-2">事業の概要</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed break-words">
                {detail.overview}
              </p>
            </div>
          )}

          {/* 備考 */}
          {detail.remarks && (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
              <p className="text-sm text-gray-600 break-words">
                <span className="font-semibold">備考:</span> {detail.remarks}
              </p>
            </div>
          )}

          {/* 閉じるボタン */}
          <button
            onClick={() => setIsExpanded(false)}
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors"
          >
            <svg
              className="w-4 h-4 transform rotate-180"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span>詳細を閉じる</span>
          </button>
        </div>
      )}
    </div>
  );
}
