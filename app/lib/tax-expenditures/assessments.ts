import { expandedAssessments } from './assessment-expansion';

export const assessmentDate = '2026-09-24';
export const assessmentScope = '2024年度の制度・適用実績を対象とする試行評価。後年公表の検証資料も参照。2026年度の現行制度の評価ではありません。';
export const axes = ['政策の必要性', '効果・追加性', '費用対効果', '公平性・対象設定', '検証可能性'] as const;
export type Score = 0 | 1 | 2 | 3 | 4;
export type Evidence = { title: string; url: string; pages: string; published: string };
export type AxisAssessment = { score: Score | null; reason: string; sources: Evidence[] };
export type Assessment = { scores: AxisAssessment[]; action: string; next: string; verification: { label: string; met: boolean; reason: string }[] };

const rdMeti: Evidence = { title: '経済産業省・研究開発税制について', url: 'https://www.cao.go.jp/zei-cho/content/7ebpm6kai2.pdf', pages: 'PDF 3–4・13ページ', published: '2025-11-12' };
const rdMof: Evidence = { title: '財務省・租税特別措置の検証（研究開発税制）', url: 'https://www.cao.go.jp/zei-cho/content/7ebpm6kai1.pdf', pages: 'PDF 14・28ページ', published: '2025-11-12' };
const wageMof: Evidence = { title: '財務省・近年の法人税改革の振り返り', url: 'https://www.mof.go.jp/tax_policy/councils/zeicho/241119_2-1.pdf', pages: 'PDF 14・40–42ページ', published: '2024-11-19' };
const actual: Evidence = { title: '財務省・2024年度租特適用実態の総括表', url: 'https://www.mof.go.jp/tax_policy/reference/stm_report/fy2025/houkoku01.xlsx', pages: '「総括表」研究開発：24行～／賃上げ：217行～', published: '2026-02' };
const rdStudy: Evidence = { title: 'RIETI・2015年度研究開発税制変更の効果分析', url: 'https://www.rieti.go.jp/jp/publications/summary/22070009.html', pages: '研究概要（22-J-027）', published: '2022-07' };
const wageStudy: Evidence = { title: '財務省・賃上げ促進税制の検証（事務局資料）', url: 'https://www.mof.go.jp/about_mof/councils/ebpm_benkyoukai/ebpm_gijiyoshi/jimukyoku_siryou.pdf', pages: 'PDF 8–10ページ', published: '2023年度の検証資料' };

// Scores are editorial AI assessments, never scores attributed to the source agencies.
export const assessments: Record<string, Assessment> = {
  ...expandedAssessments,
  'mof-2024-r24': {
    scores: [
      { score: 3, reason: '研究成果の外部波及という介入理由と国内投資を支える目的が示されている。税制と補助金の比較による手段選択の優位性までは確認できず、満点にはしない。', sources: [rdMeti, rdMof] },
      { score: 2, reason: '2003年の制度変更等を用いた効果推計が紹介されている。一方、古い制度の結果を2024年度の全区分に適用できるとは限らず、現在の追加的投資・成果の検証は不足している。', sources: [rdMeti, rdMof] },
      { score: 2, reason: '2015年度改正について、OI型拡充による外部研究投資の増加と税収減の比較を行った反実仮想分析がある。ただし投資額は社会的純便益ではなく、2024年度の制度全体への外挿にも限界がある。', sources: [rdStudy, actual] },
      { score: 2, reason: '中小企業向け・共同研究等の区分はあるが、基本的に納税額のある法人が対象となる。受益の分布と政策効果を対応させた評価を追加する必要がある。', sources: [actual, rdMof] },
      { score: 2, reason: '下記4条件のうち2条件を確認。対象年度・制度に対応する因果推計と、追試・見直し判断に必要な資料の不足を各1点の減点として反映。', sources: [actual, rdMeti, rdMof] },
    ],
    verification: [
      { label: '制度要件と適用実績が公開されている', met: true, reason: '総括表で区分別の要件・件数・金額を確認できる。' },
      { label: '効果分析の方法と結果が公開されている', met: true, reason: '経産省資料が過去の国内制度変更に関する推計方法・結果を紹介している。' },
      { label: '対象年度・制度に対応する因果推計がある', met: false, reason: '2024年度全区分に対応した反実仮想との比較結果は参照資料では未確認。' },
      { label: '追試可能な資料と期限付きの見直し基準がある', met: false, reason: '参照資料では分析を再現する一式と具体的な見直し判断基準を確認できない。' },
    ],
    action: '追加検証',
    next: '一般型・中小企業型・特別試験研究費ごとに追加投資と成果を推計し、補助金との比較、黒字・赤字企業の支援差を検証。更新時の判断基準を公開する。',
  },
  'mof-2024-r217': {
    scores: [
      { score: 2, reason: '賃金停滞という課題と賃上げを促す目的は明確。税額控除を選ぶ優位性や、優遇なしでも起きる賃上げとの区別は十分に確認できない。', sources: [wageMof] },
      { score: 1, reason: '追加調査でヒストグラム・パネル・マクロ分析を確認。パネル分析は相関があるが逆因果等が課題、マクロ分析では有意差を確認できない。効果ゼロの証明ではないが、追加性を支持する根拠は弱い。', sources: [wageStudy] },
      { score: null, reason: '減収額の実績・見込みだけでは、追加的な賃上げ1円を生む財政費用を計算できない。参照資料では対応する効果推計が不足。', sources: [wageMof, actual] },
      { score: 2, reason: '企業規模別の要件と、中小企業の繰越控除という対象への配慮は確認できる。継続的な赤字企業も含めた実際の受益・効果の分布は追加検証が必要。', sources: [wageMof] },
      { score: 2, reason: '効果分析の方法・結果の公開を追加確認し、従来の1点から2点へ修正。対象年度の因果推計と追試・見直し資料は不足しており各1点減点。', sources: [wageStudy, wageMof, actual] },
    ],
    verification: [
      { label: '制度要件と適用実績が公開されている', met: true, reason: '規模別の仕組みと適用額を確認できる。' },
      { label: '効果分析の方法と結果が公開されている', met: true, reason: '事務局資料にヒストグラムと計量分析の方法・結果・限界が公開されている。' },
      { label: '対象年度・制度に対応する因果推計がある', met: false, reason: '2024年度の規模別区分に対応した追加的賃上げの推計は参照資料では未確認。' },
      { label: '追試可能な資料と期限付きの見直し基準がある', met: false, reason: '適用期限はあるが、追試用の分析資料と効果に基づく見直し基準は参照資料では未確認。' },
    ],
    action: '追加検証',
    next: '規模別・黒字赤字別に比較対象を設け、税制が誘発した賃上げと減収額を対応づける。効果の乏しい区分が確認された場合に対象・要件の縮減を検討する。',
  },
};

export const rubric = [
  '0：根拠から重大な問題を確認／1：弱い裏付け／2：一定の裏付けがあるが重要な課題が残る／3：十分な裏付けがあるが限界が残る／4：強い裏付けと主要な懸念への対応を確認。高得点ほど妥当性を支持します。',
  '検証可能性は別ルールです。①要件・実績の公開、②効果分析の方法・結果、③対象年度の因果推計、④追試可能な資料と期限付き見直し基準を各1点。資料不足はその条件を0点として減点します。',
  '未調査の制度は採点しません。検証可能性以外の未確認項目も0点扱いにしません。未確認を含む総合点・順位は作らず、点数と調査範囲を併記します。',
];
