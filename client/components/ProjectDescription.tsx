import type { ProjectDetail } from '@/types/project-details';

/** RS本文の節区切りを改行にする。URL・日付・分数に含まれるスラッシュは保つ。 */
export function formatProjectText(text: string): string {
  return text.split(/(https?:\/\/\S+)/g)
    .map((part, index) => index % 2 === 1 ? part : part.replace(/(?<![0-9])\/(?![0-9])/g, '\n'))
    .join('');
}

/** サイドパネルと詳細ダイアログで共通の事業説明。 */
export function ProjectDescription({ detail, showSourceLink = true }: {
  detail: ProjectDetail;
  showSourceLink?: boolean;
}) {
  return <div className="space-y-3 text-xs">
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-mirai-text-muted">
      {detail.category && <span>区分: {detail.category}</span>}
      {(detail.startYear || detail.startYearUnknown) && <span>開始: {detail.startYear ? `${detail.startYear}年度` : '不明'}</span>}
      <span>終了: {detail.noEndDate ? '予定なし' : detail.endYear ? `${detail.endYear}年度` : '-'}</span>
      {detail.implementationMethods?.length > 0 && <span>実施方法: {detail.implementationMethods.join('・')}</span>}
      {showSourceLink && detail.url && /^https?:\/\//.test(detail.url) && <a href={detail.url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline hover:text-primary-accent">事業概要URL ↗</a>}
    </div>
    {[
      { label: '目的', text: detail.purpose },
      { label: '現状・課題', text: detail.currentIssues },
      { label: '概要', text: detail.overview },
    ].map(({ label, text }) => text ? <div key={label}>
      <div className="mb-1 font-bold text-mirai-text-secondary">{label}</div>
      <div className="whitespace-pre-wrap break-words leading-relaxed text-mirai-text-subtle">{formatProjectText(text)}</div>
    </div> : null)}
  </div>;
}
