/**
 * 政策評価スクリーニングの純ロジック。
 *
 * AI（score-project-quality-ai.py）が事業ごとに付与した4観点と、品質スコアの支出先系軸を統合し、
 * 全事業に対して「総合点 / 推奨判断 / 改善アクション」を導出する。
 *
 * 5つの評価軸（すべて 0-100・高いほど良い）:
 *   成果設計    designClarity        誰の課題をどの活動でどう改善するか（概要文＋ロジックモデル）
 *   検証可能性  evidenceReadiness    成果を第三者が検証できるか（登録指標＋概要文）
 *   執行透明性  executionTransparency 支出先が特定できるか・使途を説明できるか（品質軸から算出）
 *   費用対内容  budgetProportionality 金額が活動規模に見合い、金が受益者に届いているか
 *   必要性      necessity            廃止したら誰が困るか・代替手段はあるか
 *
 * 設計上の約束:
 * - 欠測は 0 点にせず、重みごと除外して再正規化する（`weightedAvailable`）。
 * - 不用率（予算と執行の乖離）は総合点に算入しない。返納は適切な行動であり、
 *   減点すると年度末の使い切りを誘発するため。縮小判定にのみ使う。
 * - 推奨判断の帯は母集団のパーセンタイルで切る。総合点は中央に圧縮されるため、
 *   絶対値で閾値を置くと下位バケットが構造的に空になる。
 */

export type PolicyRecommendationTone = 'green' | 'blue' | 'amber' | 'red';

/** 品質スコア側の入力（全事業）。AI採点の結果は同じJSONに同居している */
export interface PolicyQualityInput {
  pid: string;
  budgetAmount: number;
  execAmount: number;
  axisIdentify?: number | null;
  axisPurpose?: number | null;
  axisBudget?: number | null;
  redelegationDepth?: number;
  orphanBlockCount?: number;
  /** 不透明キーワードにマッチする支出先への支出比率 0-1 */
  opaqueRatio?: number | null;
  /** 前年度の執行率。無い事業は null＝判定不能。欠測は不利に扱わない */
  priorExecutionRate?: number | null;

  // ── AI段階採点（0-10） ──
  /** 成果設計の明確さ */
  designClarity?: number | null;
  /** 成果の検証可能性 */
  evidenceReadiness?: number | null;
  /** 費用対内容（金額の見合い＋支出先の妥当性） */
  budgetProportionality?: number | null;
  /** 必要性（廃止したら誰が困るか） */
  necessity?: number | null;
  /** 政策類型の id */
  policyCategory?: string | null;
  /** 軸ごとの判定理由 */
  policyFindings?: { design?: string; evidence?: string; proportionality?: string; necessity?: string } | null;
}

/**
 * 不用の傾向。単年度の不用率だけでは「入札差金でたまたま余った年」と
 * 「毎年構造的に余っている事業」が区別できないため、前年度と突き合わせて分類する。
 */
export type UnusedTrend = 'persistent' | 'single' | 'unknown' | 'normal';

/** 事業1件の政策評価結果 */
export interface PolicyEvaluation {
  pid: string;
  /** 政策類型の id。未分類は null */
  policyCategory: string | null;
  /** 政策類型の表示名 */
  policyCategoryLabel: string | null;

  // ── 5軸（0-100に正規化） ──
  designClarityScore: number | null;
  evidenceScore: number | null;
  executionTransparency: number | null;
  proportionalityScore: number | null;
  necessityScore: number | null;

  // ── AI の生値（0-10）。詳細表示と閾値判定に使う ──
  designClarity: number | null;
  evidenceReadiness: number | null;
  budgetProportionality: number | null;
  necessity: number | null;

  /** 総合点（0-100） */
  overallScore: number | null;
  /** 総合点の母集団内パーセンタイル（0=最下位）。スクリーニングの帯はこれで切る */
  overallPercentile: number | null;

