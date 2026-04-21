/**
 * 支出先タグ分類ロジック
 *
 * 支出先レコードに対して組織種別・業種タグを自動付与します。
 *
 * 設計方針（Opusレビュー反映）:
 * 1. 名前パターンを優先判定
 * 2. corporateTypeは補助的に使用
 * 3. 正規表現を事前コンパイルして高速化
 */

import type {
  SpendingRecord,
  SpendingTags,
  PrimaryCategory,
  IndustryTag
} from '@/types/structured';

// ========================================
// 事前コンパイル済み正規表現パターン
// ========================================

const PATTERNS = {
  // 行政組織
  REGIONAL_BUREAU: /地方整備局$|農政局$|森林管理局$|経済産業局$|財務局$/,
  LABOR_BUREAU: /労働局$/,
  DEFENSE_BUREAU: /防衛局$/,
  MINISTRY: /省$/,
  PREFECTURE: /[都道府県]$/,
  MUNICIPALITY: /[市区町村]$/,

  // 法人格（名前内表示）
  NRDO: /国立研究開発法人/,
  IAA: /独立行政法人/,
  GENERAL_CORP: /一般社団法人|一般財団法人/,
  PUBLIC_CORP: /公益社団法人|公益財団法人/,
  KABUSHIKI: /株式会社/,
  YUGEN: /有限会社/,
  GODO: /合同会社/,
  GOSHI: /合資会社/,

  // 公益法人等
  UNIVERSITY: /大学$/,
  COOPERATIVE: /組合$|連合会$/,
  SPECIAL_CORP: /機構$|事業団$|基金$/,
  ASSOCIATION: /協会$/,

  // 法人格除外パターン
  COMPANY_SUFFIXES: /(株式会社|有限会社|合同会社)/,

  // 外国法人（英語名）
  FOREIGN_COMPANY: /^(Amazon|Google|Microsoft|Apple|Oracle|IBM|SAP|Accenture|McKinsey|Boston Consulting|Bain|AWS|Meta|OpenAI)/i,

  // 業種判定
  IT_SYSTEM: /システム|保守|運用|クラウド|ネットワーク|ソフトウェア|ICT|データベース|サーバ|セキュリティ/,
  DEFENSE: /防衛|装備|誘導弾|艦艇|航空機|自衛隊|武器|戦闘機/,
  CONSTRUCTION: /建設|土木|整備局|工事|ゼネコン|施工/,
  CONSULTING: /コンサル|アクセンチュア|デロイト|PwC|McKinsey|野村総合研究所|Boston Consulting/,
  SECRETARIAT: /事務局|協議会|推進|支援事業/,
  EDUCATION: /大学|研究|学術|科学|教育/,
  MEDICAL: /医療|保険|健康|病院|製薬|診療/,
  ENERGY: /エネルギー|石油|ガス|電力|原子力/,
  PRINTING: /印刷|広告|博報堂|電通/,
  AGRICULTURE: /農業|農政|林業|森林|水産/,
  MANUFACTURING: /製造|工業|重工/,
  FINANCE: /金融|銀行|証券|保険/,
  LOGISTICS: /物流|運輸|郵便|配送/
} as const;

// ========================================
// 業種タグの優先順位
// ========================================

const INDUSTRY_PRIORITY: IndustryTag[] = [
  '防衛・装備',        // 1. 安全保障は最優先
  'ITシステム・保守',  // 2. IT関連
  '事務局・BPR',      // 3. 事務局モデル
  'コンサルティング', // 4. コンサル
  '建設・土木',       // 5. 公共事業
  '医療・保険',       // 6. 社会保障
  '教育・研究',       // 7. 教育
  'エネルギー',       // 8. エネルギー
  '印刷・広告',       // 9. 印刷・広告
  '金融',             // 10. 金融
  '物流・運輸',       // 11. 物流
  '農林水産',         // 12. 農林水産
  '製造',             // 13. 製造
  'その他'            // 14. その他
];

// ========================================
// メイン分類関数
// ========================================

/**
 * 支出先レコードにタグを付与
 */
