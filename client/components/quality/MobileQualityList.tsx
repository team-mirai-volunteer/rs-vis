import type { QualityScoreItem } from '@/app/lib/api/quality-scores-loader';
import type { PolicyEvaluation } from '@/app/lib/policy-evaluation';
import { Button } from '@/components/ui/button';
import { formatAmount, scoreColor } from './score-format';
import { RecommendationBadge, PersistentUnusedMark } from './score-meta';

export function MobileQualityList({ items, policies, requestYear, onOpen }: {
  items: QualityScoreItem[]; policies: Map<string, PolicyEvaluation> | null; requestYear: boolean; onOpen: (pid: string) => void;
}) {
  return <ul aria-label="事業の評価" className="divide-y divide-mirai-border sm:hidden">
    {items.map(item => {
      const policy = policies?.get(item.pid);
      return <li key={item.pid} className="space-y-3 p-4">
        <div><p className="text-xs text-mirai-text-muted">{item.ministry} · PID {item.pid}</p>
          <h2 className="mt-1 break-words text-sm font-bold leading-relaxed">{item.name}</h2></div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs">総合点 <strong className={`text-lg tabular-nums ${scoreColor(policy?.overallScore ?? null)}`}>{policy?.overallScore ?? '未評価'}</strong></p>
          {policy && <><RecommendationBadge policy={policy} /><PersistentUnusedMark policy={policy} /></>}
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div><dt className="text-mirai-text-muted">{requestYear ? '予算額（要求）' : '予算額'}</dt><dd className="mt-1 font-bold tabular-nums">{item.budgetAmount == null ? '未収録' : formatAmount(item.budgetAmount)}</dd></div>
          <div><dt className="text-mirai-text-muted">執行額</dt><dd className="mt-1 font-bold tabular-nums">{requestYear || item.execAmount == null ? '未収録' : formatAmount(item.execAmount)}</dd></div>
        </dl>
        <Button variant="outline" size="sm" className="w-full" onClick={() => onOpen(item.pid)}>評価・支出先の詳細</Button>
      </li>;
    })}
  </ul>;
}