  // ── 予算と執行（総合点に不算入・縮小判定にのみ使う） ──
  unusedRatio: number | null;
  unusedAmount: number | null;
  executionRate: number | null;
  /** 前年度の執行率。実績が無い事業は null＝判定不能 */
  priorExecutionRate: number | null;
  priorUnusedRatio: number | null;
  unusedTrend: UnusedTrend;
  /** 予算をほぼ使い切っているが支出先が不透明＝消化的執行の疑い */
  spendDownRisk: boolean;

  recommendation: string | null;
  recommendationTone: PolicyRecommendationTone | null;
  recommendationReason: string | null;
  improvementAction: string | null;

  /** 軸ごとの判定理由 */
  findings: { design: string; evidence: string; proportionality: string; necessity: string };
  identifiability: number | null;
  purposeExplainability: number | null;
  budgetConsistency: number | null;
  provisionalReason: string;
}

/**
 * 政策類型。tests/fixtures/policy-taxonomy.json と対応する（採点時に AI が id を付与）。
 * グループは選択UIの見出し用で、比較の単位はカテゴリ。
 */
export const POLICY_CATEGORY_GROUPS: Array<{ id: string; label: string; categories: Array<{ id: string; label: string }> }> = [
  { id: 'welfare_benefit', label: '社会保障・給付', categories: [
    { id: 'pension', label: '年金給付' },
    { id: 'health_insurance', label: '医療保険・医療提供' },
    { id: 'elderly_care', label: '介護・高齢者福祉' },
    { id: 'disability', label: '障害者福祉' },
    { id: 'public_assistance', label: '生活保護・困窮者支援' },
    { id: 'childcare', label: '子育て・保育給付' },
  ] },
  { id: 'infrastructure', label: 'インフラ・国土', categories: [
    { id: 'road', label: '道路・交通インフラ' },
    { id: 'river', label: '河川・治水・砂防' },
    { id: 'port_airport', label: '港湾・空港' },
    { id: 'disaster', label: '防災・災害復旧' },
    { id: 'utility', label: '上下水道・廃棄物' },
  ] },
  { id: 'industry_science', label: '産業・エネルギー・研究', categories: [
    { id: 'industry_subsidy', label: '産業補助金・立地支援' },
    { id: 'sme', label: '中小企業支援' },
    { id: 'rnd', label: '研究開発・技術開発' },
    { id: 'energy', label: 'エネルギー・資源' },
    { id: 'agriculture', label: '農林水産' },
  ] },
  { id: 'human_capital', label: '教育・人材・文化', categories: [
    { id: 'school_edu', label: '初等中等教育' },
    { id: 'higher_edu', label: '高等教育・大学' },
    { id: 'scholarship', label: '奨学・修学支援' },
    { id: 'employment', label: '職業訓練・雇用' },
    { id: 'culture', label: '文化・芸術・文化財' },
    { id: 'sports', label: 'スポーツ' },
  ] },
  { id: 'security_diplomacy', label: '安全保障・治安・外交', categories: [
    { id: 'defense', label: '防衛装備・運用' },
    { id: 'public_safety', label: '治安・警察・消防' },
    { id: 'diplomacy', label: '外交・国際協力' },
  ] },
  { id: 'environment_digital', label: '環境・デジタル', categories: [
    { id: 'environment', label: '環境・脱炭素' },
    { id: 'digital', label: 'デジタル・情報システム' },
  ] },
  { id: 'administration', label: '行政運営', categories: [
    { id: 'facility', label: '庁舎・施設管理' },
    { id: 'org_operation', label: '組織運営・人件費' },
    { id: 'survey_pr', label: '調査・広報・普及啓発' },
    { id: 'grant_admin', label: '交付金・基金の管理' },
    { id: 'other', label: 'その他' },
  ] },
];

/** カテゴリ id → 表示名 */
export const POLICY_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  POLICY_CATEGORY_GROUPS.flatMap((g) => g.categories.map((c) => [c.id, c.label])),
);

/** 推奨判断の並び順（継続寄り → 見直し寄り） */
export const RECOMMENDATION_ORDER: Record<string, number> = {
  継続: 1,
  要改善: 2,
  条件付き継続: 3,
  縮小: 4,
  他事業と統合: 5,
  再設計: 6,
  '終了・廃止候補': 7,
};

