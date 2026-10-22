/**
 * LP（app/lp/insights.ts）の数字を public/data の生成物から再計算し、載せている値と突き合わせる。
 *
 * 実行: npx tsx scripts/verify-lp-figures.ts
 *
 * 各行は「数字の名前 / 載せている値 / 再計算の値 / 一致」。原資料（PDF・報告書の総括表）から読んだ数字は
 * ここでは再計算できないので、そのデータ（app/lib/tax-expenditures/data.json）から読める範囲だけ確かめる。
 * 集計の定義は各カードの basis（docs/tasks の根拠メモ）に合わせる。
 */
import { tryReadDataJson } from '../app/lib/api/data-file';
import type { ContractMethodsByPid } from '../app/lib/contract-method';
import { contractCategory } from '../app/lib/contract-method';
import type { RecipientRowsByPid } from '../app/lib/api/quality-recipients-loader';
import type { FundsFile } from '../types/funds';
import type { ProjectBudgetHistoryData } from '../types/project-budget-history';
import type { SubcontractIndex } from '../types/subcontract';
import type { ProjectDetailsData } from '../types/project-details';
import type { OthersCountsByPid } from '../app/lib/others-count';
import { creditSeries } from '../app/lib/tax-expenditures/credits';
import { HERO_STATS, INSIGHTS } from '../app/lp/insights';

type Item = { pid: string; name: string; ministry: string; budgetAmount: number; execAmount: number | null; spendTotal: number; opaqueRatio: number | null; cnFillRatio: number | null; recipientCount?: number; policyCategory?: string | null };
type Outcome = { indicators: { kind: string; target: Record<string, string>; actual: Record<string, string>; rate: Record<string, string>; indicator: string; goal: string; qualitativeResult: string; latestRate: { year: number; value: number | null } | null }[] };

function must<T>(name: string): T {
  const d = tryReadDataJson<T>(name);
  if (!d) throw new Error(`${name} が無い（bash scripts/decompress-data.sh で展開）`);
  return d;
}

const items = must<Item[]>('project-quality-scores-2025.json');
const contracts = must<ContractMethodsByPid>('contract-methods-2025.json');
const recipients = must<RecipientRowsByPid>('project-quality-recipients-2025.json');
const funds = must<FundsFile>('funds.json');
const history = must<ProjectBudgetHistoryData>('rs2025-project-budget-history.json');
const subcontracts = must<SubcontractIndex>('subcontracts-2025.json');
const details = must<ProjectDetailsData>('rs2025-project-details.json');
const others = must<OthersCountsByPid>('others-counts-2025.json');
const outcomes = must<Record<string, Outcome>>('rs2025-project-outcomes.json');

const byPid = new Map(items.map(i => [i.pid, i]));
const oku = (yen: number) => yen / 1e8;
const cho = (yen: number) => yen / 1e12;
const pct = (a: number, b: number) => (a / b) * 100;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const rows: { figure: string; shown: string; computed: string; ok: boolean }[] = [];
function check(figure: string, shown: string | number, computed: string | number, ok?: boolean) {
  const s = String(shown), c = String(computed);
  rows.push({ figure, shown: s, computed: c, ok: ok ?? s === c });
}
const r1 = (x: number) => x.toFixed(1);
const r2 = (x: number) => x.toFixed(2);

// ── Hero ──
const budgetTotal = items.reduce((s, i) => s + i.budgetAmount, 0);
check('Hero 歳出予算現額（兆円）', HERO_STATS[0].value, r1(cho(budgetTotal)));
check('Hero 事業数', HERO_STATS[1].value, items.length.toLocaleString('en-US'));
check('Hero 延べ支出先記載（万件）', HERO_STATS[2].value, r1(items.reduce((s, i) => s + (i.recipientCount ?? 0), 0) / 1e4));
const funds2026 = funds.funds.map(f => ({ f, y: f.years.find(y => y.sheetYear === 2026) })).filter((x): x is { f: typeof x.f; y: NonNullable<typeof x.y> } => !!x.y);
const fundBalance = funds2026.reduce((s, { y }) => s + (y.balance ?? 0), 0);
check('Hero 基金残高（兆円）/ 基金数', `${HERO_STATS[3].value} / 328`, `${r1(cho(fundBalance))} / ${funds2026.length}`);

