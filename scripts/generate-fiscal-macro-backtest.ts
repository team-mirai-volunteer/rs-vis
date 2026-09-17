import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import data from '../tests/fixtures/fiscal-backtest/jsna-2024-fiscal-years-full.json';
import { PARAMETERS } from '../app/lib/fiscal-space/assumptions';
import { backtestMacro, componentElasticities, MACRO_SERIES, SERIES_LABELS, type MacroMethod, type MacroSeries } from './lib/fiscal-macro-backtest';

const FIXTURE = 'tests/fixtures/fiscal-backtest/jsna-2024-fiscal-years-full.json';
const fixtureSha256 = createHash('sha256').update(readFileSync(FIXTURE)).digest('hex');
for (const source of data.sources) {
  const hash = createHash('sha256').update(readFileSync(`tests/fixtures/fiscal-backtest/${source.file}`)).digest('hex');
  if (hash !== source.sha256) throw new Error(`Source hash mismatch: ${source.file}`);
}
const horizons = [1, 3, 5];
const result = backtestMacro(data.rows, { horizons });
const elasticities = componentElasticities(data.rows);
const methods: MacroMethod[] = ['conditional', 'unconditional', 'unchanged', 'linear-trend'];
const methodLabels: Record<MacroMethod, string> = { conditional: '条件付き', unconditional: '無条件', unchanged: '据置', 'linear-trend': '線形トレンド' };
const digits = (series: MacroSeries) => series === 'debtRatio' ? 3 : 2;
const n = (v: number, d = 2) => Number.isFinite(v) ? v.toFixed(d) : '—';
const summary = (series: MacroSeries, horizon: number, method: MacroMethod) => result.summaries.find(s => s.series === series && s.horizon === horizon && s.method === method)!;
const last = data.rows.at(-1)!, first = data.rows[0];
const conditionalRevenue5 = summary('revenue', 5, 'conditional'), conditionalInterest5 = summary('interestPayments', 5, 'conditional');
const conditionalGdp = horizons.map(h => summary('nominalGdp', h, 'conditional'));
const bestByMae = (series: MacroSeries, horizon: number) => methods.map(m => summary(series, horizon, m)).reduce((best, s) => s.mae < best.mae ? s : best);
const e = (component: string, window: string) => elasticities.find(x => x.component === component && x.window === window)!;

const seriesTable = (horizon: number) => `| 系列 | 方法 | 件数 | MAE | バイアス | RMSE | MAPE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${MACRO_SERIES.flatMap(series => methods.map(method => { const s = summary(series, horizon, method); const d = digits(series);
  return `| ${SERIES_LABELS[series]} | ${methodLabels[method]} | ${s.count} | ${n(s.mae, d)} | ${n(s.bias, d)} | ${n(s.rmse, d)} | ${n(s.mapePercent, 1)}% |`; })).join('\n')}`;

