'use client';

/**
 * 事業の成果目標・実績（RS シート 3-1 効果発現経路_目標・実績）。
 * 評価一覧の詳細パネルで、アウトカム指標の目標値・実績値・達成率を年度ごとに並べる。
 *
 * これまでアウトカム指標はサイトのどこにも出ておらず、AI 評価の「検証可能性」の根拠が画面から追えなかった。
 * 指標はロジックモデルの段階（アクティビティ→アウトプット→アウトカム）ごとに分け、成果に近いアウトカムを先に出す。
 * 数値は RS に登録された文字列をそのまま整形する（達成率は RS 側の計算値で、「下がると良い指標」も織り込み済み）。
 * 指標が無い事業は API が 404 を返し、何も描かない（指標が無いこと自体は 政策評価 の所見で触れる）。
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProjectIndicator, ProjectIndicatorsResponse } from '@/types/project-indicators';
import { useCached } from './policy-summary-cache';

const cache = new Map<string, ProjectIndicatorsResponse | null>();
const extract = (d: unknown) => d as ProjectIndicatorsResponse;

/** 段階の表示順と配色。アウトカム（成果）を先に出す */
const KIND_META: Record<string, { order: number; label: string; cls: string; note: string }> = {
  'アウトカム': { order: 0, label: 'アウトカム', cls: 'bg-mirai-surface-teal text-primary-accent', note: '事業が社会にもたらす成果の指標' },
  'アウトプット': { order: 1, label: 'アウトプット', cls: 'bg-mirai-surface-light text-mirai-text-secondary', note: '事業の活動量（実施件数など）の指標' },
  'アクティビティ': { order: 2, label: 'アクティビティ', cls: 'bg-mirai-surface-light text-mirai-text-muted', note: '事業で行う活動そのもの' },
};
const kindMeta = (kind: string) => KIND_META[kind] ?? { order: 9, label: kind || '種別不明', cls: 'bg-mirai-surface-light text-mirai-text-muted', note: '' };

/** '1.短期' → '短期' */
const periodLabel = (period: string) => period.replace(/^\d+\./, '');