// ── 1者応札 ──
const allContracts = Object.entries(contracts).flatMap(([pid, rs]) => rs.map(r => ({ pid, ...r })));
const competitive = allContracts.filter(r => ['open', 'selective'].includes(contractCategory(r.m)));
const recorded = competitive.filter(r => r.ap !== undefined);
const single = recorded.filter(r => r.ap === 1);
check('1者応札: 競争入札件数 / 応札者数あり / 1者', '17,148 / 16,948 / 8,134', `${competitive.length.toLocaleString('en-US')} / ${recorded.length.toLocaleString('en-US')} / ${single.length.toLocaleString('en-US')}`);
check('1者応札: 率 / 金額（億円）/ 金額率', '48.0% / 9,036 / 43.3%', `${r1(pct(single.length, recorded.length))}% / ${Math.round(oku(single.reduce((s, r) => s + (r.a ?? 0), 0))).toLocaleString('en-US')} / ${r1(pct(single.reduce((s, r) => s + (r.a ?? 0), 0), recorded.reduce((s, r) => s + (r.a ?? 0), 0)))}%`);
const withRate = recorded.filter(r => r.br !== undefined && r.br !== null && (r.ap ?? 0) >= 1);
const sr = withRate.filter(r => r.ap === 1).map(r => r.br!), mr = withRate.filter(r => r.ap !== 1 && (r.ap ?? 0) >= 2).map(r => r.br!);
check('1者応札: 落札率あり件数 / 1者平均(n) / 複数平均(n)', '12,188 / 93.0 (5,651) / 82.2 (6,537)', `${withRate.length.toLocaleString('en-US')} / ${r1(mean(sr))} (${sr.length.toLocaleString('en-US')}) / ${r1(mean(mr))} (${mr.length.toLocaleString('en-US')})`);
check('1者応札: 中央値 1者 / 複数', '97.4 / 88.6', `${r1(median(sr))} / ${r1(median(mr))}`);
const wavg = (rs: typeof withRate) => rs.reduce((s, r) => s + r.br! * (r.a ?? 0), 0) / rs.reduce((s, r) => s + (r.a ?? 0), 0);
check('1者応札: 金額加重 1者 / 複数', '95.9 / 88.8', `${r1(wavg(withRate.filter(r => r.ap === 1)))} / ${r1(wavg(withRate.filter(r => (r.ap ?? 0) >= 2)))}`);
const ministryOf = (pid: string) => byPid.get(pid)?.ministry ?? '';
const minRate = (m: string) => { const rs = recorded.filter(r => ministryOf(r.pid).includes(m)); return `${Math.round(pct(rs.filter(r => r.ap === 1).length, rs.length))}%`; };
check('1者応札: 府省別 原子力規制委/環境/海保/文科/防衛', '73% 68% 63% 62% 53%', ['原子力規制委員会', '環境省', '海上保安庁', '文部科学省', '防衛省'].map(minRate).join(' '));
const defSingle = recorded.filter(r => ministryOf(r.pid) === '防衛省');
check('1者応札: 防衛省 金額（億円）/ 母数金額', '2,482 / 4,333', `${Math.round(oku(defSingle.filter(r => r.ap === 1).reduce((s, r) => s + (r.a ?? 0), 0))).toLocaleString('en-US')} / ${Math.round(oku(defSingle.reduce((s, r) => s + (r.a ?? 0), 0))).toLocaleString('en-US')}`);
const high = withRate.filter(r => r.ap === 1 && r.br! >= 99);
check('1者応札かつ落札率99%以上: 件数 / 億円', '2,038 / 2,352', `${high.length.toLocaleString('en-US')} / ${Math.round(oku(high.reduce((s, r) => s + (r.a ?? 0), 0))).toLocaleString('en-US')}`);
const sole = allContracts.filter(r => contractCategory(r.m) === 'negotiated-sole');
check('随意契約（特命・不落）: 件数 / 兆円', '11,487 / 2.21', `${sole.length.toLocaleString('en-US')} / ${r2(cho(sole.reduce((s, r) => s + (r.a ?? 0), 0)))}`);

