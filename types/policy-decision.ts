export type Score04 = 0 | 1 | 2 | 3 | 4;
export type Applicability = 'applicable' | 'not_applicable' | 'unknown';

export type ApplicableScore = {
  applicability: Applicability;
  score: Score04 | null;
  confidence: number;
  reason: string;
};

export type PolicyDecisionInput = {
  pid: string;
  evidenceConfidence: number;
  evidenceReadiness: Score04;
  effect: {
    outcomeAchievement: Score04 | null;
    causalContribution: Score04 | null;
    costEffectiveness: Score04 | null;
    durabilityAndCoverage: Score04 | null;
  };
  value: {
    problemImportance: ApplicableScore;
    governmentRole: ApplicableScore;
    equityAndInclusion: ApplicableScore;
    resilienceAndExternalities: ApplicableScore;
    strategicAndLongTermValue: ApplicableScore;
    fiscalSustainability: ApplicableScore;
  };
  decision: {
    alternativeAvailability: Score04 | null;
    duplication: Score04 | null;
    obsolescence: Score04 | null;
    legalObligation: boolean | null;
  };
};

export type PolicyRecommendation =
  | 'EVIDENCE_REQUIRED'
  | 'CONTINUE'
  | 'CONTINUE_WITH_IMPROVEMENT'
  | 'REDUCE_OR_RESTRUCTURE'
  | 'ABOLITION_CANDIDATE'
  | 'REFORM_LEGAL_SCHEME';

export type PolicyDecisionScore = {
  policyEffectScore: number | null;
  policyValueScore: number | null;
  abolitionPriorityScore: number | null;
  recommendation: PolicyRecommendation;
  humanDecisionRequired: boolean;
};

const weightedScore = (
  values: Array<{ score: number | null; weight: number }>,
): number | null => {
  const available = values.filter(
    (value): value is { score: number; weight: number } => value.score !== null,
  );
  if (available.length !== values.length) return null;
  const weightTotal = available.reduce((sum, value) => sum + value.weight, 0);
  return Math.round(
    (available.reduce((sum, value) => sum + value.score * 25 * value.weight, 0) /
      weightTotal) *
      10,
  ) / 10;
};

export function calculatePolicyDecision(
  input: PolicyDecisionInput,
): PolicyDecisionScore {
  // 廃止判断は、成果証拠が一定以上そろうまで計算しない。
  const evidenceGate =
    input.evidenceReadiness >= 3 && input.evidenceConfidence >= 0.7;

  const policyEffectScore = weightedScore([
    { score: input.effect.outcomeAchievement, weight: 35 },
    { score: input.effect.causalContribution, weight: 25 },
    { score: input.effect.costEffectiveness, weight: 20 },
    { score: input.effect.durabilityAndCoverage, weight: 20 },
  ]);

  const applicableValues = Object.values(input.value)
    .filter((axis) => axis.applicability === 'applicable')
    .map((axis) => ({ score: axis.score, weight: 1 }));
  const policyValueScore =
    applicableValues.length > 0 ? weightedScore(applicableValues) : null;

  if (
    !evidenceGate ||
    policyEffectScore === null ||
    policyValueScore === null ||
    input.decision.alternativeAvailability === null ||
    input.decision.duplication === null ||
    input.decision.obsolescence === null
  ) {
    return {
      policyEffectScore,
      policyValueScore,
      abolitionPriorityScore: null,
      recommendation: 'EVIDENCE_REQUIRED',
      humanDecisionRequired: true,
    };
  }

  const abolitionPriorityScore = weightedScore([
    { score: (100 - policyEffectScore) / 25, weight: 30 },
    { score: (100 - policyValueScore) / 25, weight: 25 },
    { score: input.decision.alternativeAvailability, weight: 15 },
    { score: input.decision.duplication, weight: 15 },
    { score: (100 - input.effect.costEffectiveness! * 25) / 25, weight: 10 },
    { score: input.decision.obsolescence, weight: 5 },
  ])!;

  if (input.decision.legalObligation) {
    return {
      policyEffectScore,
      policyValueScore,
      abolitionPriorityScore,
      recommendation:
        abolitionPriorityScore >= 50 ? 'REFORM_LEGAL_SCHEME' : 'CONTINUE_WITH_IMPROVEMENT',
      humanDecisionRequired: true,
    };
  }

  const recommendation: PolicyRecommendation =
    abolitionPriorityScore >= 70
      ? 'ABOLITION_CANDIDATE'
      : abolitionPriorityScore >= 50
        ? 'REDUCE_OR_RESTRUCTURE'
        : policyEffectScore >= 70 && policyValueScore >= 70
          ? 'CONTINUE'
          : 'CONTINUE_WITH_IMPROVEMENT';

  return {
    policyEffectScore,
    policyValueScore,
    abolitionPriorityScore,
    recommendation,
    humanDecisionRequired: recommendation === 'ABOLITION_CANDIDATE',
  };
}
