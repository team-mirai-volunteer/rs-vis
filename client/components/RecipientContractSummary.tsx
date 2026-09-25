'use client';

/**
 * ツールチップに添える「何に支払ったか」（契約の概要）。バブルチャートの支出先・サンキー図の支出先ノードと帯で共用する。
 * 「個人A」のような伏せ字や、金額だけでは誤解しやすい支出先を、元データの契約の記載で補う。
 * 表示はホバーだけ（クリックはそれぞれの図の選択操作に使うので、固定表示は持たない）。
 */
import { useRecipientContracts } from '@/client/hooks/useRecipientContracts';

/** 出す契約の行数。残りは「ほか○件」にまとめる */
const MAX_LINES = 3;

export function RecipientContractSummary({ year, name, pids, className }: {
  /** RS シート年度。null なら出さない（暫定データなど再委託構造が無いとき） */
  year: number | string | null;
  name: string;
  /** 支出元の事業（金額の大きい順） */
  pids: readonly (string | number)[];
  className?: string;
}) {
  const data = useRecipientContracts(year, name, pids);
  if (data === undefined) return <p className={`text-[11px] text-mirai-text-muted ${className ?? ''}`}>契約の内容を読み込み中…</p>;
  if (!data) return null;
  const multiProject = data.entries.length > 1;
  const lines = data.entries.flatMap(entry => entry.contracts.map(contract => ({ pid: entry.pid, projectName: entry.projectName, contract })));
  if (lines.length === 0) return null;
  const shown = lines.slice(0, MAX_LINES);
  const restLines = lines.length - shown.length;
  const restProjects = Math.max(0, pids.length - data.entries.length);
  return (
    <div className={`text-[11px] leading-relaxed ${className ?? ''}`}>
      <p className="font-bold text-mirai-text-muted">主な契約</p>
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