// ── 基金 ──
const tenYears = funds2026.filter(({ y }) => y.balance != null && y.expense != null && y.expense > 0 && y.balance / y.expense >= 10);
check('基金: 残高10年分超 件数 / 兆円', '72 / 4.87', `${tenYears.length} / ${r2(cho(tenYears.reduce((s, { y }) => s + (y.balance ?? 0), 0)))}`);
const newer = tenYears.filter(({ f }) => (f.createdYear ?? 0) >= 2023), older = tenYears.filter(({ f }) => (f.createdYear ?? 0) < 2023);
check('基金: 2023年度以降造成 件数 / 兆円、以前 件数 / 兆円', '15 / 1.40、57 / 3.47', `${newer.length} / ${r2(cho(newer.reduce((s, { y }) => s + (y.balance ?? 0), 0)))}、${older.length} / ${r2(cho(older.reduce((s, { y }) => s + (y.balance ?? 0), 0)))}`);
const closed = funds2026.filter(({ f, y }) => f.newApplicationEndDate && f.newApplicationEndDate < '2025-04-01' && (y.balance ?? 0) > 0);
check('基金: 受付終了で残高あり 件数 / 兆円', '33 / 1.27', `${closed.length} / ${r2(cho(closed.reduce((s, { y }) => s + (y.balance ?? 0), 0)))}`);
const returned = funds2026.filter(({ y }) => (y.returned ?? 0) > 0);
check('基金: 国庫返納 件数 / 億円', '33 / 4,042', `${returned.length} / ${Math.round(oku(returned.reduce((s, { y }) => s + (y.returned ?? 0), 0))).toLocaleString('en-US')}`);

// ── 執行率 ──
const big = items.filter(i => i.budgetAmount >= 1e9);
const low = big.filter(i => i.execAmount != null && i.execAmount / i.budgetAmount < 0.5);
check('執行率50%未満: 母数 / 件数 / 予算兆 / 執行兆', '1,632 / 342 / 7.72 / 2.43', `${big.length.toLocaleString('en-US')} / ${low.length} / ${r2(cho(low.reduce((s, i) => s + i.budgetAmount, 0)))} / ${r2(cho(low.reduce((s, i) => s + (i.execAmount ?? 0), 0)))}`);
// 「予算現額100億円以上で執行率50%未満」の年が 2021〜2024 年度に3年以上ある事業
const chronic = Object.entries(history.projects).filter(([, pts]) =>
  pts.filter(p => p.fiscalYear >= 2021 && p.fiscalYear <= 2024 && (p.totalBudget ?? 0) >= 1e10 && p.executedAmount != null && p.executedAmount / p.totalBudget! < 0.5).length >= 3);
check('執行率: 100億円以上かつ50%未満の年が3年以上', 38, chronic.length);
// 全体の執行率は執行額が未記載の事業を 0 として合計する（LP の定義）
const yearRate = (fy: number) => { const ps = Object.values(history.projects).flat().filter(p => p.fiscalYear === fy); return r1(pct(ps.reduce((s, p) => s + (p.executedAmount ?? 0), 0), ps.reduce((s, p) => s + (p.totalBudget ?? 0), 0))); };
check('執行率: 全体 2021 / 2022 / 2023 / 2024', '85.3 / 83.7 / 85.7 / 87.0', [2021, 2022, 2023, 2024].map(yearRate).join(' / '));

// ── その他 ──
const otherRows = Object.values(others).flatMap(blocks => Object.values(blocks));
check('その他: 事業数 / 件数 / 兆円', '1,526 / 2,591,597 / 22.32', `${Object.keys(others).length.toLocaleString('en-US')} / ${otherRows.reduce((s, b) => s + b.n, 0).toLocaleString('en-US')} / ${r2(cho(otherRows.reduce((s, b) => s + (b.a ?? 0), 0)))}`);
const opaqueW = items.filter(i => i.opaqueRatio != null);
check('その他: 不透明比率（支出加重）%', 19.2, r1(pct(opaqueW.reduce((s, i) => s + i.opaqueRatio! * i.spendTotal, 0), opaqueW.reduce((s, i) => s + i.spendTotal, 0))));
check('その他: 不透明50%超かつ支出100億円以上', 85, items.filter(i => (i.opaqueRatio ?? 0) > 0.5 && i.spendTotal >= 1e10).length);
const cnW = items.filter(i => i.cnFillRatio != null && i.recipientCount);
check('その他: 法人番号記入率（支出先数加重）%', 91.2, r1(pct(cnW.reduce((s, i) => s + i.cnFillRatio! * i.recipientCount!, 0), cnW.reduce((s, i) => s + i.recipientCount!, 0))));