export function classifySpending(spending: SpendingRecord): SpendingTags {
  const name = spending.spendingName;
  const corporateType = spending.corporateType;

  // 1. 組織種別の判定（Primary & Secondary Category）
  const { primaryCategory, secondaryCategory } = detectOrganizationType(name, corporateType);

  // 2. 業種タグの判定
  const industryTags = detectIndustryTags(spending);

  // 3. 主要業種の決定
  const primaryIndustryTag = determinePrimaryIndustry(industryTags);

  // 4. ロックインリスクは別途分析で設定
  return {
    primaryCategory,
    secondaryCategory,
    primaryIndustryTag,
    industryTags
  };
}

// ========================================
// 組織種別判定ロジック（Opus修正版）
// ========================================

/**
 * 組織種別の判定
 *
 * 判定順序（Opusレビュー反映）:
 * 1. 名前パターンで確実に判定できるもの（最優先）
 * 2. 法人格表示で判定
 * 3. 名前末尾パターン
 * 4. corporateTypeによる判定（補助）
 */
export function detectOrganizationType(
  name: string,
  corporateType: string
): { primaryCategory: PrimaryCategory; secondaryCategory: string } {

  // ========================================
  // 優先度1: 名前パターンで確実に判定できるもの（最優先）
  // ========================================

  // 地方整備局等（301に混入しているものも含む）
  if (PATTERNS.REGIONAL_BUREAU.test(name)) {
    return {
      primaryCategory: 'government',
      secondaryCategory: '地方整備局等'
    };
  }

  // 労働局
  if (PATTERNS.LABOR_BUREAU.test(name)) {
    return {
      primaryCategory: 'government',
      secondaryCategory: '労働局'
    };
  }

  // 防衛局
  if (PATTERNS.DEFENSE_BUREAU.test(name)) {
    return {
      primaryCategory: 'government',
      secondaryCategory: '国の機関'
    };
  }

  // 省庁（「〜省」で終わる、ただし法人格を含まない）
  if (PATTERNS.MINISTRY.test(name) && !PATTERNS.COMPANY_SUFFIXES.test(name)) {
    return {
      primaryCategory: 'government',
      secondaryCategory: '国の機関'
    };
  }

  // ========================================
  // 優先度2: 法人格表示で判定
  // ========================================

  // 国立研究開発法人（名前に明示されている）
  if (PATTERNS.NRDO.test(name)) {
    return {
      primaryCategory: 'public-interest',
      secondaryCategory: '国立研究開発法人'
    };
  }

  // 独立行政法人
  if (PATTERNS.IAA.test(name)) {
    return {
      primaryCategory: 'public-interest',
      secondaryCategory: '独立行政法人'
    };
  }

  // 一般社団・財団法人
  if (PATTERNS.GENERAL_CORP.test(name)) {
    return {
      primaryCategory: 'public-interest',
      secondaryCategory: '一般社団・財団法人'
    };
  }

  // 公益社団・財団法人
  if (PATTERNS.PUBLIC_CORP.test(name)) {
    return {
      primaryCategory: 'public-interest',
      secondaryCategory: '公益社団・財団法人'
    };
  }

  // 外国法人（英語名パターン or corporateType）
  if (PATTERNS.FOREIGN_COMPANY.test(name) || corporateType === '401') {
    return {
      primaryCategory: 'private',
      secondaryCategory: '外国法人'
    };
  }

  // 株式会社
  if (PATTERNS.KABUSHIKI.test(name)) {
    return {
      primaryCategory: 'private',
      secondaryCategory: '株式会社'
    };
  }

  // 有限会社
  if (PATTERNS.YUGEN.test(name)) {
    return {
      primaryCategory: 'private',
      secondaryCategory: '有限会社'
    };
  }

  // 合同会社
  if (PATTERNS.GODO.test(name)) {
    return {
      primaryCategory: 'private',
      secondaryCategory: '合同会社'
    };
  }

  // 合資会社
  if (PATTERNS.GOSHI.test(name)) {
    return {
      primaryCategory: 'private',
      secondaryCategory: '合資会社'
    };
  }

  // ========================================
  // 優先度3: 名前末尾パターン
  // ========================================

  // 都道府県
  if (PATTERNS.PREFECTURE.test(name)) {
    return {
      primaryCategory: 'government',
      secondaryCategory: '都道府県'
    };
  }

  // 市区町村
  if (PATTERNS.MUNICIPALITY.test(name)) {
    return {
      primaryCategory: 'government',
      secondaryCategory: '市区町村'
    };
  }

  // 大学
  if (PATTERNS.UNIVERSITY.test(name)) {
    return {
      primaryCategory: 'public-interest',
      secondaryCategory: '大学'
    };
  }

  // 組合
  if (PATTERNS.COOPERATIVE.test(name)) {
    return {
      primaryCategory: 'public-interest',
      secondaryCategory: '組合'
    };
  }

  // 機構・事業団・基金
  if (PATTERNS.SPECIAL_CORP.test(name)) {
    return {
      primaryCategory: 'public-interest',
      secondaryCategory: '特殊法人・機構'
    };
  }

  // 協会
  if (PATTERNS.ASSOCIATION.test(name)) {
    return {
      primaryCategory: 'public-interest',
      secondaryCategory: '協会'
    };
  }

  // ========================================
  // 優先度4: corporateTypeによる判定（名前で判定できなかった場合）
  // ========================================

  switch (corporateType) {
    case '101':
      return { primaryCategory: 'government', secondaryCategory: '国の機関' };
    case '201':
      return { primaryCategory: 'government', secondaryCategory: '都道府県' };
    case '301':
      return { primaryCategory: 'private', secondaryCategory: '株式会社' };
    case '302':
      return { primaryCategory: 'private', secondaryCategory: '有限会社' };
    case '304':
      return { primaryCategory: 'private', secondaryCategory: '合資会社' };
    case '305':
      return { primaryCategory: 'private', secondaryCategory: '合同会社' };
    case '399':
      return { primaryCategory: 'public-interest', secondaryCategory: '公益法人等' };
    case '499':
      return { primaryCategory: 'public-interest', secondaryCategory: 'その他法人' };
    default:
      return { primaryCategory: 'individual-other', secondaryCategory: '個人・その他' };
  }
}

