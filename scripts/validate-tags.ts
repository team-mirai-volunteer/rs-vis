/**
 * タグ分類ロジックのバリデーションスクリプト
 *
 * 主要な支出先名パターンに対してタグ判定が正しく動作するかテストします。
 *
 * 実行方法:
 *   npx tsx scripts/validate-tags.ts
 */

import type { PrimaryCategory } from '@/types/structured';
import { detectOrganizationType } from './tag-classifier';

interface TagValidationCase {
  name: string;
  corporateType: string;
  expectedPrimary: PrimaryCategory;
  expectedSecondary: string;
  description?: string;
}

const VALIDATION_CASES: TagValidationCase[] = [
  // ========================================
  // 行政組織
  // ========================================

  // 地方整備局等（corporateType=301でも名前で判定）
  {
    name: '関東地方整備局',
    corporateType: '301',
    expectedPrimary: 'government',
    expectedSecondary: '地方整備局等',
    description: '301コードだが名前で行政組織と判定'
  },
  {
    name: '九州地方整備局',
    corporateType: '301',
    expectedPrimary: 'government',
    expectedSecondary: '地方整備局等'
  },
  {
    name: '東北農政局',
    corporateType: '301',
    expectedPrimary: 'government',
    expectedSecondary: '地方整備局等'
  },
  {
    name: '九州農政局',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '地方整備局等'
  },
  {
    name: '東北森林管理局',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '地方整備局等'
  },
  {
    name: '関東経済産業局',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '地方整備局等'
  },
  {
    name: '関東財務局',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '地方整備局等'
  },

  // 労働局
  {
    name: '東京労働局',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '労働局'
  },
  {
    name: 'その他労働局',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '労働局'
  },

  // 防衛局・省庁
  {
    name: '沖縄防衛局',
    corporateType: '101',
    expectedPrimary: 'government',
    expectedSecondary: '国の機関'
  },
  {
    name: '総務省',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '国の機関'
  },
  {
    name: '米空軍省',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '国の機関',
    description: '外国政府機関も「省」パターンで判定'
  },

  // 都道府県
  {
    name: '東京都',
    corporateType: '201',
    expectedPrimary: 'government',
    expectedSecondary: '都道府県'
  },
  {
    name: '大阪府',
    corporateType: '201',
    expectedPrimary: 'government',
    expectedSecondary: '都道府県'
  },
  {
    name: '北海道',
    corporateType: '201',
    expectedPrimary: 'government',
    expectedSecondary: '都道府県'
  },

  // 市区町村
  {
    name: '横浜市',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '市区町村'
  },
  {
    name: '大阪市',
    corporateType: '',
    expectedPrimary: 'government',
    expectedSecondary: '市区町村'
  },

  // ========================================
  // 民間企業
  // ========================================

  // 株式会社
  {
    name: '株式会社博報堂',
    corporateType: '',
    expectedPrimary: 'private',
    expectedSecondary: '株式会社'
  },
  {
    name: '富士通株式会社',
    corporateType: '301',
    expectedPrimary: 'private',
    expectedSecondary: '株式会社'
  },
  {
    name: '三菱重工業株式会社',
    corporateType: '301',
    expectedPrimary: 'private',
    expectedSecondary: '株式会社'
  },
  {
    name: '大日本印刷株式会社',
    corporateType: '',
    expectedPrimary: 'private',
    expectedSecondary: '株式会社'
  },

  // 有限会社
  {
    name: '朝日エナジー有限会社',
    corporateType: '302',
    expectedPrimary: 'private',
    expectedSecondary: '有限会社'
  },

  // 合同会社
  {
    name: 'PwCコンサルティング合同会社',
    corporateType: '305',
    expectedPrimary: 'private',
    expectedSecondary: '合同会社'
  },
  {
    name: 'デロイトトーマツコンサルティング合同会社',
    corporateType: '305',
    expectedPrimary: 'private',
    expectedSecondary: '合同会社'
  },

  // 合資会社
  {
    name: '合資会社得月楼',
    corporateType: '304',
    expectedPrimary: 'private',
    expectedSecondary: '合資会社'
  },

  // 外国法人
  {
    name: 'Amazon Web Services',
    corporateType: '401',
    expectedPrimary: 'private',
    expectedSecondary: '外国法人'
  },
  {
    name: 'McKinsey & Company',
    corporateType: '401',
    expectedPrimary: 'private',
    expectedSecondary: '外国法人'
  },

  // ========================================
  // 公益法人等
  // ========================================

  // 国立研究開発法人
  {
    name: '国立研究開発法人産業技術総合研究所',
    corporateType: '399',
    expectedPrimary: 'public-interest',
    expectedSecondary: '国立研究開発法人'
  },
  {
    name: '国立研究開発法人宇宙航空研究開発機構',
    corporateType: '399',
    expectedPrimary: 'public-interest',
    expectedSecondary: '国立研究開発法人',
    description: 'JAXA'
  },

  // 独立行政法人
  {
    name: '独立行政法人日本学術振興会',
    corporateType: '399',
    expectedPrimary: 'public-interest',
    expectedSecondary: '独立行政法人'
  },

  // 一般社団・財団法人
  {
    name: '一般社団法人全国石油協会',
    corporateType: '',
    expectedPrimary: 'public-interest',
    expectedSecondary: '一般社団・財団法人'
  },
  {
    name: '一般財団法人工業所有権協力センター',
    corporateType: '',
    expectedPrimary: 'public-interest',
    expectedSecondary: '一般社団・財団法人'
  },

  // 公益社団・財団法人
  {
    name: '公益財団法人児童育成協会',
    corporateType: '',
    expectedPrimary: 'public-interest',
    expectedSecondary: '公益社団・財団法人'
  },
  {
    name: '公益社団法人2025年日本国際博覧会協会',
    corporateType: '',
    expectedPrimary: 'public-interest',
    expectedSecondary: '公益社団・財団法人'
  },

  // 特殊法人・機構
  {
    name: '全国健康保険協会',
    corporateType: '399',
    expectedPrimary: 'public-interest',
    expectedSecondary: '協会'
  },
  {
    name: '地方公共団体情報システム機構',
    corporateType: '399',
    expectedPrimary: 'public-interest',
    expectedSecondary: '特殊法人・機構'
  },
  {
    name: '日本私立学校振興・共済事業団',
    corporateType: '399',
    expectedPrimary: 'public-interest',
    expectedSecondary: '特殊法人・機構'
  },

  // 大学
  {
    name: '国立大学法人東京大学',
    corporateType: '',
    expectedPrimary: 'public-interest',
    expectedSecondary: '大学'
  },

  // 組合
  {
    name: '日本郵政共済組合',
    corporateType: '',
    expectedPrimary: 'public-interest',
    expectedSecondary: '組合'
  },
  {
    name: '企業年金連合会',
    corporateType: '499',
    expectedPrimary: 'public-interest',
    expectedSecondary: '組合'
  },

  // ========================================
  // 個人・その他
  // ========================================

  {
    name: '年金受給者',
    corporateType: '',
    expectedPrimary: 'individual-other',
    expectedSecondary: '個人・その他',
    description: '個人扱い'
  },
  {
    name: 'その他',
    corporateType: '',
    expectedPrimary: 'individual-other',
    expectedSecondary: '個人・その他'
  }
];