// ── 再委託 ──
const depths = Object.values(subcontracts).map(g => g.maxDepth);
const dist = [1, 2, 3, 4, 5, 30].map(d => depths.filter(x => x === d).length);
check('再委託: 深さ分布 1/2/3/4/5/30', '3,584/1,765/371/64/9/1', dist.map(n => n.toLocaleString('en-US')).join('/'));
const re = Object.values(subcontracts).filter(g => g.maxDepth >= 2);
check('再委託あり: 件数 / %', '2,210 / 38%', `${re.length.toLocaleString('en-US')} / ${Math.round(pct(re.length, items.length))}%`);
const deep = Object.values(subcontracts).filter(g => g.maxDepth >= 3);
const deepPids = Object.entries(subcontracts).filter(([, g]) => g.maxDepth >= 3).map(([pid]) => pid);
check('再委託 3段以上: 件数 / 支出先への支出合計 兆円', '445 / 17.1', `${deep.length} / ${r1(cho(deepPids.reduce((s, pid) => s + (byPid.get(pid)?.spendTotal ?? 0), 0)))}`);
const sep = Object.values(subcontracts).filter(g => g.hasSeparateOrigin);
check('別財源の合流: 件数 / 合流額 兆円', '27 / 3.46', `${sep.length} / ${r2(cho(sep.reduce((s, g) => s + g.separateOriginAmount, 0)))}`);

// ── 防衛 ──
const initial = (pid: string, fy: number) => history.projects[pid]?.find(p => p.fiscalYear === fy)?.initialBudget ?? null;
const defense = items.filter(i => i.policyCategory === 'defense');
const defBoth = defense.filter(i => initial(i.pid, 2021) != null && initial(i.pid, 2025) != null);
const d21 = defBoth.reduce((s, i) => s + initial(i.pid, 2021)!, 0), d25 = defBoth.reduce((s, i) => s + initial(i.pid, 2025)!, 0);
check('防衛: 事業数 / 2021当初兆 / 2025当初兆 / 倍', '228 / 2.39 / 4.44 / 1.9', `${defense.length} / ${r2(cho(d21))} / ${r2(cho(d25))} / ${r1(d25 / d21)}`);
const tripled = Object.keys(history.projects).filter(pid => (initial(pid, 2021) ?? 0) >= 1e9 && (initial(pid, 2025) ?? 0) >= 3 * initial(pid, 2021)!);
check('当初予算が4年で3倍以上（2021年度10億円以上）', 34, tripled.length);