/** RS の数値文字列を桁区切りに。小数は 2 桁まで。数値でなければそのまま */
export function formatIndicatorValue(raw: string | undefined): string {
  if (raw == null || raw === '') return '—';
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

/** 達成率の色。100% 以上は達成、80% 以上は概ね、それ未満は注意、50% 未満は未達 */
export function rateClass(raw: string | undefined): string {
  if (raw == null || raw === '') return 'text-mirai-text-muted';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'text-mirai-text';
  if (n >= 100) return 'text-status-good-fg';
  if (n >= 80) return 'text-mirai-text';
  if (n >= 50) return 'text-status-warn';
  return 'text-destructive';
}

const formatRate = (raw: string | undefined) => (raw == null || raw === '' ? '—' : `${formatIndicatorValue(raw)}%`);

/**
 * 表に出す年度（昇順）。シート年度までの目標・実績・達成率の年度に、将来の最終目標年度を 1 列だけ添える。
 * 長期アウトカムは 2034 年度まで同じ目標値が並ぶことがあり、全部出すと横に長くなって実績が読めなくなる。
 */
export function displayYears(indicator: ProjectIndicator, sheetYear: number): string[] {
  const all = new Set<string>([...Object.keys(indicator.target), ...Object.keys(indicator.actual), ...Object.keys(indicator.rate)]);
  const years = [...all].filter(y => Number(y) <= sheetYear).sort((a, b) => Number(a) - Number(b));
  const future = [...all].filter(y => Number(y) > sheetYear).map(Number);
  if (future.length) years.push(String(Math.max(...future)));
  return years;
}

function IndicatorCard({ indicator, scaleFont, sheetYear }: { indicator: ProjectIndicator; scaleFont: (px: number) => number; sheetYear: number }) {
  const years = displayYears(indicator, sheetYear);
  const hasNumbers = years.length > 0;
  const name = indicator.indicator && indicator.indicator !== '--' ? indicator.indicator : null;
  const latestActualYear = Object.keys(indicator.actual).map(Number).sort((a, b) => b - a)[0];
  return <li className="rounded-xl border border-mirai-border bg-card px-3 py-2 lg:px-4 lg:py-2.5">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      {indicator.period && <span className="rounded-md bg-mirai-surface-light px-1.5 py-0.5 font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(10) }}>{periodLabel(indicator.period)}</span>}
      {indicator.goalType === '定性的' && <span className="rounded-md bg-mirai-surface-light px-1.5 py-0.5 text-mirai-text-muted" style={{ fontSize: scaleFont(10) }}>定性的</span>}
      <span className="font-bold text-mirai-text" style={{ fontSize: scaleFont(12) }}>
        {name ?? <span className="font-normal text-mirai-text-muted">指標名の記載なし</span>}
        {name && indicator.unit && <span className="ml-1 font-normal text-mirai-text-muted">（{indicator.unit}）</span>}
      </span>
      {indicator.direction && <span className="text-mirai-text-muted" style={{ fontSize: scaleFont(10) }}>{indicator.direction}</span>}
    </div>
    {indicator.goal && <p className="mt-0.5 leading-relaxed text-mirai-text-subtle" style={{ fontSize: scaleFont(11) }}>{indicator.goal}</p>}
    {hasNumbers && <div className="mt-1.5 overflow-x-auto">
      <table className="w-auto border-collapse tabular-nums" style={{ fontSize: scaleFont(11) }}>
        <thead>
          <tr className="text-mirai-text-muted">
            <th scope="col" className="whitespace-nowrap py-0.5 pr-3 text-left font-normal">年度</th>
            {years.map(y => <th key={y} scope="col" className={`whitespace-nowrap py-0.5 pl-3 text-right font-normal ${Number(y) === latestActualYear ? 'text-mirai-text' : ''}`}>{y}{y in indicator.target && !(y in indicator.actual) ? <span className="ml-0.5 text-mirai-text-placeholder" title={Number(y) > sheetYear ? '最終目標年度（実績はこれから）' : '目標のみ（実績は未記載）'}>*</span> : null}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr><th scope="row" className="whitespace-nowrap py-0.5 pr-3 text-left font-normal text-mirai-text-muted">目標</th>{years.map(y => <td key={y} className="py-0.5 pl-3 text-right text-mirai-text-secondary">{formatIndicatorValue(indicator.target[y])}</td>)}</tr>
          <tr><th scope="row" className="whitespace-nowrap py-0.5 pr-3 text-left font-normal text-mirai-text-muted">実績</th>{years.map(y => <td key={y} className="py-0.5 pl-3 text-right font-bold text-mirai-text">{formatIndicatorValue(indicator.actual[y])}</td>)}</tr>
          <tr><th scope="row" className="whitespace-nowrap py-0.5 pr-3 text-left font-normal text-mirai-text-muted">達成率</th>{years.map(y => <td key={y} className={`py-0.5 pl-3 text-right font-bold ${rateClass(indicator.rate[y])}`}>{formatRate(indicator.rate[y])}</td>)}</tr>
        </tbody>
      </table>
    </div>}
    {indicator.qualitativeResult && <p className="mt-1 leading-relaxed text-mirai-text-secondary" style={{ fontSize: scaleFont(11) }}><span className="text-mirai-text-muted">実績（定性）: </span>{indicator.qualitativeResult}</p>}
    {!hasNumbers && !indicator.qualitativeResult && indicator.kind !== 'アクティビティ' && <p className="mt-1 text-mirai-text-muted" style={{ fontSize: scaleFont(11) }}>目標値・実績値の記載なし</p>}
    {indicator.source && <p className="mt-0.5 text-mirai-text-muted" style={{ fontSize: scaleFont(10) }}>出典: {indicator.source}</p>}
  </li>;
}

/**
 * @param pid 事業ID
 * @param year 参照する RS シート年度（予算要求年度のときは呼び出し側が実績のある年度へ写す）
 * @param scaleFont 共有部品の文字サイズ倍率（サイドパネル基準 11px）
 * @param defaultOpen 初期状態で開くか。評価一覧の詳細パネルは開く
 */
export function ProjectOutcomeIndicators({ pid, year, scaleFont, padding = 'px-3.5 py-2', defaultOpen = false, id, focusTick = 0 }: {
  pid: number | string; year: number | string; scaleFont: (px: number) => number; padding?: string; defaultOpen?: boolean;
  /** 節の要素 id。政策評価の所見（検証可能性）からここへ飛ぶリンクの飛び先に使う */
  id?: string;
  /** 0 より大きい値に変わるたびに節を開いて画面内へスクロールする（所見のリンクが押されたとき） */
  focusTick?: number;
}) {
  const key = `${year}-${pid}`;
  const data = useCached(cache, key, `/api/project-indicators/${pid}?year=${year}`, extract);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!focusTick || !id) return;
    setOpen(true);
    // 開いてから描画された高さでスクロールする
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [focusTick, id]);
  const groups = useMemo(() => {
    if (!data) return [];
    const byKind = new Map<string, ProjectIndicator[]>();
    for (const i of data.indicators) {
      const list = byKind.get(i.kind) ?? [];
      list.push(i);
      byKind.set(i.kind, list);
    }
    return [...byKind.entries()].sort((a, b) => kindMeta(a[0]).order - kindMeta(b[0]).order);
  }, [data]);
  if (data === undefined) return null;
  // 指標の記載が無い事業も 1 行で示す（「無い」こと自体が成果設計の情報。LP の洞察では 954 事業がこれに当たる）
  if (data === null || data.indicators.length === 0) {
    return <section id={id} aria-label="成果目標・実績" className={padding} style={{ fontSize: scaleFont(11) }}>
      <span className="font-bold text-mirai-text-subtle">成果目標・実績</span>
      <span className="ml-[5px] text-mirai-text-muted" style={{ fontSize: scaleFont(10) }}>レビューシートに成果指標の記載なし</span>
    </section>;
  }

  const outcomes = data.indicators.filter(i => i.kind === 'アウトカム');
  const outcomesWithActual = outcomes.filter(i => Object.keys(i.actual).length > 0 || i.qualitativeResult);
  const summary = outcomes.length
    ? `アウトカム指標 ${outcomes.length}件（実績あり ${outcomesWithActual.length}件）`
    : `アウトカム指標なし・${data.indicators.length}件`;
  const title = '成果目標・実績';
  const explanation = `${data.sheetYear}年度の行政事業レビューシートに登録された成果目標と指標の目標値・実績値・達成率（直近 6 年度）。達成率は RS システムの計算値`;
  const metaPx = scaleFont(10);
  return <section id={id} aria-label={title} className={padding} style={{ fontSize: scaleFont(11) }}>
    <Button variant="ghost" size="xs" aria-expanded={open} onClick={() => setOpen(v => !v)} title={`${open ? '成果目標・実績を閉じる' : '成果目標・実績を開く'}。${explanation}`}
      className="h-auto justify-start gap-[5px] rounded-md p-0 font-normal hover:bg-transparent hover:text-mirai-text has-[>svg]:px-0">
      <span className="font-bold text-mirai-text-subtle" style={{ fontSize: scaleFont(11) }}>{title}</span>
      <span className="text-mirai-text-muted" style={{ fontSize: metaPx }}>{summary}</span>
      {open
        ? <ChevronDown aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: metaPx, height: metaPx }} />
        : <ChevronRight aria-hidden="true" className="shrink-0 text-mirai-text-muted" style={{ width: metaPx, height: metaPx }} />}
    </Button>
    {open && <div className="mt-1.5 space-y-2.5">
      {groups.map(([kind, list]) => {
        const meta = kindMeta(kind);
        return <div key={kind}>
          <div className="mb-1 flex items-baseline gap-2">
            <span className={`rounded-md px-1.5 py-0.5 font-bold ${meta.cls}`} style={{ fontSize: scaleFont(10) }}>{meta.label}</span>
            <span className="text-mirai-text-muted" style={{ fontSize: metaPx }}>{list.length}件{meta.note && `・${meta.note}`}</span>
          </div>
          <ul className="space-y-1.5">
            {list.map(i => <IndicatorCard key={i.no} indicator={i} scaleFont={scaleFont} sheetYear={data.sheetYear} />)}
          </ul>
        </div>;
      })}
      <p className="text-mirai-text-muted" style={{ fontSize: metaPx }}>{explanation}。* は実績が未記載の年度（シート年度より後は最終目標年度だけを示す）</p>
    </div>}
  </section>;
}