/**
 * テストケースを実行してバリデーション結果を返す
 */
export function validateTagClassification(): {
  passed: number;
  failed: TagValidationCase[];
  total: number;
} {
  const failed: TagValidationCase[] = [];

  console.log('\n========================================');
  console.log('タグ分類バリデーション開始');
  console.log('========================================\n');

  for (const testCase of VALIDATION_CASES) {
    const result = detectOrganizationType(testCase.name, testCase.corporateType);

    const isCorrect =
      result.primaryCategory === testCase.expectedPrimary &&
      result.secondaryCategory === testCase.expectedSecondary;

    if (!isCorrect) {
      failed.push(testCase);
      console.error(`❌ FAIL: ${testCase.name}`);
      console.error(`   Expected: ${testCase.expectedPrimary}/${testCase.expectedSecondary}`);
      console.error(`   Got:      ${result.primaryCategory}/${result.secondaryCategory}`);
      if (testCase.description) {
        console.error(`   Note:     ${testCase.description}`);
      }
      console.error('');
    } else {
      console.log(`✅ PASS: ${testCase.name}`);
    }
  }

  const passed = VALIDATION_CASES.length - failed.length;

  console.log('\n========================================');
  console.log('バリデーション結果');
  console.log('========================================');
  console.log(`Total:  ${VALIDATION_CASES.length}`);
  console.log(`Passed: ${passed} (${((passed / VALIDATION_CASES.length) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${failed.length}`);
  console.log('========================================\n');

  return { passed, failed, total: VALIDATION_CASES.length };
}

// コマンドラインから実行された場合
if (require.main === module) {
  const result = validateTagClassification();

  if (result.failed.length > 0) {
    console.error('\n⚠️  Some tests failed. Please fix the tag classification logic.\n');
    process.exit(1);
  } else {
    console.log('\n✨ All tests passed!\n');
    process.exit(0);
  }
}