// ── アウトカム指標 ──
const noOutcome = items.filter(i => !(outcomes[i.pid]?.indicators ?? []).some(x => x.kind === 'アウトカム'));
check('アウトカム指標なし: 件数 / % / 予算兆', '954 / 16.5 / 10.06', `${noOutcome.length} / ${r1(pct(noOutcome.length, items.length))} / ${r2(cho(noOutcome.reduce((s, i) => s + i.budgetAmount, 0)))}`);
const hasOutcome = items.filter(i => !noOutcome.includes(i));
const noTarget = hasOutcome.filter(i => !outcomes[i.pid].indicators.some(x => x.kind === 'アウトカム' && Object.keys(x.target).length > 0));
const noActual = hasOutcome.filter(i => !outcomes[i.pid].indicators.some(x => x.kind === 'アウトカム' && Object.keys(x.actual).length > 0));
check('アウトカム: 目標値なし / 実績なし（指標はある事業）', '501 / 1,224', `${noTarget.length} / ${noActual.length.toLocaleString('en-US')}`);
const minNo = (m: string) => { const xs = items.filter(i => i.ministry === m); return `${Math.round(pct(xs.filter(i => noOutcome.includes(i)).length, xs.length))}%`; };
check('アウトカムなし率: 外務 / 経産 / 文化庁 / 環境 / 厚労 / 防衛', '49% 47% 43% 41% 0% 0%', ['外務省', '経済産業省', '文化庁', '環境省', '厚生労働省', '防衛省'].map(minNo).join(' '));
check('アウトカムなし かつ 予算100億円以上', 103, noOutcome.filter(i => i.budgetAmount >= 1e10).length);
const rates = Object.values(outcomes).flatMap(o => o.indicators.filter(x => x.kind === 'アウトカム' && x.latestRate?.value != null).map(x => x.latestRate!.value!));
check('アウトカム達成率: 指標数 / 中央値 / 100%以上', '7,983 / 100 / 4,936', `${rates.length.toLocaleString('en-US')} / ${median(rates)} / ${rates.filter(r => r >= 100).length.toLocaleString('en-US')}`);
const started = Object.values(details).filter(d => d.startYear != null);
const noEnd = started.filter(d => d.noEndDate);
check('終了予定なし: 母数 / 件数 / 予算兆', '5,682 / 4,375 / 133.3', `${started.length.toLocaleString('en-US')} / ${noEnd.length.toLocaleString('en-US')} / ${r1(cho(noEnd.reduce((s, d) => s + (byPid.get(String(d.projectId))?.budgetAmount ?? 0), 0)))}`);
const showa = started.filter(d => d.startYear! < 1989);
check('1989年より前の開始: 件数 / 予算兆', '819 / 89.8', `${showa.length} / ${r1(cho(showa.reduce((s, d) => s + (byPid.get(String(d.projectId))?.budgetAmount ?? 0), 0)))}`);

// ── 事務局 ──
const direct = Object.entries(recipients).flatMap(([pid, rs]) => rs.filter(r => r.r && r.d === 0 && (r.a2 ?? 0) > 0).map(r => ({ pid, ...r })));
const isPublicBody = (n: string) => /独立行政法人|国立研究開発法人|^(北海道|東京都|.{2,3}[都道府県]|.+[市町村])$|^その他/.test(n);
const secretariat = direct.filter(r => /事務局|補助事業に関する事務|執行事務|事務費/.test(`${r.cc} ${r.role}`) && !isPublicBody(r.n));
check('民間事務局: 件数 / 億円 / 事業数', '425 / 4,505 / 172', `${secretariat.length} / ${Math.round(oku(secretariat.reduce((s, r) => s + r.a2!, 0))).toLocaleString('en-US')} / ${new Set(secretariat.map(r => r.pid)).size}`);
const hakuhodo = secretariat.filter(r => r.n === '株式会社博報堂');
check('博報堂 事務局: 事業数 / 億円', '9 / 3,027', `${new Set(hakuhodo.map(r => r.pid)).size} / ${Math.round(oku(hakuhodo.reduce((s, r) => s + r.a2!, 0))).toLocaleString('en-US')}`);
const hakuAll = direct.filter(r => r.n.includes('博報堂'));
check('「博報堂」を含む支出先への直接支出: 事業数 / 億円', '46 / 3,634', `${new Set(hakuAll.map(r => r.pid)).size} / ${Math.round(oku(hakuAll.reduce((s, r) => s + r.a2!, 0))).toLocaleString('en-US')}`);

// ── 企画競争・公募 ──
const planning = allContracts.filter(r => r.m === 'negotiated-contract-competitive-bidding'), offering = allContracts.filter(r => r.m === 'negotiated-contract-public-offering');
const p1 = planning.filter(r => r.ap === 1), o1 = offering.filter(r => r.ap === 1);
check('企画競争: 件数 / 億円 / 応募1者 件数 / %', '4,192 / 3,509 / 1,522 / 36%', `${planning.length.toLocaleString('en-US')} / ${Math.round(oku(planning.reduce((s, r) => s + (r.a ?? 0), 0))).toLocaleString('en-US')} / ${p1.length.toLocaleString('en-US')} / ${Math.round(pct(p1.length, planning.length))}%`);
check('公募: 件数 / 兆円 / 応募1者 件数 / %', '3,880 / 1.12 / 3,016 / 78%', `${offering.length.toLocaleString('en-US')} / ${r2(cho(offering.reduce((s, r) => s + (r.a ?? 0), 0)))} / ${o1.length.toLocaleString('en-US')} / ${Math.round(pct(o1.length, offering.length))}%`);
check('応募1者の契約額 合計（兆円）', 1.18, r2(cho([...p1, ...o1].reduce((s, r) => s + (r.a ?? 0), 0))));
const avgBr = (rs: typeof allContracts) => r1(mean(rs.filter(r => r.br != null).map(r => r.br!)));
check('応募1者の落札率 企画競争 / 公募', '99.6 / 98.6', `${avgBr(p1)} / ${avgBr(o1)}`);

