'use client';

/**
 * ツールチップに添える「何に支払ったか」（契約の概要）。バブルチャートの支出先・サンキー図の支出先ノードと帯で共用する。
 * 「個人A」のような伏せ字や、金額だけでは誤解しやすい支出先を、元データの契約の記載で補う。
 * 表示はホバーだけ（クリックはそれぞれの図の選択操作に使うので、固定表示は持たない）。
 */
import { useRecipientContracts } from '@/client/hooks/useRecipientContracts';
import { ContractMethodBadge } from '@/client/components/quality/ContractMethodBadge';

/** 出す契約の行数。残りは「ほか○件」にまとめる */
const MAX_LINES = 3;

export function RecipientContractSummary({ year, name, pids, contracts, className }: {
  /** RS シート年度。null なら出さない（暫定データなど再委託構造が無いとき） */
  year: number | string | null;
  name: string;
  /** 支出元の事業（金額の大きい順） */
  pids: readonly (string | number)[];
  /** 手元に契約の概要があるとき（1事業の再委託構造を読み込み済みなど）。渡すと API を呼ばない */
  contracts?: readonly string[];
  className?: string;
}) {
  const fetched = useRecipientContracts(contracts ? null : year, name, pids);
  const data = contracts
    ? { name, entries: contracts.length > 0 ? [{ pid: Number(pids[0] ?? 0), projectName: '', amount: 0, contracts: [...contracts] }] : [] }
    : fetched;
  if (data === undefined) return <p className={`text-[11px] text-mirai-text-muted ${className ?? ''}`}>契約の内容を読み込み中…</p>;
  if (!data) return null;
  const multiProject = data.entries.length > 1;
  const lines = data.entries.flatMap(entry => entry.contracts.map(contract => ({ pid: entry.pid, projectName: entry.projectName, contract })));
  const methods = data.entries.flatMap(entry => (entry.methods ?? []).map(method => ({ pid: entry.pid, projectName: entry.projectName, method })));
  if (lines.length === 0 && methods.length === 0) return null;
  const shown = lines.slice(0, MAX_LINES);
  const restLines = lines.length - shown.length;
  const restProjects = contracts ? 0 : Math.max(0, pids.length - data.entries.length);
  return (
    <div className={`text-[11px] leading-relaxed ${className ?? ''}`}>
      {methods.length > 0 && <>
        <p className="font-bold text-mirai-text-muted">契約方式</p>
        <ul className="m-0 mb-1 flex list-none flex-col gap-0.5 p-0">
          {methods.slice(0, MAX_LINES).map(({ pid, projectName, method }) => (
            <li key={`${pid}-${method.m}`} className="flex min-w-0 items-center gap-1">
              {multiProject && <span className="shrink-0 truncate text-mirai-text-muted">{projectName}：</span>}
              <ContractMethodBadge method={method.m} />
              <span className="shrink-0 tabular-nums text-mirai-text-muted">{method.count}件{method.singleBidder > 0 && <span className="font-bold text-status-warn-fg">（1者応札 {method.singleBidder}件）</span>}</span>
            </li>
          ))}
        </ul>
      </>}
      {lines.length > 0 && <p className="font-bold text-mirai-text-muted">主な契約</p>}
      <ul className="m-0 list-none p-0">
        {shown.map(line => (
          <li key={`${line.pid}-${line.contract}`} className="text-mirai-text-secondary">
            {multiProject && <span className="text-mirai-text-muted">{line.projectName}：</span>}
            {line.contract}
          </li>
        ))}
      </ul>
      {(restLines > 0 || restProjects > 0) && (
        <p className="text-mirai-text-muted">
          ほか{restLines > 0 ? `${restLines}件` : ''}{restLines > 0 && restProjects > 0 ? '・' : ''}{restProjects > 0 ? `${restProjects}事業` : ''}
        </p>
      )}
    </div>
  );
}