/** 改善アクションの並び順（開示 → 運用改善） */
export const IMPROVEMENT_ACTION_ORDER: Record<string, number> = {
  情報開示: 1,
  収支是正: 2,
  成果検証: 3,
  KPI改善: 4,
  執行改善: 5,
  ガバナンス改善: 6,
};

/**
 * 総合点の重み。合計100。
 * 費用対内容と必要性を厚くしているのは、この2軸だけが所管庁の作文が支配できない証拠
 * （支出先の実績・予算執行）に基づくため。他3軸は自己申告テキストと登録データが素材になる。
 */
const WEIGHTS = {
  design: 15,
  transparency: 15,
  evidence: 15,
  proportionality: 35,
  necessity: 20,
} as const;

/** 執行透明性の重み。収支の一致は90.5%が満点でほぼ定数のため指標から外し、不一致フラグに降格した */
const TRANSPARENCY_WEIGHTS = { identifiability: 55, purposeExplainability: 45 } as const;

/** 収支不一致とみなす「収支の一致」スコアの上限 */
const BUDGET_MISMATCH_THRESHOLD = 60;

/** 縮小判断に必要な不用額の下限（1億円）。少額の不用でスクリーニングを埋めない */
const MATERIALITY_THRESHOLD = 1e8;

/** 消化的執行とみなす執行率と不透明支出比の下限 */
const SPEND_DOWN_EXEC_RATE = 0.95;
const SPEND_DOWN_OPAQUE_RATIO = 0.2;

const PROVISIONAL_REASON =
  '総合点は暫定値です。成果実績が十分でないことを政策効果0点とはせず、'
  + '欠測は重みごと除外して再正規化しています。「終了・廃止候補」は結論ではなく政党レビューへ送るスクリーニング結果です。';

/**
 * スクリーニングの帯（総合点の母集団内パーセンタイル）。
 * 総合点は複数指標の加重平均のため中央に強く圧縮される。絶対値で切ると下位が空になるため
 * パーセンタイルで定義し、各帯には絶対条件も併置して、母集団全体が良好な場合に
 * 機械的に下位N%が見直し対象になることを避けている。
 */
// critical(終了・廃止候補) を 5 にしているのは、費用対内容が未判定の事業を候補から外した結果、
// 下位2%では6件しか残らなかったため。5%で31件になり、人が全件読める量かつ
// 「小さいが要らない」の抽出装置として機能する水準になる。
const BAND = { critical: 5, severe: 10, conditional: 25, improve: 50 } as const;

/**
 * 各軸の閾値。固定値だと尺度やモデルを変えたときに全部ずれるため、母集団の分位点から決める。
 */
export interface AxisThresholds {
  /** 成果設計が最低水準（母集団 p10）。終了・廃止候補の必須条件 */
  designCritical: number;
  /** 成果設計が弱い（母集団 p25） */
  designWeak: number;
  /** 検証可能性が不足（母集団 p30） */
  evidenceWeak: number;
  /** 必要性が低い（母集団 p15）。終了・廃止候補の必須条件 */
  necessityLow: number;
  /** 費用対内容が低い（母集団 p25） */
  proportionalityLow: number;
  /** 不用率が高い（母集団 p75） */
  unusedRatioHigh: number;
}

function weightedAvailable(values: Array<number | null>, weights: number[]): number | null {
  let total = 0;
  let weightTotal = 0;
  values.forEach((value, index) => {
    if (value !== null && value !== undefined) {
      total += value * weights[index];
      weightTotal += weights[index];
    }
  });
  return weightTotal ? total / weightTotal : null;
}

function formatOku(yen: number): string {
  if (yen >= 1e12) return `${(yen / 1e12).toFixed(1)}兆円`;
  return `${(yen / 1e8).toFixed(0)}億円`;
}

type Recommendation = { label: string; tone: PolicyRecommendationTone; reason: string };