// ── 租特（報告書の総括表から作ったデータ） ──
const credits24 = creditSeries('2024'), credits22 = creditSeries('2022'), credits23 = creditSeries('2023');
const wage24 = credits24.find(c => c.id === 'mof-2024-r217')!, wage22 = credits22.find(c => c.id === 'mof-2024-r217')!;
const rd24 = credits24.find(c => c.id === 'mof-2024-r24')!, rd22 = credits22.find(c => c.id === 'mof-2024-r24')!, rd23 = credits23.find(c => c.id === 'mof-2024-r24')!;
check('賃上げ税制: 2024適用額 億円 / 2022 億円 / 倍', '9,560 / 5,150 / 1.9', `${Math.round(wage24.total! / 1e5).toLocaleString('en-US')} / ${Math.round(wage22.total! / 1e5).toLocaleString('en-US')} / ${r1(wage24.total! / wage22.total!)}`);
check('賃上げ税制: 区分別 億円（大企業 / 中堅 / 中小）', '4,507 / 1,723 / 3,330', wage24.segments.slice(0, 3).map(s => Math.round((s.amount ?? 0) / 1e5).toLocaleString('en-US')).join(' / '));
check('研究開発税制: 2022 / 2023 / 2024 億円 / 倍', '7,636 / 9,479 / 10,069 / 1.32', `${[rd22, rd23, rd24].map(c => Math.round(c.total! / 1e5).toLocaleString('en-US')).join(' / ')} / ${r2(rd24.total! / rd22.total!)}`);
check('研究開発税制: 区分別 億円（一般 / 中小 / OI）', '9,586 / 254 / 223', rd24.segments.slice(0, 3).map(s => Math.round((s.amount ?? 0) / 1e5).toLocaleString('en-US')).join(' / '));

// ── 少子化 ──
const child = items.filter(i => i.policyCategory === 'childcare');
check('子育て: 事業数 / 予算兆', '43 / 4.56', `${child.length} / ${r2(cho(child.reduce((s, i) => s + i.budgetAmount, 0)))}`);
const birthHits = Object.entries(outcomes).flatMap(([pid, o]) => o.indicators.filter(x => /出生率|出生数|婚姻/.test(`${x.indicator} ${x.goal}`)).map(x => ({ pid, name: x.indicator, nameHit: /出生率|出生数|婚姻/.test(x.indicator) })));
check('出生率・出生数・婚姻の文字列一致 指標数（指標名のみ）', '10（4）', `${birthHits.length}（${birthHits.filter(h => h.nameHit).length}）`);
const top10 = [...child].sort((a, b) => b.budgetAmount - a.budgetAmount).slice(0, 10);
check('子育て上位10事業で アウトカム実績が1つも無い', 4, top10.filter(i => !(outcomes[i.pid]?.indicators ?? []).some(x => x.kind === 'アウトカム' && Object.keys(x.actual).length > 0)).length);
const childKw = Object.values(details).filter(d => /少子化|出生|結婚|妊娠|不妊/.test(`${d.projectName} ${d.purpose.slice(0, 200)}`));
check('少子化キーワード事業: 件数 / 予算兆', '25 / 0.09', `${childKw.length} / ${r2(cho(childKw.reduce((s, d) => s + (byPid.get(String(d.projectId))?.budgetAmount ?? 0), 0)))}`);
const childOpaque = child.filter(i => i.opaqueRatio != null);
check('子育て: 支出先「その他」比率 %', 59, Math.round(pct(childOpaque.reduce((s, i) => s + i.opaqueRatio! * i.spendTotal, 0), childOpaque.reduce((s, i) => s + i.spendTotal, 0))));