const report = `# 全系列の条件付きバックテスト（2024年方式の初期状態を各年度に適用）

再生成：\`npx tsx scripts/generate-fiscal-macro-backtest.ts\`。入力・全結果：[JSON](fiscal-space-macro-backtest.json)。税・社会負担収入だけを収入式で検証した先行結果は[fiscal-space-backtest-results.md](fiscal-space-backtest-results.md)。

## 検証の対象

現行シミュレータ本体（\`app/lib/fiscal-space/simulate.ts\`）を政策なしで走らせ、名目GDP・税＋社会負担収入・基礎的支出・支払利子・プライマリーバランス（PB）・負債残高/GDP・CPIの7系列を実績と比べる。${first.year}〜${last.year}年度の各年度を起点に、2024年プリセットと同じ手順で\`EconomyState\`を組み立てる（名目GDP＝実質GDP＝潜在GDP、負債は満期1〜10年の均等10区分、表面利率＝支払利子÷負債）。労働・エネルギー・対外の各ブロックは2024年値のままで、政策なしの財政系列には影響しない。

出典：[${data.source}](${data.url})。年度別に同じ年次推計（${data.vintage}）へ揃えた。金額は10億円を兆円に換算。定義：

- 税＋社会負担収入：${data.definitions.taxes}＋${data.definitions.socialContributions}。
- 基礎的支出：${data.definitions.primaryExpenditure}。
- PB：${data.definitions.primaryBalance}。GFSの恒等式（純貸出＝収入−支出−非金融資産の純取得）を抽出時に検証済み。
- 負債残高：${data.definitions.grossDebt}。
- CPI：${data.definitions.cpiFiscalYear}。総務省の月次指数（e-Stat、Shift_JIS）から計算し、暦年平均を使う既存のCPI fixtureとは別系列。

注意：${data.caveats.join(' ')}

## 2つのモード

- **条件付き**：起点から予測期間末（最大5年、末尾は残り年数）までの実績名目GDP・CPIの年平均成長率を\`baselineRealGrowth\`（＝名目÷CPI−1）・\`baselineInflation\`に与える。シミュレータは成長率を定数として扱うため、年ごとの実績経路ではなく期間平均で近似する。起点年度の\`macro.inflation\`は実績CPI前年度比とし、慣性項（\`inflationPersistence\`）の過渡がCPI・名目GDPに残る。この近似の大きさは名目GDPとCPIの条件付き誤差そのものとして表に出る（1年先の名目GDP MAE ${n(conditionalGdp[0].mae)}兆円、5年先 ${n(conditionalGdp[2].mae)}兆円）。
- **無条件**：既定パラメータ（基準実質成長${(PARAMETERS.baselineRealGrowth * 100).toFixed(1)}%・インフレ${(PARAMETERS.baselineInflation * 100).toFixed(1)}%）のままの経路。

どちらも市場金利は既定の${(PARAMETERS.marketRate * 100).toFixed(1)}%で、実績の金利低下は与えない。利払いと負債の誤差にはこの差が含まれる。弾性値は既定（税${PARAMETERS.taxRevenueElasticity}・社会負担${PARAMETERS.socialContributionElasticity}）。途中年の実績で更新せず、係数の再推定もしない。

比較基準：**据置**（起点の値をそのまま）と**線形トレンド**（起点までの直近5年度の最小二乗直線を延長。起点${first.year}年度は履歴が1点のため除外）。負債/GDPは比率で直接延長する。

件数：1年先${summary('nominalGdp', 1, 'conditional').count}件、3年先${summary('nominalGdp', 3, 'conditional').count}件、5年先${summary('nominalGdp', 5, 'conditional').count}件（線形トレンドは各1件少ない）。重複する起点・対象年は独立標本ではない。

## 誤差（予測−実績）

単位：金額は兆円、負債/GDPは比率、CPIは指数点。MAPEはPBのように0付近を通る系列では発散するため参考値。

### 1年先

${seriesTable(1)}

### 3年先

${seriesTable(3)}

### 5年先

${seriesTable(5)}

### MAE最小の方法（記述的比較）

| 系列 | 1年先 | 3年先 | 5年先 |
| --- | --- | --- | --- |
${MACRO_SERIES.map(series => `| ${SERIES_LABELS[series]} | ${horizons.map(h => { const s = bestByMae(series, h); return `${methodLabels[s.method]}（${n(s.mae, digits(series))}）`; }).join(' | ')} |`).join('\n')}

同じ標本での事後比較であり、未知期間での優位性ではない。

## 起点別の結果（条件付き・5年先）

| 起点→対象 | 与えた名目成長 | 収入 予測/実績 | 基礎的支出 予測/実績 | 支払利子 予測/実績 | PB 予測/実績 | 負債/GDP 予測/実績 |
| --- | ---: | --- | --- | --- | --- | --- |
${result.runs.filter(r => r.horizon === 5).map(r => {
  const c = (series: MacroSeries) => result.cases.find(x => x.origin === r.origin && x.horizon === 5 && x.method === 'conditional' && x.series === series)!;
  const pair = (series: MacroSeries) => `${n(c(series).predicted, digits(series))} / ${n(c(series).actual, digits(series))}`;
  return `| ${r.origin}→${r.origin + 5} | ${(r.conditional.nominalGrowth * 100).toFixed(2)}% | ${pair('revenue')} | ${pair('primaryExpenditure')} | ${pair('interestPayments')} | ${pair('primaryBalance')} | ${pair('debtRatio')} |`;
}).join('\n')}

## 税と社会負担の弾性値（別推定）

年度ごとの対数変化 Δln(収入区分) を Δln(名目GDP) に原点を通る最小二乗で回帰した係数。窓は対象年度で区切る。SEは通常のOLS、区間はペアの再標本化ブートストラップ（${elasticities[0].bootstrap.replications}回、固定シード）の5〜95%点。「累積比」は窓の始点比の対数比で、税率・保険料率の改定を含む総変化の目安。

| 区分 | 窓 | 件数 | 弾性値 | SE | ブートストラップ5–95% | R² | 累積比 |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: |
${elasticities.map(x => `| ${x.component === 'taxes' ? '税＋罰金' : x.component === 'socialContributions' ? '社会負担' : '合計（参考）'} | ${x.window} | ${x.count} | ${n(x.elasticity, 3)} | ${n(x.standardError, 3)} | ${n(x.bootstrap.percentile5, 2)}〜${n(x.bootstrap.percentile95, 2)} | ${n(x.rSquared, 2)} | ${n(x.cumulativeLogRatio, 2)} |`).join('\n')}

読み方：税は1年変化で見ると全期間${n(e('taxes', '1995-2024').elasticity, 2)}（SE ${n(e('taxes', '1995-2024').standardError, 2)}）と1を大きく上回るが、2015〜2024年度では${n(e('taxes', '2015-2024').elasticity, 2)}（SE ${n(e('taxes', '2015-2024').standardError, 2)}）。社会負担は全期間${n(e('socialContributions', '1995-2024').elasticity, 2)}（SE ${n(e('socialContributions', '1995-2024').standardError, 2)}）、2015〜2024年度${n(e('socialContributions', '2015-2024').elasticity, 2)}で、どの窓でも1を下回り、区間の上端が1.1前後。一方、社会負担の累積比は${n(e('socialContributions', '1995-2024').cumulativeLogRatio, 1)}と高く、GDPと無関係な保険料率の段階的引上げ・高齢化による被保険者構成の変化が水準を押し上げてきた。1年変化の弾性値はそのトレンド分を捉えない（原点回帰のため定数項がない）。既定値の選定では、税は1.3を維持する材料（全期間・2005年以降の推定は1.3より高いが、消費税率引上げ年（1997・2014・2019年度）の一時的な変化を含み、直近10年は1.0付近）、社会負担は1.0を上限とみなす材料になる。いずれも制度変更を調整しない事後推定であり、政府公認値ではない。

## 解釈と限界

- 条件付きモードでも税＋社会負担収入は5年先で${n(conditionalRevenue5.bias)}兆円のバイアス（MAE ${n(conditionalRevenue5.mae)}兆円）。名目GDPを与えても、保険料率・税率の改定が説明できない分が残る。
- 支払利子は5年先で${n(conditionalInterest5.bias)}兆円の過大（MAE ${n(conditionalInterest5.mae)}兆円）。既定金利2%で借換える構造が、1990年代後半以降の金利低下期を再現できないためで、据置・線形トレンドの方が小さい。金利経路を外生で与える検証は今回の範囲外。
- 基礎的支出はCPI連動＋基準成長の式で、2009・2020年度のような裁量的拡大を捉えない。PBの誤差は収入・支出の誤差の差で、条件付きでも据置とほぼ同水準。
- 負債/GDPはSNA時価の全負債・暦年末値を使うため、水準はIMFの額面ベースより高い。比率の変化の検証として読む。
- 無条件モードの誤差はモデルの精度ではなく、既定の将来仮定（成長1%・インフレ2%）と過去30年の低成長・低インフレ期のずれを示す。将来予測の精度を保証・否定するものではない。
- 改定後データを使った事後検証で、当時入手可能だった情報だけを使う標本外予測ではない。信頼区間は主張しない。

固定入力のSHA-256：\`${fixtureSha256}\`。各原本のURL・SHA-256・抽出セルは入力JSONに保存。原本は\`tests/fixtures/fiscal-backtest/\`に固定した（GFS付表6(2)、主要系列表1、ストック編付表3、e-Stat CPI月次）。入力の再抽出：\`python scripts/generate-fiscal-backtest-data.py\`（openpyxlが必要、ネット取得なし）。
`;
writeFileSync('docs/fiscal-space-macro-backtest.md', report);
writeFileSync('docs/fiscal-space-macro-backtest.json', JSON.stringify({
  method: 'conditional-and-unconditional-no-policy-simulation-revised-data', fixtureSha256,
  parameters: { taxRevenueElasticity: PARAMETERS.taxRevenueElasticity, socialContributionElasticity: PARAMETERS.socialContributionElasticity,
    baselineRealGrowth: PARAMETERS.baselineRealGrowth, baselineInflation: PARAMETERS.baselineInflation, marketRate: PARAMETERS.marketRate,
    inflationPersistence: PARAMETERS.inflationPersistence, expenditurePriceIndexation: PARAMETERS.expenditurePriceIndexation },
  horizons, data, ...result, componentElasticities: elasticities }, null, 2) + '\n');
console.table(result.summaries.filter(s => s.method === 'conditional').map(s => ({ series: s.series, horizon: s.horizon, count: s.count, mae: +s.mae.toFixed(3), bias: +s.bias.toFixed(3), rmse: +s.rmse.toFixed(3) })));
console.table(elasticities.map(x => ({ component: x.component, window: x.window, n: x.count, elasticity: +x.elasticity.toFixed(3), se: +x.standardError.toFixed(3), p5: +x.bootstrap.percentile5.toFixed(3), p95: +x.bootstrap.percentile95.toFixed(3) })));