export function chooseRecommendation(input: {
  overallPercentile: number;
  designClarity: number | null;
  evidenceReadiness: number | null;
  proportionality: number | null;
  necessity: number | null;
  executionTransparency: number | null;
  unusedRatio: number | null;
  unusedAmount: number | null;
  unusedTrend: UnusedTrend;
  priorUnusedRatio: number | null;
  spendDownRisk: boolean;
  budgetConsistency: number | null;
  axis: AxisThresholds;
}): Recommendation {
  const {
    overallPercentile, designClarity, necessity, proportionality,
    executionTransparency, unusedRatio, unusedAmount, unusedTrend, priorUnusedRatio,
    spendDownRisk, axis,
  } = input;

  // 終了・廃止候補は「そもそも要るのか」が崩れていることを必須条件にする。
  // 設計が粗いだけ、証拠が無いだけでは候補にしない（情報不足を廃止シグナルに転化しないため）。
  //
  // 成果設計が下位帯であることも必須にしている。設計が成り立っている事業は、
  // 費用対効果に疑問があっても「再設計」「条件付き継続」で扱うほうが妥当なため。
  // 廃止候補は「要らない、かつ設計も成り立っていない」に限る。
  //
  // 費用対内容が未判定の事業は除外する。重み35の軸を欠いたまま総合点が下位に来ているのは
  // 「悪い」ではなく「分からない」であり、最も強いラベルの根拠にはできない
  // （支出先が未登録で執行透明性が0になっている事業がこれに当たる。次の一手は廃止ではなく情報開示）。
  if (
    overallPercentile <= BAND.critical &&
    necessity !== null && necessity <= axis.necessityLow &&
    designClarity !== null && designClarity > 0 && designClarity <= axis.designCritical &&
    proportionality !== null
  ) {
    return {
      label: '終了・廃止候補',
      tone: 'red',
      reason:
        '総合点が母集団の最下位帯にあり、廃止した場合に困る主体を具体的に特定できず代替手段もあると判定されています。'
        + '成果設計も最低水準ですが、記載が無いのではなく実質が弱いと判定されたものです。'
        + '費用対内容も判定済みで、判断材料が欠けているために下位に来ているのではありません。'
        + '終了を含む比較検討の対象とし、最終判断は政党レビューで行います。',
    };
  }

  if (
    overallPercentile <= BAND.severe &&
    designClarity !== null && designClarity <= axis.designWeak
  ) {
    return {
      label: '再設計',
      tone: 'red',
      reason:
        '対象・活動・期待便益の接続が弱く、総合点も下位帯にあります。'
        + '予算規模の調整ではなく事業設計自体の見直しが必要です。',
    };
  }

  // 縮小は政策の良し悪しではなく「予算が実際に使われていない」執行実績から判断する。
  // 単年度の振れではなく2年連続の構造的な計上過大に限る。
  const materialUnused =
    unusedRatio !== null && unusedAmount !== null &&
    unusedRatio >= axis.unusedRatioHigh && unusedAmount >= MATERIALITY_THRESHOLD;
  if (materialUnused && unusedTrend === 'persistent') {
    const prior = priorUnusedRatio === null ? '' : `（前年度も${Math.round(priorUnusedRatio * 100)}%）`;
    return {
      label: '縮小',
      tone: 'amber',
      reason:
        `予算額の${Math.round(unusedRatio! * 100)}%（${formatOku(unusedAmount!)}）が2年連続で執行されていません${prior}。`
        + '見直すのは事業そのものではなく翌年度の計上額です。'
        + '不用額の返納は適切な行動であり減点対象ではないため、この判定は総合点には影響していません。',
    };
  }

  // 費用対内容が下位帯なら、金額そのものより支出の中身に問題がある
  if (
    overallPercentile <= BAND.conditional &&
    proportionality !== null && proportionality <= axis.proportionalityLow
  ) {
    return {
      label: '条件付き継続',
      tone: 'amber',
      reason:
        '支出の単価や支出先の妥当性を確認できません。継続は可能ですが、'
        + '契約内訳と最終的な受益者の開示を次年度の継続条件として確認します。',
    };
  }

  if (materialUnused && (unusedTrend === 'single' || unusedTrend === 'unknown')) {
    return {
      label: '条件付き継続',
      tone: 'amber',
      reason:
        unusedTrend === 'single'
          ? `当年度は予算額の${Math.round(unusedRatio! * 100)}%が未執行ですが、前年度は通常水準でした。単年の要因か構造的な計上過大かを見極めます。`
          : `予算額の${Math.round(unusedRatio! * 100)}%が未執行です。前年度の実績が無く傾向を判定できないため、次年度の執行状況を確認します。`,
    };
  }

  if (overallPercentile <= BAND.conditional) {
    return {
      label: '条件付き継続',
      tone: 'amber',
      reason: '継続は可能ですが、成果指標や執行改善に期限を設け、次年度の継続条件として確認します。',
    };
  }

  // 不用を縮小シグナルにすると「使い切れば逃げられる」誘因が生まれる。対の旗を立てる。
  if (spendDownRisk) {
    return {
      label: '要改善',
      tone: 'blue',
      reason:
        '予算をほぼ使い切っている一方で、支出先の相当部分が不透明な区分に計上されています。'
        + '執行率の高さだけでは予算規模の妥当性を確認できないため、支出先の内訳開示が必要です。',
    };
  }

  if (overallPercentile <= BAND.improve || (executionTransparency !== null && executionTransparency < 60)) {
    return {
      label: '要改善',
      tone: 'blue',
      reason: '現時点で終了を検討する水準ではありませんが、説明・執行透明性・成果確認の改善が必要です。',
    };
  }

  return {
    label: '継続',
    tone: 'green',
    reason: '現時点では政策設計と執行面に大きな見直しシグナルがなく、継続が妥当です。',
  };
}