// ── 研究 ──
check('運営費交付金(1586): 2021 / 2025 当初 億円', '10,790 / 10,784', `${Math.round(oku(initial('1586', 2021)!)).toLocaleString('en-US')} / ${Math.round(oku(initial('1586', 2025)!)).toLocaleString('en-US')}`);
const kakenhi = items.find(i => i.name.startsWith('科学研究費助成事業'));
check('科研費: 2021 / 2025 当初 億円 / 2024予算現額 億円 / アウトカム指標', '2,377 / 2,379 / 2,530 / なし', kakenhi ? `${Math.round(oku(initial(kakenhi.pid, 2021)!)).toLocaleString('en-US')} / ${Math.round(oku(initial(kakenhi.pid, 2025)!)).toLocaleString('en-US')} / ${Math.round(oku(kakenhi.budgetAmount)).toLocaleString('en-US')} / ${noOutcome.includes(kakenhi) ? 'なし' : 'あり'}` : '事業が見つからない');
const rnd = recorded.filter(r => byPid.get(r.pid)?.policyCategory === 'rnd');
check('研究開発分野 1者応札: 1者 / 母数 / %', '1,361 / 2,027 / 67%', `${rnd.filter(r => r.ap === 1).length.toLocaleString('en-US')} / ${rnd.length.toLocaleString('en-US')} / ${Math.round(pct(rnd.filter(r => r.ap === 1).length, rnd.length))}%`);
const catRates = new Map<string, { s: number; n: number }>();
for (const r of recorded) { const c = byPid.get(r.pid)?.policyCategory ?? '?'; const e = catRates.get(c) ?? { s: 0, n: 0 }; e.n++; if (r.ap === 1) e.s++; catRates.set(c, e); }
const topCat = [...catRates.entries()].filter(([, e]) => e.n >= 100).sort((a, b) => b[1].s / b[1].n - a[1].s / a[1].n)[0];
check('1者応札率が最高の分野（母数100件以上）', 'rnd', topCat[0], topCat[0] === 'rnd');

// ── エネルギー ──
const energy = items.filter(i => i.policyCategory === 'energy');
const fuel = energy.find(i => i.name.includes('燃料油価格激変緩和')), elec = energy.find(i => i.name.includes('電気・ガス価格激変緩和'));
const energyTotal = energy.reduce((s, i) => s + i.budgetAmount, 0);
check('エネルギー: 事業数 / 予算兆 / 燃料油兆 / 電気ガス兆 / 価格補助率', '121 / 4.55 / 1.95 / 1.13 / 68%', `${energy.length} / ${r2(cho(energyTotal))} / ${r2(cho(fuel?.budgetAmount ?? 0))} / ${r2(cho(elec?.budgetAmount ?? 0))} / ${Math.round(pct((fuel?.budgetAmount ?? 0) + (elec?.budgetAmount ?? 0), energyTotal))}%`);
// 同名の事業が複数あるので予算の大きいものを採る
const execRate = (n: string) => { const i = items.filter(x => x.name.includes(n)).sort((a, b) => b.budgetAmount - a.budgetAmount)[0]; return i && i.execAmount != null ? `${Math.round(pct(i.execAmount, i.budgetAmount))}%` : '?'; };
check('エネルギー: 執行率 CEV / 省エネ投資 / 給湯器 / 充電', '21% / 28% / 48% / 45%', `${execRate('クリーンエネルギー自動車導入促進')} / ${execRate('省エネルギー投資促進')} / ${execRate('高効率給湯器')} / ${execRate('充電')}`);
check('エネルギー: アウトカムなし率 / 全体', '60% / 16%', `${Math.round(pct(energy.filter(i => noOutcome.includes(i)).length, energy.length))}% / ${Math.round(pct(noOutcome.length, items.length))}%`);

// ── 出力 ──
const ng = rows.filter(r => !r.ok);
for (const r of rows) console.log(`${r.ok ? 'OK ' : 'NG '} ${r.figure}\n     載せている値: ${r.shown}\n     再計算      : ${r.computed}`);
console.log(`\n${rows.length} 項目中 一致 ${rows.length - ng.length}・不一致 ${ng.length}`);
process.exitCode = ng.length ? 1 : 0;