// ========================================
// 業種タグ判定ロジック
// ========================================

/**
 * 業種タグの判定（名前パターンベース）
 */
function detectIndustryTags(spending: SpendingRecord): IndustryTag[] {
  const name = spending.spendingName;
  const tags: IndustryTag[] = [];

  // 名前パターンから判定
  if (PATTERNS.IT_SYSTEM.test(name)) {
    tags.push('ITシステム・保守');
  }

  if (PATTERNS.DEFENSE.test(name)) {
    tags.push('防衛・装備');
  }

  if (PATTERNS.CONSTRUCTION.test(name)) {
    tags.push('建設・土木');
  }

  if (PATTERNS.CONSULTING.test(name)) {
    tags.push('コンサルティング');
  }

  if (PATTERNS.SECRETARIAT.test(name)) {
    tags.push('事務局・BPR');
  }

  if (PATTERNS.EDUCATION.test(name)) {
    tags.push('教育・研究');
  }

  if (PATTERNS.MEDICAL.test(name)) {
    tags.push('医療・保険');
  }

  if (PATTERNS.ENERGY.test(name)) {
    tags.push('エネルギー');
  }

  if (PATTERNS.PRINTING.test(name)) {
    tags.push('印刷・広告');
  }

  if (PATTERNS.AGRICULTURE.test(name)) {
    tags.push('農林水産');
  }

  if (PATTERNS.MANUFACTURING.test(name)) {
    tags.push('製造');
  }

  if (PATTERNS.FINANCE.test(name)) {
    tags.push('金融');
  }

  if (PATTERNS.LOGISTICS.test(name)) {
    tags.push('物流・運輸');
  }

  // タグが1つもなければ「その他」
  if (tags.length === 0) {
    tags.push('その他');
  }

  return tags;
}

// ========================================
// 主要業種決定ロジック
// ========================================

/**
 * 業種タグリストから主要業種を決定
 *
 * 優先順位リストに基づいて、最も優先度の高い業種を返す
 */
function determinePrimaryIndustry(tags: IndustryTag[]): IndustryTag {
  for (const priority of INDUSTRY_PRIORITY) {
    if (tags.includes(priority)) {
      return priority;
    }
  }
  return 'その他';
}