/**
 * 「次の一手」を1つだけ返す。ブロッキング度の高い順に評価する。
 * 支出先が特定できない状態では成果の検証も設計の議論も成立しないため、
 * 情報開示・ガバナンスを成果検証やKPIより先に置いている。
 */
export function chooseImprovementAction(input: {
  designClarity: number | null;
  evidenceReadiness: number | null;
  proportionality: number | null;
  executionTransparency: number | null;
  identifiability: number | null;
  purposeExplainability: number | null;
  budgetConsistency: number | null;
  redelegationDepth: number;
  orphanBlockCount: number;
  spendDownRisk: boolean;
  axis: AxisThresholds;
}): string | null {
  const {
    designClarity, evidenceReadiness, proportionality, executionTransparency,
    identifiability, purposeExplainability, budgetConsistency,
    redelegationDepth, orphanBlockCount, spendDownRisk, axis,
  } = input;

  if (budgetConsistency !== null && budgetConsistency < BUDGET_MISMATCH_THRESHOLD) return '収支是正';
  if (
    spendDownRisk ||
    (identifiability !== null && identifiability < 60) ||
    (purposeExplainability !== null && purposeExplainability < 60) ||
    (proportionality !== null && proportionality <= axis.proportionalityLow)
  ) {
    return '情報開示';
  }
  // 再委託が深い・孤立ブロックがあると、資金の流れの追跡自体が成立しない
  if (redelegationDepth >= 3 || orphanBlockCount > 0) return 'ガバナンス改善';
  if (evidenceReadiness !== null && evidenceReadiness <= axis.evidenceWeak) return '成果検証';
  if (designClarity !== null && designClarity <= axis.designWeak) return 'KPI改善';
  if (executionTransparency !== null && executionTransparency < 75) return '執行改善';
  return null;
}

/** 昇順ソート済み配列における value のパーセンタイル順位（0=最下位, 100=最上位） */
function percentileRank(sorted: number[], value: number): number {
  if (sorted.length <= 1) return 100;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return (lo / (sorted.length - 1)) * 100;
}

/** 昇順ソート済み配列の分位点 */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Infinity;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

/**
 * 品質スコア（AI採点の結果を含む）から全事業分の政策評価を組み立てる。
 * 閾値は母集団から算出するため、モデルや尺度を変えても自動で追従する。
 */
