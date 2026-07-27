import type { Metadata } from 'next';
import Link from 'next/link';
import benchmarkData from '@/tests/benchmark-results/openrouter-model-optimization-2026-07-26.json';
import fixtureData from '@/tests/fixtures/quality-evaluation-benchmark-30.json';

export const metadata: Metadata = {
  title: 'OpenRouter モデル最適化ラボ',
  description: 'GPT-5.6 Solを基準に、行政事業評価の品質とコストを実測比較',
};

type Evaluation = {
  pid: string;
  designClarity: number;
  evidenceReadiness: number;
  confidence: number;
  finding: string;
};

type Run = {
  model: string;
  name: string;
  price: { inputPerMillion: number; outputPerMillion: number };
  elapsedMs: number;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    reportedCost: number | null;
    calculatedCost: number;
  };
  results: Evaluation[];
};

type Metric = Run & {
  cost: number;
  mae: number;
  exactRate: number;
  withinOneRate: number;
  saving: number;
};

const runs = benchmarkData.runs as Run[];
const baseline = runs.find((run) => run.model === benchmarkData.baselineModel)!;
const baselineByPid = new Map(baseline.results.map((result) => [result.pid, result]));
const projectByPid = new Map(fixtureData.projects.map((project) => [project.pid, project]));

const costOf = (run: Run) => run.usage.reportedCost ?? run.usage.calculatedCost;
const money = (value: number) =>
  value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;
const pct = (value: number) => `${Math.round(value * 100)}%`;

const metrics: Metric[] = runs.map((run) => {
  let absoluteError = 0;
  let exact = 0;
  let withinOne = 0;
  for (const result of run.results) {
    const target = baselineByPid.get(result.pid)!;
    const error =
      Math.abs(result.designClarity - target.designClarity) +
      Math.abs(result.evidenceReadiness - target.evidenceReadiness);
    absoluteError += error;
    if (error === 0) exact += 1;
    if (error <= 1) withinOne += 1;
  }
  const cost = costOf(run);
  return {
    ...run,
    cost,
    mae: absoluteError / (run.results.length * 2),
    exactRate: exact / run.results.length,
    withinOneRate: withinOne / run.results.length,
    saving: 1 - cost / costOf(baseline),
  };
});

const metricByModel = new Map<string, Metric>(
  metrics.map((metric) => [metric.model, metric]),
);
const luna = metricByModel.get('openai/gpt-5.6-luna')!;
const glm = metricByModel.get('z-ai/glm-5.2')!;
const terra = metricByModel.get('openai/gpt-5.6-terra')!;
const deepseek = metricByModel.get('deepseek/deepseek-v4-flash')!;
const glmByPid = new Map(glm.results.map((result) => [result.pid, result]));

const cohortLabels: Record<string, string> = {
  social_protection: '社会保障・直接給付',
  infrastructure_resilience: 'インフラ・レジリエンス',
  supply_capacity_innovation: '供給力・産業・研究開発',
  human_capital_knowledge_culture: '人的資本・知識・文化',
  security_external_environment_digital: '安全保障・外交・環境・デジタル',
  calibration_edge_cases: '境界・校正事例',
};

const lunaRows = fixtureData.projects.map((project) => {
  const result = luna.results.find((item) => item.pid === project.pid)!;
  const solResult = baselineByPid.get(project.pid)!;
  const designDelta = result.designClarity - solResult.designClarity;
  const evidenceDelta = result.evidenceReadiness - solResult.evidenceReadiness;
  return {
    ...project,
    result,
    solResult,
    designDelta,
    evidenceDelta,
    totalDifference: Math.abs(designDelta) + Math.abs(evidenceDelta),
  };
});

const cohortSummaries = Object.keys(cohortLabels).map((cohort) => {
  const rows = lunaRows.filter((row) => row.cohort === cohort);
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    cohort,
    label: cohortLabels[cohort],
    design: average(rows.map((row) => row.result.designClarity)),
    evidence: average(rows.map((row) => row.result.evidenceReadiness)),
    confidence: average(rows.map((row) => row.result.confidence)),
    disagreementCount: rows.filter((row) => row.totalDifference > 0).length,
  };
});

