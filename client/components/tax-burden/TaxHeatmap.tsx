'use client';

import type { Denominator, TaxItem } from '@/types/tax-burden';
import { HEATMAP_AGES } from '@/app/lib/tax-burden/simulate-lifecycle';
import { TAX_ITEMS } from '@/app/lib/tax-burden/households';
import { availableTaxItems, BENEFIT_PARTS, cellRate, DENOMINATOR_LABEL, type HeatmapGrid } from '@/app/lib/tax-burden/heatmap-items';

const shortLabel = (item: TaxItem) => TAX_ITEMS.find(t => t.id === item)!.label.replace('（差し引き）', '');

const PHASE = { work: '現役', reemployed: '継続雇用', 'work-pension': '就労＋年金', pension: '年金' } as const;

function Grid({ grid, item, compact, hasConsumption, denominator }: { grid: HeatmapGrid; item: TaxItem; compact: boolean; hasConsumption: boolean; denominator: Denominator }) {
  const values = grid.flatMap(r => r.cells.map(c => cellRate(c, item, denominator))).filter((v): v is number => v !== null);
  const peak = Math.max(0, ...values.map(v => Math.abs(v)));
  // Teal and orange get their own scale, spread over the values actually present rather than over 0 to the largest.
  // The net-burden panel runs from about +12% to +44% while the pension years reach -93%: scaling both from zero to
  // the larger side left every working-age cell the same pale teal. Items that do have zero cells keep zero as the
  // pale end, because their minimum is zero. The 0.005 floor keeps an all-zero panel from being painted out of a
  // rounding artefact.
  const spread = (sign: number) => {
    const side = values.filter(v => Math.sign(v) === sign).map(Math.abs);
    const hi = Math.max(0.005, ...side);
    return { lo: Math.min(hi, ...side), hi };
  };
  const scales = { 1: spread(1), '-1': spread(-1) } as Record<string, { lo: number; hi: number }>;
  const shade = (v: number) => {
    if (v === 0) return 0;
    const { lo, hi } = scales[String(Math.sign(v))];
    return hi > lo ? 0.15 + 0.85 * (Math.abs(v) - lo) / (hi - lo) : 1;
  };
  const label = TAX_ITEMS.find(t => t.id === item)!.label;
  const ages = compact ? HEATMAP_AGES.filter((_, i) => i % 2 === 0 || i === HEATMAP_AGES.length - 1) : HEATMAP_AGES;
  const rows = compact ? grid.filter((_, i) => i % 2 === 1 || i === grid.length - 1) : grid;
  return <div className={compact ? 'rounded-xl border border-mirai-border bg-card p-3' : ''}>
    {compact && <p className="mb-2 text-xs font-bold">{label}<span className="ml-2 font-normal text-mirai-text-secondary">最大 {(peak * 100).toFixed(1)}%</span></p>}
    <div className="overflow-x-auto"><table className={`w-full border-separate border-spacing-0.5 tabular-nums ${compact ? 'text-[10px]' : 'text-xs'}`} aria-label={`${label}の年齢×年収ヒートマップ`}>
      <thead><tr><th scope="col" className="text-left font-normal">{compact ? '年収＼年齢' : '現役期年収＼年齢'}</th>{ages.map(a => <th key={a} scope="col" className="px-1 font-normal">{a}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.income}>
        <th scope="row" className="whitespace-nowrap text-left font-medium">{(row.income / 10000).toLocaleString('ja-JP')}万</th>
        {row.cells.filter(c => ages.includes(c.ageAt as typeof ages[number])).map(c => {
          const v = cellRate(c, item, denominator);
          const alpha = v === null ? 0 : Math.min(1, shade(v));
          // Only the fill carries meaning: the text stays one colour so a pale or white number never reads as a value of its own.
          const fill = (v === null ? 0 : 0.05 + alpha * 0.63) * (c.outOfScope ? 0.35 : 1);
          const bg = v === null ? 'transparent' : v < 0 ? `rgba(217, 119, 87, ${fill})` : `rgba(30, 150, 140, ${fill})`;
          return <td key={c.ageAt} className={`rounded px-1 text-center ${compact ? 'py-1' : 'py-2'}`} style={{ backgroundColor: bg }}
            title={`${(row.income / 10000).toLocaleString('ja-JP')}万円・${c.ageAt}歳（${PHASE[c.phase]}）：総収入${Math.round(c.income / 10000).toLocaleString('ja-JP')}万円（うち年金${Math.round(c.pensionIncome / 10000).toLocaleString('ja-JP')}万円）、${label} ${v === null ? '未定義' : `${(v * 100).toFixed(1)}%（${Math.round(v * (denominator === 'career' ? c.careerIncome : c.income)).toLocaleString('ja-JP')}円、${DENOMINATOR_LABEL[denominator]}）`}${c.outOfScope ? '（適用範囲外）' : ''}`}>
            {v === null ? '—' : (v * 100).toFixed(1)}
          </td>;
        })}
      </tr>)}</tbody>
    </table></div>
    {!compact && <p className="mt-3 text-xs leading-relaxed text-mirai-text-subtle">制度モデルの計算値です（統計の実測値ではありません）。{denominator === 'career'
      ? '分母はすべての年齢で行の現役期年収。65歳以降の公的年金は負担のマイナス（受け取り）として扱い、年金額は現役期年収から算出。'
      : '分母はその年に受け取った総収入（給与＋年金）。年金は分母に入るので、受給期の率は現役期より軽く出ます。年金額は行の現役期年収から算出。'}薄いセルは就労者の給与が被用者保険の賃金要件（年105.6万円）に届かず、国民年金・国保の扱いが前提次第で変わる帯。{item === 'net' && (hasConsumption ? '純負担には消費税推計を含みます。' : '消費税は消費支出データ未読込のため含まれません。')}</p>}
  </div>;
}

