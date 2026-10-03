import {
  CONTRACT_CATEGORY_DESCRIPTIONS, CONTRACT_METHOD_LABELS, contractCategory,
  type ContractCategory, type ContractMethodCode,
} from '@/app/lib/contract-method';

const CATEGORY_CLS: Record<ContractCategory, string> = {
  open: 'bg-status-good-bg text-status-good-fg',
  selective: 'bg-primary/10 text-primary-accent',
  'negotiated-competitive': 'bg-primary/10 text-primary-accent',
  'negotiated-small': 'bg-mirai-surface text-mirai-text-subtle',
  // 競争を経ない随意契約は確認したい対象なので目立たせる（不正の判定ではない）
  'negotiated-sole': 'bg-status-warn-bg text-status-warn-fg',
  'multi-year': 'bg-mirai-surface text-mirai-text-subtle',
  'non-contract': 'bg-mirai-surface text-mirai-text-muted',
};

/** 契約方式のバッジ。title に方式の意味・補足・応札者数・落札率を出す */
export function ContractMethodBadge({ method, text, applicants, bidRate }: {
  method: ContractMethodCode; text?: string; applicants?: number; bidRate?: number;
}) {
  const category = contractCategory(method);
  const facts = [
    applicants !== undefined && `応札・応募 ${applicants}者`,
    bidRate !== undefined && `落札率 ${bidRate.toFixed(1)}%`,
  ].filter(Boolean).join('・');
  const title = [CONTRACT_METHOD_LABELS[method], text && `補足: ${text}`, facts, CONTRACT_CATEGORY_DESCRIPTIONS[category], '出典: RS公開API']
    .filter(Boolean).join('\n');
  // 「その他」は補足（再委託・給付金・示達など）の方が中身を表すので、補足があればそれを出す
  const label = method === 'others' && text ? text : CONTRACT_METHOD_LABELS[method];
  return <span title={title} className="inline-flex min-w-0 items-center gap-1">
    <span className={`truncate rounded-md px-1.5 py-0.5 text-[10px] font-bold ${CATEGORY_CLS[category]}`}>{label}</span>
    {applicants !== undefined && category !== 'non-contract' && <span className={`shrink-0 tabular-nums text-[10px] ${applicants === 1 ? 'font-bold text-status-warn-fg' : 'text-mirai-text-muted'}`}>{applicants}者</span>}
  </span>;
}