// 実測した各モデルの出力から、二段階ルーティングをオフライン再現する。
const escalatedPids = luna.results
  .filter((result) => {
    const peer = glmByPid.get(result.pid)!;
    return (
      Math.abs(result.designClarity - peer.designClarity) +
        Math.abs(result.evidenceReadiness - peer.evidenceReadiness) >=
      2
    );
  })
  .map((result) => result.pid);
const escalatedSet = new Set(escalatedPids);
let cascadeAbsoluteError = 0;
let cascadeExact = 0;
let cascadeWithinOne = 0;
for (const result of luna.results) {
  const selected = escalatedSet.has(result.pid) ? baselineByPid.get(result.pid)! : result;
  const target = baselineByPid.get(result.pid)!;
  const error =
    Math.abs(selected.designClarity - target.designClarity) +
    Math.abs(selected.evidenceReadiness - target.evidenceReadiness);
  cascadeAbsoluteError += error;
  if (error === 0) cascadeExact += 1;
  if (error <= 1) cascadeWithinOne += 1;
}
const cascadeCost =
  luna.cost + glm.cost + costOf(baseline) * (escalatedPids.length / baseline.results.length);
const cascade = {
  cost: cascadeCost,
  saving: 1 - cascadeCost / costOf(baseline),
  mae: cascadeAbsoluteError / (baseline.results.length * 2),
  exactRate: cascadeExact / baseline.results.length,
  withinOneRate: cascadeWithinOne / baseline.results.length,
};

const displayOrder = [
  'openai/gpt-5.6-sol',
  'openai/gpt-5.6-terra',
  'openai/gpt-5.6-luna',
  'z-ai/glm-5.2',
  'anthropic/claude-haiku-4.5',
  'deepseek/deepseek-v4-flash',
];
const orderedMetrics = displayOrder.map((model) => metricByModel.get(model)!);

function ScorePill({ children, tone }: { children: React.ReactNode; tone: 'green' | 'blue' | 'amber' }) {
  const styles = {
    green: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200',
    blue: 'border-sky-300/30 bg-sky-300/10 text-sky-200',
    amber: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
  };
  return <span className={`rounded-full border px-2.5 py-1 text-xs ${styles[tone]}`}>{children}</span>;
}

function ScoreBlocks({ score, tone }: { score: number; tone: 'emerald' | 'sky' }) {
  const active = tone === 'emerald' ? 'bg-emerald-300' : 'bg-sky-300';
  return (
    <div className="flex gap-1" aria-label={`${score} / 4`}>
      {[1, 2, 3, 4].map((step) => (
        <span
          key={step}
          className={`h-2.5 w-5 rounded-sm ${step <= score ? active : 'bg-white/10'}`}
        />
      ))}
    </div>
  );
}

function DeltaBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-white/25">±0</span>;
  return (
    <span className={value > 0 ? 'text-amber-200' : 'text-sky-200'}>
      {value > 0 ? '+' : ''}
      {value}
    </span>
  );
}