export function TaxHeatmap({ grid, hasConsumption, reformed, denominator }: { grid: HeatmapGrid; hasConsumption: boolean; reformed: boolean; denominator: Denominator }) {
  const item: TaxItem = 'net';
  const label = TAX_ITEMS.find(t => t.id === item)!.label;
  const available = availableTaxItems(grid, hasConsumption, denominator);
  const items = available.filter(t => t.id !== 'net');
  const paying = BENEFIT_PARTS.filter(id => available.some(t => t.id === id)).map(shortLabel);
  // Child items switch off at an age that comes from the assumed birth years, not from the rules themselves.
  const cells = grid[0]?.cells ?? [];
  const span = (pick: (c: typeof cells[number]) => boolean) => {
    const ages = cells.filter(pick).map(c => c.ageAt);
    return ages.length ? { from: Math.min(...ages), to: Math.max(...ages) } : null;
  };
  const benefitSpan = span(c => c.childBenefit > 0);
  // 働き終える年は左パネルの設定で動く。住民税の段差はその翌年に出るので、注記も追随させる。
  const retiresAt = Math.min(...cells.filter(c => c.phase === 'pension').map(c => c.ageAt), Infinity);
  const dependantSpan = span(c => c.childrenPresent > 0);
  return <div className="space-y-6">
    <div>
      <p className="mb-2 text-xs text-mirai-text-secondary">大きい表＝{label} ÷ {denominator === 'career' ? '現役期の世帯年収（行）' : 'その年の総収入（給与＋年金）'}。列は年齢。濃いほど負担率が高く、橙は差し引き（現金給付・年金受給が負担を上回る）。緑と橙はそれぞれに出てくる値の幅いっぱいに濃淡を割り当てています（0〜最大で塗ると、年金期の大きなマイナスに引きずられて現役期の差が見えなくなるため）。左パネルを「税・給付」に切り替えると、税目ごとのスライダーでこの表を動かせます。{hasConsumption ? 'このビューは税目を分解するのが目的なので、消費税（推計）は常に含めて計算しています（家計調査2024年の年収十分位別支出から推計）。' : '消費支出データを読み込めていないため、消費税は含まれていません。'}</p>
      <Grid grid={grid} item={item} compact={false} hasConsumption={hasConsumption} denominator={denominator} />
    </div>
    <div>
      <h3 className="mb-1 text-sm font-bold">税目ごとに分解する{reformed && <span className="ml-2 font-normal text-primary-accent">改革案で計算中</span>}</h3>
      <p className="mb-3 text-xs text-mirai-text-secondary">同じ格子を税目別に並べた小さな表（年収・年齢は間引き表示、値は%）。色の濃さは各表に出てくる値の最小〜最大に広げているので、表の間で濃さは比べず、形（どの年齢・所得に偏るか）を比べてください。この世帯で常に0になる項目は表を出していません。0.0%は制度上0のときと、現役期年収に対して0.05%未満のときの両方があります（金額はセルにカーソルを当てると出ます）。</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map(t => <Grid key={t.id} grid={grid} item={t.id} compact hasConsumption={hasConsumption} denominator={denominator} />)}</div>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-relaxed text-mirai-text-secondary">
        <li>所得税・住民税は年収が高いほど、また扶養控除が切れる年齢で濃くなる（累進）。</li>
        {benefitSpan && dependantSpan && <li><strong>子どもに紐づく項目が切り替わる年齢は、制度ではなく前提の置き方で決まります。</strong>本モデルは大人32歳・34歳のときに子が生まれ23歳で独立すると置いているので、児童手当は{benefitSpan.from}〜{benefitSpan.to}歳の列にだけ出て、扶養控除は{dependantSpan.to}歳の列で終わります。児童手当は子の年齢（18歳以下）で決まる給付で、親の年齢とは関係ありません。出産年齢が違えば、養子縁組があれば、この列はそのままずれます。ここで見えているのは「子が巣立って世帯が子なしに変わる」ことであって、年齢そのものの効果ではありません。</li>}
        <li><strong>働き終えた年の住民税だけ重いのは、住民税が前年所得課税だからです。</strong>{Number.isFinite(retiresAt) && `本モデルの設定では${retiresAt}歳で、その年に納めるのは前年（${retiresAt - 1}歳）の給与で計算した住民税です。`}年金所得に見合う額に下がるのは翌年から。60歳の列が重いのも同じ理由（前年59歳の満額給与で課税）です。分母をその年の総収入にしていると、給与が止まって分母だけ小さくなるので率は大きく跳ねます（現役期2,000万円で約30%）。左パネルの「何歳まで働くか」を動かすと段差もその年に移り、「60歳以降の賃金」を下げると小さくなります。</li>
        <li><strong>働いていない年齢にも住民税が出るのは、公的年金にも住民税がかかるからです。</strong>前の項目の「退職した翌年に1回だけ乗る分」とは別に、66歳以降もずっと続く分があります。公的年金等控除を引いた後の合計所得が非課税限度額を超える世帯だけで、本モデルの片働き夫婦・子2人なら現役期年収800万円以上の行に年約4.7万円が残り、500万円以下の行は0です。年齢とともに少しずつ下がるのは、70歳で配偶者が老人控除対象配偶者になること（翌71歳の列に出ます）と、75歳で医療保険が後期高齢者医療に替わり、世帯で等分していた国民健康保険と違って一人ひとりの所得で保険料が決まるため、社会保険料控除が年金の多い側に寄ることによります（どちらも前年所得課税なので、効くのは翌年の列です）。</li>
        <li>70歳以降に住民税が0になる行があるのも計算漏れではありません。公的年金等控除（65歳以上は最低110万円）を引いた合計所得が非課税限度額（1級地で単身45万円、控除対象配偶者のいる夫婦101万円）を下回るためで、本モデルでは片働き夫婦・子2人なら現役期年収500万円まで、単身でも300万円なら住民税非課税になります。800万円以上で横ばいなのは、厚生年金の標準報酬月額に上限（65万円）があり年金額が頭打ちになるため。金額で見ると現役期800万円の夫婦で年3.99万円、家計調査の無職世帯（70〜74歳）の実測平均4.19万円とほぼ一致します。</li>
        <li>年金・雇用保険料は現役期のみで、標準報酬の上限（65万円）を超える年収では負担率が下がる（上限効果）。</li>
        <li>医療・介護保険料は65歳以降も続く。介護保険料（第1号）は所得段階別の定額（全国平均基準額 年7.5万円×段階倍率）を夫婦それぞれが払うため、年金収入250〜340万円の夫婦で年9〜17万円。家計調査の無職世帯（65歳以上）の実測平均は年8〜9万円で、現役期より明らかに重い。</li>
        <li>消費税（推計）は年収が低いほど負担率が高い（逆進）。</li>
        <li><strong>現金給付として計算するのは、児童手当・児童扶養手当・年金生活者支援給付金と、改革案でつくった追加給付だけです。</strong>生活保護・住宅手当・就学援助・医療や介護の現物給付は含みません。{paying.length ? `この世帯で支給されるのは${paying.join('・')}のみのため、内訳の表もそれだけを出しています。` : 'この世帯ではいずれも支給されないため、現金給付の表は出していません。'}年金生活者支援給付金は、本モデルが40年納付の満額基礎年金（83.2万円）を前提とし所得要件（78.9万円以下）を超えるため、常に0になります（補足的給付は未実装）。</li>
        {items.some(t => t.id === 'corporateTax') && <li>法人税の転嫁は、左パネルで置いた仮定です。全国の法人所得課税のうち賃金に転嫁される分を、賃金に比例して配分しています。給与のある年齢には所得に関わらずほぼ一定の率でかかり、年金期には出ません。</li>}
        {denominator === 'career'
          ? <li>公的年金の受給は65歳以降に現役期年収の40〜80%相当の受け取りとなり、純負担は負に転じる。現役期年収が高いほど年金の対年収比は小さい（基礎年金が定額、報酬比例に上限があるため）。</li>
          : <><li>年金だけの年でも純負担は正のままで、現役期の半分前後（本モデルでは10〜17%）。所得税・住民税はほぼ0でも、医療保険料と介護保険料が年金から引かれ続けるためです。分母を現役期年収に切り替えると、受け取る年金が負担を上回るので同じ年が大きな負のセルになります。どちらも同じ金額の別の見方です。</li>
            <li>この分母では「公的年金の受給」の表は総収入に占める年金の割合を表します（年金だけの年は-100%、働きながら受け取る年は途中の値）。純負担率には足し込まれません。年金を負担のマイナスとして差し引いた見方は、分母を現役期年収に切り替えると出ます。</li></>}
      </ul>
    </div>
  </div>;
}