export function buildPolicyEvaluations(qualityItems: PolicyQualityInput[]): PolicyEvaluation[] {
  // ── 1パス目: 事業ごとの素点 ──
  const drafts = qualityItems.map((item) => {
    const identifiability = item.axisIdentify ?? null;
    const purposeExplainability = item.axisPurpose ?? null;
    const budgetConsistency = item.axisBudget ?? null;

    const designClarity = item.designClarity ?? null;
    const evidenceReadiness = item.evidenceReadiness ?? null;
    const proportionality = item.budgetProportionality ?? null;
    const necessity = item.necessity ?? null;

    // k投票を有効にすると 0-10 の生値は平均されて小数になる（例 6.33）。
    // 0-100 に伸ばしたうえで丸め、表示と閾値判定で端数が漏れないようにする。
    const to100 = (v: number | null) => (v === null ? null : Math.round(v * 10));
    const designScore = to100(designClarity);
    const evidenceScore = to100(evidenceReadiness);
    const proportionalityScore = to100(proportionality);
    const necessityScore = to100(necessity);

    // 支出先データが1行も無い事業の扱い。
    // 執行額があるのに支出先が登録されていないなら、それ自体が不透明なので 0 点にする
    // （未評価にして重みごと除外すると、登録しないほうが有利になってしまう）。
    // 一方で執行額が0の事業は、そもそも払っていないので登録するものが無い。
    // これを0点にすると未着手・予備的経費を不透明と断じることになるため、従来どおり未評価のままにする。
    const noRecipientData = identifiability === null && purposeExplainability === null;
    const executionTransparency = noRecipientData
      ? (item.execAmount > 0 ? 0 : null)
      : weightedAvailable(
        [identifiability, purposeExplainability],
        [TRANSPARENCY_WEIGHTS.identifiability, TRANSPARENCY_WEIGHTS.purposeExplainability],
      );

    // 予算と執行。執行実績が無い事業（予備的経費・未着手）は「全額不用」ではなく評価対象外。
    const canAssessBudget = item.budgetAmount > 0 && item.execAmount > 0;
    const unusedRatio = canAssessBudget
      ? Math.max(0, Math.min(1, (item.budgetAmount - item.execAmount) / item.budgetAmount))
      : null;
    const unusedAmount = canAssessBudget ? Math.max(0, item.budgetAmount - item.execAmount) : null;
    const executionRate = canAssessBudget ? item.execAmount / item.budgetAmount : null;
    const priorUnusedRatio =
      item.priorExecutionRate == null ? null : Math.max(0, Math.min(1, 1 - item.priorExecutionRate));

    const opaqueRatio = item.opaqueRatio ?? null;
    const spendDownRisk =
      executionRate !== null && executionRate >= SPEND_DOWN_EXEC_RATE &&
      opaqueRatio !== null && opaqueRatio >= SPEND_DOWN_OPAQUE_RATIO;

    const overallRaw = weightedAvailable(
      [designScore, executionTransparency, evidenceScore, proportionalityScore, necessityScore],
      [WEIGHTS.design, WEIGHTS.transparency, WEIGHTS.evidence, WEIGHTS.proportionality, WEIGHTS.necessity],
    );

    return {
      item, identifiability, purposeExplainability, budgetConsistency,
      designClarity, evidenceReadiness, proportionality, necessity,
      designScore, evidenceScore, proportionalityScore, necessityScore,
      executionTransparency: executionTransparency === null ? null : Math.round(executionTransparency),
      unusedRatio, unusedAmount, executionRate, priorUnusedRatio, spendDownRisk,
      overallScore: overallRaw === null ? null : Math.round(overallRaw),
    };
  });

  // ── 母集団統計 ──
  const sortedOf = (pick: (d: (typeof drafts)[number]) => number | null) =>
    drafts.map(pick).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const overallSorted = sortedOf((d) => d.overallScore);
  const unusedSorted = sortedOf((d) => d.unusedRatio);
  const axis: AxisThresholds = {
    designCritical: quantile(sortedOf((d) => d.designClarity), 0.10),
    designWeak: quantile(sortedOf((d) => d.designClarity), 0.25),
    evidenceWeak: quantile(sortedOf((d) => d.evidenceReadiness), 0.30),
    necessityLow: quantile(sortedOf((d) => d.necessity), 0.15),
    proportionalityLow: quantile(sortedOf((d) => d.proportionality), 0.25),
    unusedRatioHigh: quantile(unusedSorted, 0.75),
  };

  // ── 2パス目: 母集団内の位置を使って判定 ──
  return drafts.map((d) => {
    const { item } = d;
    const overallPercentile =
      d.overallScore === null ? null : percentileRank(overallSorted, d.overallScore);

    // 不用の傾向。前年度が無い事業は unknown（判定不能）で、不利には扱わない。
    let unusedTrend: UnusedTrend = 'normal';
    if (d.unusedRatio !== null && d.unusedRatio >= axis.unusedRatioHigh) {
      if (d.priorUnusedRatio === null) unusedTrend = 'unknown';
      else if (d.priorUnusedRatio >= axis.unusedRatioHigh) unusedTrend = 'persistent';
      else unusedTrend = 'single';
    }

    const f = item.policyFindings ?? {};
    const base = {
      pid: item.pid,
      policyCategory: item.policyCategory ?? null,
      policyCategoryLabel: item.policyCategory ? (POLICY_CATEGORY_LABELS[item.policyCategory] ?? null) : null,
      designClarityScore: d.designScore,
      evidenceScore: d.evidenceScore,
      executionTransparency: d.executionTransparency,
      proportionalityScore: d.proportionalityScore,
      necessityScore: d.necessityScore,
      designClarity: d.designClarity,
      evidenceReadiness: d.evidenceReadiness,
      budgetProportionality: d.proportionality,
      necessity: d.necessity,
      overallScore: d.overallScore,
      overallPercentile,
      unusedRatio: d.unusedRatio,
      unusedAmount: d.unusedAmount,
      executionRate: d.executionRate,
      priorExecutionRate: item.priorExecutionRate ?? null,
      priorUnusedRatio: d.priorUnusedRatio,
      unusedTrend,
      spendDownRisk: d.spendDownRisk,
      findings: {
        design: f.design ?? '',
        evidence: f.evidence ?? '',
        proportionality: f.proportionality ?? '',
        necessity: f.necessity ?? '',
      },
      identifiability: d.identifiability,
      purposeExplainability: d.purposeExplainability,
      budgetConsistency: d.budgetConsistency,
      provisionalReason: PROVISIONAL_REASON,
    };

    if (d.overallScore === null || overallPercentile === null) {
      return { ...base, recommendation: null, recommendationTone: null, recommendationReason: null, improvementAction: null };
    }

    const recommendation = chooseRecommendation({
      overallPercentile,
      designClarity: d.designClarity,
      evidenceReadiness: d.evidenceReadiness,
      proportionality: d.proportionality,
      necessity: d.necessity,
      executionTransparency: d.executionTransparency,
      unusedRatio: d.unusedRatio,
      unusedAmount: d.unusedAmount,
      unusedTrend,
      priorUnusedRatio: d.priorUnusedRatio,
      spendDownRisk: d.spendDownRisk,
      budgetConsistency: d.budgetConsistency,
      axis,
    });
    const improvementAction = chooseImprovementAction({
      designClarity: d.designClarity,
      evidenceReadiness: d.evidenceReadiness,
      proportionality: d.proportionality,
      executionTransparency: d.executionTransparency,
      identifiability: d.identifiability,
      purposeExplainability: d.purposeExplainability,
      budgetConsistency: d.budgetConsistency,
      redelegationDepth: item.redelegationDepth ?? 0,
      orphanBlockCount: item.orphanBlockCount ?? 0,
      spendDownRisk: d.spendDownRisk,
      axis,
    });

    return {
      ...base,
      recommendation: recommendation.label,
      recommendationTone: recommendation.tone,
      recommendationReason: recommendation.reason,
      improvementAction,
    };
  });
}