export default function ModelLabPage() {
  return (
    <main className="min-h-screen bg-[#07110f] text-[#edf7f2]">
      <div className="pointer-events-none fixed inset-0 opacity-40 [background-image:radial-gradient(circle_at_20%_10%,rgba(40,190,145,.22),transparent_32%),radial-gradient(circle_at_88%_28%,rgba(46,130,190,.16),transparent_28%)]" />
      <div className="relative mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 font-mono text-sm text-emerald-200">
              OR
            </span>
            <div>
              <div className="text-sm font-semibold">OpenRouter Model Lab</div>
              <div className="text-xs text-white/45">RS policy evaluation · 2026.07.26</div>
            </div>
          </div>
          <Link className="text-sm text-white/55 transition hover:text-white" href="/quality">
            政策評価へ →
          </Link>
        </header>

        <section className="grid gap-8 pb-14 pt-14 lg:grid-cols-[1.35fr_.65fr] lg:items-end">
          <div>
            <div className="mb-5 flex flex-wrap gap-2">
              <ScorePill tone="green">30事業 × 6モデル 実測</ScorePill>
              <ScorePill tone="blue">Solを基準</ScorePill>
              <ScorePill tone="amber">Web検索なし</ScorePill>
            </div>
            <h1 className="max-w-4xl text-4xl font-semibold leading-[1.12] tracking-[-0.035em] sm:text-6xl">
              Solに近い判断を、
              <br />
              <span className="text-emerald-300">半分以下のコスト</span>で。
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/58">
              同一の行政事業30件を、同一プロンプト・同一JSON Schemaで評価。
              平均点ではなく、2つの評価軸がGPT-5.6 Solとどれだけ一致したかを比較しました。
            </p>
          </div>
          <div className="rounded-3xl border border-emerald-300/20 bg-emerald-300/[.07] p-6">
            <div className="text-xs font-medium uppercase tracking-[.18em] text-emerald-200/70">
              推奨構成
            </div>
            <div className="mt-3 text-2xl font-semibold">Luna + GLM → Sol</div>
            <p className="mt-3 text-sm leading-6 text-white/58">
              LunaとGLMの2軸合計が2点以上ずれた案件だけSolへ。今回の30件では
              {escalatedPids.length}件が再判定対象でした。
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
              <div>
                <div className="font-mono text-xl text-emerald-200">{money(cascade.cost)}</div>
                <div className="mt-1 text-[11px] text-white/40">30件コスト</div>
              </div>
              <div>
                <div className="font-mono text-xl text-emerald-200">{pct(cascade.saving)}</div>
                <div className="mt-1 text-[11px] text-white/40">Sol比削減</div>
              </div>
              <div>
                <div className="font-mono text-xl text-emerald-200">{pct(cascade.withinOneRate)}</div>
                <div className="mt-1 text-[11px] text-white/40">1点以内</div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Sol 30件', value: money(costOf(baseline)), note: '実測API請求額' },
            { label: '推奨ルート', value: money(cascade.cost), note: `${pct(cascade.saving)} コスト削減` },
            { label: '軸あたり誤差', value: cascade.mae.toFixed(2), note: '0〜4点スケール' },
            { label: '完全一致', value: pct(cascade.exactRate), note: `${cascadeExact} / 30事業` },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[.035] p-5">
              <div className="text-xs text-white/40">{item.label}</div>
              <div className="mt-2 font-mono text-3xl tracking-tight">{item.value}</div>
              <div className="mt-2 text-xs text-white/45">{item.note}</div>
            </div>
          ))}
        </section>

        <section className="mt-16">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[.18em] text-white/35">Measured frontier</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">モデル別の実測結果</h2>
            </div>
            <div className="text-xs text-white/40">MAE: Solとの差の平均絶対誤差（低いほど良い）</div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0a1714]/90">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/35">
                  <tr>
                    <th className="px-5 py-4 font-medium">モデル</th>
                    <th className="px-4 py-4 text-right font-medium">30件コスト</th>
                    <th className="px-4 py-4 text-right font-medium">Sol比削減</th>
                    <th className="px-4 py-4 text-right font-medium">MAE</th>
                    <th className="px-4 py-4 text-right font-medium">完全一致</th>
                    <th className="px-4 py-4 text-right font-medium">1点以内</th>
                    <th className="px-5 py-4 text-right font-medium">時間</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[.07]">
                  {orderedMetrics.map((metric) => {
                    const isBest = metric.model === 'openai/gpt-5.6-luna';
                    return (
                      <tr key={metric.model} className={isBest ? 'bg-emerald-300/[.055]' : ''}>
                        <td className="px-5 py-5">
                          <div className="flex items-center gap-3">
                            <span
                              className={`h-2 w-2 rounded-full ${
                                isBest ? 'bg-emerald-300 shadow-[0_0_12px_#6ee7b7]' : 'bg-white/25'
                              }`}
                            />
                            <div>
                              <div className="font-medium">
                                {metric.name.replace(/^[^:]+:\s*/, '')}
                                {isBest && (
                                  <span className="ml-2 rounded bg-emerald-300/15 px-1.5 py-0.5 text-[10px] text-emerald-200">
                                    単体推奨
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 font-mono text-[10px] text-white/35">{metric.model}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-5 text-right font-mono">{money(metric.cost)}</td>
                        <td className="px-4 py-5 text-right font-mono text-white/65">
                          {metric.model === baseline.model ? '—' : pct(metric.saving)}
                        </td>
                        <td className="px-4 py-5 text-right font-mono">{metric.mae.toFixed(2)}</td>
                        <td className="px-4 py-5 text-right font-mono">{pct(metric.exactRate)}</td>
                        <td className="px-4 py-5 text-right font-mono">{pct(metric.withinOneRate)}</td>
                        <td className="px-5 py-5 text-right font-mono text-white/55">
                          {(metric.elapsedMs / 1000).toFixed(0)}s
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-emerald-300/[.085]">
                    <td className="px-5 py-5 font-medium text-emerald-100">
                      推奨カスケード
                      <div className="mt-1 text-[10px] font-normal text-white/40">
                        Luna + GLM、差が2点以上ならSol
                      </div>
                    </td>
                    <td className="px-4 py-5 text-right font-mono text-emerald-100">{money(cascade.cost)}</td>
                    <td className="px-4 py-5 text-right font-mono text-emerald-100">{pct(cascade.saving)}</td>
                    <td className="px-4 py-5 text-right font-mono text-emerald-100">{cascade.mae.toFixed(2)}</td>
                    <td className="px-4 py-5 text-right font-mono text-emerald-100">
                      {pct(cascade.exactRate)}
                    </td>
                    <td className="px-4 py-5 text-right font-mono text-emerald-100">
                      {pct(cascade.withinOneRate)}
                    </td>
                    <td className="px-5 py-5 text-right text-xs text-white/40">シミュレーション</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-5 lg:grid-cols-3">
          {[
            {
              kicker: '01 · Budget',
              title: '大量処理は GLM 5.2',
              body: `${money(glm.cost)}で30件。Sol比${pct(glm.saving)}削減、1点以内${pct(glm.withinOneRate)}。下書き・分類・全件スクリーニング向き。`,
              accent: 'border-sky-300/20',
            },
            {
              kicker: '02 · Default',
              title: '単体なら Luna',
              body: `${money(luna.cost)}で軸あたり誤差${luna.mae.toFixed(2)}。Sol比${pct(luna.saving)}削減で、今回の費用対品質の最良点。`,
              accent: 'border-emerald-300/30',
            },
            {
              kicker: '03 · Assurance',
              title: '重要案件だけ Sol',
              body: `LunaとGLMが大きく割れた${escalatedPids.length}件だけSolへ。全件Solより${pct(cascade.saving)}安く、1点以内${pct(cascade.withinOneRate)}。`,
              accent: 'border-amber-300/20',
            },
          ].map((card) => (
            <div key={card.kicker} className={`rounded-3xl border bg-white/[.025] p-6 ${card.accent}`}>
              <div className="font-mono text-[11px] uppercase tracking-[.16em] text-white/35">{card.kicker}</div>
              <h3 className="mt-5 text-xl font-semibold">{card.title}</h3>
              <p className="mt-3 text-sm leading-6 text-white/55">{card.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-20" id="luna-decisions">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <div className="text-xs uppercase tracking-[.18em] text-emerald-200/60">
                Luna decision atlas
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">Lunaは何を、どう判断したか</h2>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-white/52">
                緑は政策設計の明瞭さ、青は証拠準備度です。差分はSol基準で、正ならLunaが高く、
                負なら低く評価しています。各事業を開くと判断理由を確認できます。
              </p>
            </div>
            <div className="flex gap-5 text-xs text-white/45">
              <span className="flex items-center gap-2">
                <i className="h-2.5 w-5 rounded-sm bg-emerald-300" /> 政策設計
              </span>
              <span className="flex items-center gap-2">
                <i className="h-2.5 w-5 rounded-sm bg-sky-300" /> 証拠準備
              </span>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cohortSummaries.map((summary) => (
              <div
                key={summary.cohort}
                className="rounded-2xl border border-white/[.08] bg-white/[.025] p-4"
              >
                <div className="min-h-10 text-sm font-medium leading-5">{summary.label}</div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] text-white/35">政策設計</span>
                      <span className="font-mono text-sm text-emerald-200">{summary.design.toFixed(1)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-emerald-300"
                        style={{ width: `${(summary.design / 4) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] text-white/35">証拠準備</span>
                      <span className="font-mono text-sm text-sky-200">{summary.evidence.toFixed(1)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-sky-300"
                        style={{ width: `${(summary.evidence / 4) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-between border-t border-white/[.07] pt-3 text-[10px] text-white/35">
                  <span>平均信頼度 {pct(summary.confidence)}</span>
                  <span>Solと差あり {summary.disagreementCount}/5</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 overflow-hidden rounded-3xl border border-white/10 bg-[#0a1714]/90">
            <div className="grid grid-cols-[1fr_auto] items-center border-b border-white/10 px-5 py-4">
              <div>
                <div className="text-sm font-medium">全30事業</div>
                <div className="mt-1 text-[11px] text-white/35">政策類型順 · 行をクリックして理由を表示</div>
              </div>
              <div className="hidden gap-5 text-[10px] text-white/35 sm:flex">
                <span>完全一致 {pct(luna.exactRate)}</span>
                <span>1点以内 {pct(luna.withinOneRate)}</span>
              </div>
            </div>
            <div className="divide-y divide-white/[.065]">
              {lunaRows.map((row) => (
                <details key={row.pid} className="group open:bg-white/[.025]">
                  <summary className="grid cursor-pointer list-none gap-3 px-5 py-4 transition hover:bg-white/[.025] sm:grid-cols-[minmax(240px,1fr)_150px_150px_72px_18px] sm:items-center">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{row.name}</div>
                      <div className="mt-1 flex gap-2 text-[10px] text-white/35">
                        <span className="font-mono">PID {row.pid}</span>
                        <span>·</span>
                        <span className="truncate">{cohortLabels[row.cohort]}</span>
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-[10px]">
                        <span className="text-white/35">政策設計</span>
                        <span className="font-mono text-emerald-200">
                          {row.result.designClarity}/4{' '}
                          <span className="ml-1 text-[9px]">
                            <DeltaBadge value={row.designDelta} />
                          </span>
                        </span>
                      </div>
                      <ScoreBlocks score={row.result.designClarity} tone="emerald" />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-[10px]">
                        <span className="text-white/35">証拠準備</span>
                        <span className="font-mono text-sky-200">
                          {row.result.evidenceReadiness}/4{' '}
                          <span className="ml-1 text-[9px]">
                            <DeltaBadge value={row.evidenceDelta} />
                          </span>
                        </span>
                      </div>
                      <ScoreBlocks score={row.result.evidenceReadiness} tone="sky" />
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm">{pct(row.result.confidence)}</div>
                      <div className="mt-1 text-[9px] text-white/30">信頼度</div>
                    </div>
                    <span className="text-white/25 transition group-open:rotate-45 group-open:text-emerald-200">＋</span>
                  </summary>
                  <div className="grid gap-5 border-t border-white/[.06] bg-black/10 px-5 py-5 sm:grid-cols-[1fr_auto]">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-white/30">Lunaの判断理由</div>
                      <p className="mt-2 text-sm leading-6 text-white/65">{row.result.finding}</p>
                    </div>
                    <div className="flex gap-5 sm:border-l sm:border-white/[.07] sm:pl-5">
                      <div>
                        <div className="text-[9px] text-white/30">Luna</div>
                        <div className="mt-1 font-mono text-sm">
                          {row.result.designClarity} / {row.result.evidenceReadiness}
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] text-white/30">Sol</div>
                        <div className="mt-1 font-mono text-sm text-white/50">
                          {row.solResult.designClarity} / {row.solResult.evidenceReadiness}
                        </div>
                      </div>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16 grid gap-8 rounded-3xl border border-white/10 bg-white/[.025] p-6 sm:p-8 lg:grid-cols-[.7fr_1.3fr]">
          <div>
            <div className="text-xs uppercase tracking-[.18em] text-white/35">Escalation queue</div>
            <h2 className="mt-3 text-2xl font-semibold">Solへ回す5件</h2>
            <p className="mt-3 text-sm leading-6 text-white/50">
              LunaとGLMの designClarity / evidenceReadiness の差の合計が2点以上だった案件です。
            </p>
          </div>
          <div className="grid gap-3">
            {escalatedPids.map((pid, index) => {
              const project = projectByPid.get(pid)!;
              const lunaResult = luna.results.find((result) => result.pid === pid)!;
              const glmResult = glmByPid.get(pid)!;
              return (
                <div
                  key={pid}
                  className="grid gap-3 rounded-2xl border border-white/[.08] bg-black/10 px-4 py-3 sm:grid-cols-[32px_1fr_auto] sm:items-center"
                >
                  <span className="font-mono text-xs text-emerald-200/55">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <div className="text-sm font-medium">{project.name}</div>
                    <div className="mt-1 text-[11px] text-white/35">
                      PID {pid} · {project.ministry}
                    </div>
                  </div>
                  <div className="flex gap-2 font-mono text-xs">
                    <span className="rounded-lg bg-white/[.06] px-2 py-1">
                      Luna {lunaResult.designClarity}/{lunaResult.evidenceReadiness}
                    </span>
                    <span className="rounded-lg bg-white/[.06] px-2 py-1">
                      GLM {glmResult.designClarity}/{glmResult.evidenceReadiness}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-16 grid gap-6 lg:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-[.18em] text-white/35">Trade-offs</div>
            <h2 className="mt-3 text-2xl font-semibold">採用しなかった選択肢</h2>
          </div>
          <div className="space-y-5 text-sm leading-6 text-white/55">
            <p>
              <span className="font-medium text-white/85">Terra：</span>
              単体の1点以内率は{pct(terra.withinOneRate)}と高い一方、Lunaの約
              {(terra.cost / luna.cost).toFixed(1)}倍。高保証単体モデルとしては有力ですが、段階ルートの方が誤差を抑えられました。
            </p>
            <p>
              <span className="font-medium text-white/85">DeepSeek V4 Flash：</span>
              わずか{money(deepseek.cost)}ですが、1点以内は{pct(deepseek.withinOneRate)}。
              confidence平均が高いのに差が残り、自己申告信頼度だけでは再判定を選べません。
            </p>
            <p>
              <span className="font-medium text-white/85">MiMo V2.5：</span>
              2バッチ目で0〜4の範囲外スコアを返したため失格。最安価格でも、厳格JSONの補正・再試行コストを含めると本用途では不利です。
            </p>
          </div>
        </section>

        <section className="mt-16 rounded-3xl border border-white/10 bg-[#0b1916] p-6 sm:p-8">
          <div className="grid gap-7 lg:grid-cols-[1fr_1fr]">
            <div>
              <div className="text-xs uppercase tracking-[.18em] text-white/35">Implementation recipe</div>
              <h2 className="mt-3 text-2xl font-semibold">本番ルーティング</h2>
              <div className="mt-6 space-y-4">
                {[
                  ['1', 'LunaとGLMを並列実行', '同じ入力・rubric・JSON Schemaを使用'],
                  ['2', '2軸の差を計算', '合計差が0〜1ならLunaを採用'],
                  ['3', '差が2以上ならSol', '高額・安全保障案件も任意で強制昇格'],
                  ['4', '実績を再校正', '人間ラベルが揃ったら閾値を再学習'],
                ].map(([number, title, note]) => (
                  <div key={number} className="flex gap-4">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-emerald-300/25 bg-emerald-300/10 font-mono text-xs text-emerald-200">
                      {number}
                    </span>
                    <div>
                      <div className="text-sm font-medium">{title}</div>
                      <div className="mt-1 text-xs text-white/40">{note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-5 text-xs leading-6 text-emerald-100/75">
{`const [luna, glm] = await Promise.all([
  evaluate("openai/gpt-5.6-luna", input),
  evaluate("z-ai/glm-5.2", input),
]);

const disagreement =
  Math.abs(luna.designClarity - glm.designClarity) +
  Math.abs(luna.evidenceReadiness - glm.evidenceReadiness);

return disagreement >= 2
  ? evaluate("openai/gpt-5.6-sol", input)
  : luna;`}
            </pre>
          </div>
        </section>

        <section className="mt-12 border-t border-white/10 py-8 text-xs leading-5 text-white/35">
          <p>
            注意: Sol出力を正解とみなした相対ベンチマークであり、政策評価そのものの正しさを保証しません。
            推奨カスケードのコストは実測した各ランを件数按分したオフライン推計です。
            本番では人間合議ラベル、再試行率、キャッシュ、プロバイダ差を含めて再検証してください。
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            <a className="hover:text-emerald-200" href="https://openrouter.ai/docs/guides/overview/models">
              OpenRouter Models API ↗
            </a>
            <a className="hover:text-emerald-200" href="https://openrouter.ai/docs/guides/routing/routers/auto-router">
              Auto Router docs ↗
            </a>
            <a
              className="hover:text-emerald-200"
              href="https://openrouter.ai/docs/guides/best-practices/prompt-caching"
            >
              Prompt caching ↗
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
