/**
 * サンキーAIチャットのエージェントコア（実行環境非依存）。
 *
 * ユーザーの自然言語要求を SankeyQuery（フィルタ条件）に翻訳する。LLM は tool calling で
 * run_sankey_query / search_projects / search_recipients を反復実行して条件を検証・調整し、
 * submit_result で確定する。確定クエリは executeQuery で再度 resolveSankeyQuery を通すため、
 * AI の生出力がそのままクライアントへ返ることはない。
 *
 * レイヤー規約: このファイルは fs・fetch・NextResponse・React を一切 import しない Pure 層。
 * - LLM 呼び出しは LlmCaller として注入する（サーバ=API層の OpenRouter fetch、
 *   クライアント=ブラウザから OpenRouter 直接）
 * - ツール実行は ChatToolExecutor として注入する（サーバ=ローダ直呼び
 *   （tool-executor-server.ts）、クライアント=公開 API fetch + graph ローカル実行
 *   （client/lib/ai/client-tool-executor.ts））
 * 両モードの応答同一性はツール応答（payload）の形を揃えることで担保する
 * （設計: docs/ai-chat-architecture-guide.md）。
 */
import type { SankeyQuery } from '@/types/sankey-query';
import type { SankeyChatMessage, SankeyChatContext, SankeyChatResult, SankeyChatProgressEvent } from '@/types/sankey-ai-chat';
import { SANKEY_QUERY_DEFAULTS, TOP_PROJECT_MAX, TOP_RECIPIENT_MAX } from '@/app/lib/sankey-query';
import type { ProjectSearchScope } from '@/app/lib/search/project-search';
import type { SupportedYear } from '@/app/lib/api/api-notes';
import { HIGHLIGHT_METRIC_NAMES } from '@/app/lib/highlights';
import { QUALITY_SCORES_PID_LIMIT, type QueryExecution } from '@/app/lib/ai/tool-shaping';
import { NAV_TARGETS, NAV_TARGET_KEYS, FISCAL_POLICIES, HOUSEHOLD_IDS, TAX_EXPENDITURE_YEARS, TAX_EXPENDITURE_VIEWS, findNavTarget, navTargetHref, type NavParams, type TaxExpenditureYear } from '@/app/lib/ai/nav-targets';
import { parseTaxBurdenInput, type TaxBurdenInput } from '@/app/lib/ai/tool-shaping-secondary';

// ── OpenAI 互換の LLM メッセージ・ツール型（OpenRouter の chat.completions と1対1） ──

export interface LlmToolCall {
  id: string;
  type?: 'function';
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
}

export interface LlmToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** LLM 1往復。サーバ=API層が OpenRouter への fetch を包んで注入 / クライアント=ブラウザから直接 */
export type LlmCaller = (messages: LlmMessage[], tools: LlmToolDef[]) => Promise<LlmMessage>;

/**
 * ツール実行の抽象（実行環境の差し替え点）。
 * すべて Promise 可。戻り値（payload）は JSON.stringify して LLM に渡るため、
 * 実装間で同じ形を返すこと（サーバ実装の形が正典）。
 */
export interface ChatToolExecutor {
  /** システムプロンプト用: 年度の府省庁名一覧（集約ノード除外・ソート済み） */
  getMinistryNames(year: SupportedYear): Promise<string[]> | string[];
  /** run_sankey_query / submit_result: クエリ検証・実行 */
  executeQuery(input: SankeyQuery, defaultYear: SupportedYear): Promise<QueryExecution> | QueryExecution;
  searchProjects(year: SupportedYear, q: string, scope: ProjectSearchScope): Promise<unknown> | unknown;
  searchRecipients(year: SupportedYear, q: string): Promise<unknown> | unknown;
  searchSpending(year: SupportedYear, q: string): Promise<unknown> | unknown;
  getProjectDetail(year: SupportedYear, pid: string): Promise<unknown> | unknown;
  getQualityScores(year: SupportedYear, pidsRaw: unknown): Promise<unknown> | unknown;
  getRecipientDetail(year: SupportedYear, key: string): Promise<unknown> | unknown;
  getSubcontractChain(year: SupportedYear, pid: string): Promise<unknown> | unknown;
  getHighlights(year: SupportedYear, metricRaw: unknown): Promise<unknown> | unknown;
  compareYears(query: SankeyQuery | undefined, baseYear: SupportedYear, compareYear: SupportedYear): Promise<unknown> | unknown;
  /** 事業の支出先一覧（契約方式・応札者数・落札率つき） */
  getProjectRecipients(year: SupportedYear, pid: string): Promise<unknown> | unknown;
  /** 基金の検索（名前・保有法人・府省）。q が空なら事業 pid に紐づく基金 */
  searchFunds(q: string, pid: string | null): Promise<unknown> | unknown;
  /** 基金 1 件の詳細（key = lineage_id） */
  getFund(key: string): Promise<unknown> | unknown;
  /** 事業者（支出先の法人）の検索と詳細。key（法人番号）があれば 1 件、無ければ q で検索 */
  getVendor(q: string, key: string | null): Promise<unknown> | unknown;
  /** 事業の来年度概算要求（財務省の明細表との突き合わせ） */
  getBudgetRequest(pid: string): Promise<unknown> | unknown;
  /** 概算要求の明細を事業名・府省で検索（補助ビュー: 概算要求） */
  searchBudgetRequests(q: string, ministry: string): Promise<unknown> | unknown;
  /** 法人税の租税特別措置を制度名・条文・キーワードで検索（補助ビュー: 租税特別措置） */
  searchTaxExpenditures(q: string, year: TaxExpenditureYear): Promise<unknown> | unknown;
  /** 家計の税・保険料の試算（補助ビュー: 国民負担。2025 年度制度のモデル計算） */
  estimateTaxBurden(input: TaxBurdenInput): Promise<unknown> | unknown;
}

export interface SankeyChatAgentResult {
  message: string;
  result?: SankeyChatResult;
  /** 次に聞ける質問の提案（最大3件）。submit_result 経由のみ（テキスト回答モードは対象外） */
  suggestions?: string[];
  /** ページ遷移の指示（navigate_page 経由）。クライアントが href へ移動し、result があれば移動先に適用する */
  navigate?: { key: string; href: string; label: string; scenario?: { amounts: Record<string, number> } };
  toolCalls: number;
}

/** LLM 呼び出しの往復上限（1往復で複数ツールが並列に呼ばれうる。深掘りツール追加により探索が長引きうるため6→8） */
const MAX_LLM_ROUNDS = 8;
/** この往復数以降は、結果のある条件が手元にあれば「確定かテキスト回答のみ」を促す */
const NUDGE_AFTER_ROUNDS = 3;
/** ツール実行回数の上限（1リクエストあたりのコスト上限を構造的に抑える。深掘りモード（search→detail→...）は往復が増えるため8→10） */
const MAX_TOOL_CALLS = 10;
/** interpretation（解釈宣言）の切り詰め文字数 */
const INTERPRETATION_LIMIT = 200;
/** suggestions（深掘り提案チップ）1件あたりの切り詰め文字数 */
const SUGGESTION_LIMIT = 60;
/** suggestions の最大件数 */
const SUGGESTIONS_MAX = 3;

const GIVE_UP_MESSAGE =
  'ご要望をフィルタ条件として解釈できませんでした。「再エネ関連で予算100億円以上」「経済産業省の事業だけ」のように、事業名・支出先名・府省庁・金額範囲を含めて具体的にお試しください。';
/**
 * システムプロンプトの版。応答キャッシュの鍵に含め、プロンプトを変えたときに古い応答が 24 時間残らないようにする。
 * 応答の書き方に影響する変更をしたら上げる
 */
export const PROMPT_VERSION = 6;

/** 「解釈できなかった」応答か（応答キャッシュはこれを保存しない） */
export const isGiveUpMessage = (message: string): boolean => message === GIVE_UP_MESSAGE;

// ── ツール定義（JSON Schema） ──

/** SankeyQuery の JSON Schema（LLM のツール引数用。types/sankey-query.ts と対応） */
const SANKEY_QUERY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    year: { type: 'string', enum: ['2024', '2025'], description: '対象年度。通常は現在表示中の年度を維持する' },
    filter: {
      type: 'object',
      description: 'どの事業・支出先を残すか（条件は AND 結合）',
      properties: {
        projectName: {
          type: 'object',
          description: '事業名フィルタ',
          properties: {
            query: { type: 'string', description: '検索文字列。regex=false なら大文字小文字無視の部分一致' },
            regex: { type: 'boolean', description: 'true なら正規表現（フラグi、128文字以内）。OR 条件は正規表現の | で表す' },
          },
          required: ['query'],
        },
        recipientName: {
          type: 'object',
          description: '支出先名フィルタ（構造は projectName と同じ）。includeSubcontract=true で再委託先名にもマッチ（OR・事業単位判定）',
          properties: {
            query: { type: 'string' },
            regex: { type: 'boolean' },
            includeSubcontract: { type: 'boolean', description: 'true = 直接支出先名 または 再委託先名のどちらかにマッチする事業を残す（「支出先または再委託先が◯◯」の要求に使う）' },
          },
          required: ['query'],
        },
        ministries: {
          type: 'array',
          items: { type: 'string' },
          description: '府省庁名の完全一致リスト（いずれかに一致すれば残す）。実在する名称のみ有効',
        },
        budget: {
          type: 'object',
          description: '事業予算額の範囲（1円単位。例: 100億円 = 10000000000）',
          properties: {
            min: { type: ['number', 'null'] },
            max: { type: ['number', 'null'] },
          },
        },
        spending: {
          type: 'object',
          description: '支出先の受領額の範囲（1円単位）',
          properties: {
            min: { type: ['number', 'null'] },
            max: { type: ['number', 'null'] },
          },
        },
        accountCategories: {
          type: 'array',
          items: { type: 'string', enum: ['general', 'special', 'both', 'none'] },
          description: '含める会計区分（general=一般会計, special=特別会計, both=両方, none=区分情報なし）。省略=フィルタなし',
        },
        scores: {
          type: 'object',
          description:
            '政策評価スコア（0〜100）の範囲。「総合点が低い事業」「検証可能性が 40 点以下」「費用対内容が高い事業」のような要求に使う。' +
            '項目: overall=総合点 / design=成果設計 / evidence=検証可能性 / transparency=執行透明性 / proportionality=費用対内容 / necessity=代替困難性。' +
            '「低い」は max: 40、「高い」は min: 80 を目安にし、ユーザーが点数を言えばそれを使う。範囲を指定した項目で評価が無い事業は落ちる',
          properties: Object.fromEntries(['overall', 'design', 'evidence', 'transparency', 'proportionality', 'necessity'].map(k => [k, {
            type: 'object', properties: { min: { type: ['number', 'null'] }, max: { type: ['number', 'null'] } },
          }])),
        },
        yearsRunning: {
          type: 'object',
          description: '継続年数（対象年度 − 開始年度 + 1）の範囲。「10 年以上続いている事業」「始まって 3 年以内の事業」に使う。範囲を指定すると開始年度の記載が無い事業は落ちる',
          properties: { min: { type: ['number', 'null'] }, max: { type: ['number', 'null'] } },
        },
        projectIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            '事業ID（pid）の明示リスト。支出先の集中度・注目シグナル（get_highlights）・品質スコア・執行率のように名前や金額では表せない基準で選んだ事業を図に残すときに使う。' +
            'ツール応答の pid をそのまま入れる（最大300件）。他の条件と AND。名前・金額で表せる要求には使わない',
        },
        subcontract: {
          type: 'object',
          description: '再委託条件。「再委託がある事業だけ」「再々委託まである事業」のような要求に使う',
          properties: {
            hasRedelegation: { type: 'boolean', description: 'true = 再委託の記載がある事業（ブロック階層2以上）のみ残す' },
            minDepth: { type: ['number', 'null'], description: 'ブロック階層数の下限（2=再委託あり、3=再々委託以深、…）。hasRedelegation より優先' },
          },
        },
      },
    },
    view: {
      type: 'object',
      description: 'どう見せるか（表示件数など）。ユーザーが明示しない限り省略してよい',
      properties: {
        topProject: { type: 'number', description: `事業の表示件数（1〜${TOP_PROJECT_MAX}、既定${SANKEY_QUERY_DEFAULTS.topProject}）` },
        topRecipient: { type: 'number', description: `支出先の表示件数（1〜${TOP_RECIPIENT_MAX}、既定${SANKEY_QUERY_DEFAULTS.topRecipient}）` },
        projectSortBy: { type: 'string', enum: ['budget', 'spending'], description: '事業の並び順（既定 budget）' },
        showAggProject: { type: 'boolean', description: '「その他の事業」集約ノードを表示するか（既定 true）' },
        showAggRecipient: { type: 'boolean', description: '「その他の支出先」集約ノードを表示するか（既定 true）' },
      },
    },
  },
};

export const TOOLS: LlmToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'run_sankey_query',
      description:
        'SankeyQuery を実行し、マッチした事業・支出先の件数・金額・上位10件を返す。submit_result の前に必ず実行して、絞り込みの過不足（0件・多すぎ）を確認すること。',
      parameters: {
        type: 'object',
        properties: { query: SANKEY_QUERY_SCHEMA },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_projects',
      description:
        '事業名のキーワード検索（正規化部分一致）。フィルタが0件のときや、ユーザーの語彙が実際の事業名とどう対応するか調べるときに使う。' +
        '事業名で0件のときは scope=details で概要・目的・現状課題も検索すると、計上のねじれ（別府省庁に計上されたシステム等）も拾える。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '検索キーワード' },
          scope: {
            type: 'string',
            enum: ['name', 'details'],
            description: '検索対象。name（既定）=事業名のみ / details=事業名+概要・目的・現状課題も対象',
          },
        },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_recipients',
      description:
        '支出先名のキーワード検索（表記ゆれを含む正規化部分一致）。支出先フィルタの語彙探索に使う。サンキー図の支出先ノード名とは表記が微妙に異なる場合があるため、フィルタには部分一致で緩めに指定するとよい。',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '検索キーワード' } },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_spending',
      description:
        '支出の使途テキスト（role=事業を行う上での役割、cc=契約概要）を横断検索する。「広報にいくら使われている？」「システム改修を受注しているのは誰？」のような使途起点の質問に使う。使途はフィルタとして表現できないため、この種の質問はフィルタを試行錯誤せずこのツールを使うこと。金額集計は直接支出（amountDirect）と再委託（amountSubcontract）を分けて読み、単純合算しないこと（再委託分は通過資金の重複を含みうる）。',
      parameters: {
        type: 'object',
        properties: { q: { type: 'string', description: '検索キーワード（2文字以上）' } },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_detail',
      description:
        '事業の詳細（品質スコア・予算執行額・目的/現状課題/概要等のレビューシート記載内容）をpid指定で取得する。ユーザーが事業名で聞いてきた場合は先に search_projects でpidを特定すること。',
      parameters: {
        type: 'object',
        properties: { pid: { type: 'string', description: 'search_projects / search_recipients が返す事業ID' } },
        required: ['pid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_quality_scores',
      description:
        `複数事業の品質スコア（軸別評価・総合値）をまとめて取得する。比較・ランキング的な質問に使う。pidsは最大${QUALITY_SCORES_PID_LIMIT}件。`,
      parameters: {
        type: 'object',
        properties: {
          pids: {
            type: 'array',
            items: { type: 'string' },
            description: `事業IDの配列（最大${QUALITY_SCORES_PID_LIMIT}件）`,
          },
        },
        required: ['pids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recipient_detail',
      description:
        '支出先の詳細（直接受領額・再委託受領額・府省庁別内訳・関与事業の上位）をkey指定で取得する。keyは search_recipients が返す corporateNumber、または名称ベースのキーを使う。',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: 'search_recipients が返す corporateNumber、または支出先名' } },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_subcontract_chain',
      description:
        '事業内の再委託構造（支出元→支出先の連鎖）を要約する。ブロック数・最大深度・再委託総額・金額上位の連鎖を返す。「この事業は再委託しているか」「委託の階層は深いか」といった質問に使う。',
      parameters: {
        type: 'object',
        properties: { pid: { type: 'string', description: 'search_projects が返す事業ID' } },
        required: ['pid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_years',
      description:
        '同一条件の2年度比較。増減・新規/消滅をAPIが突き合わせ済みで返す。増減ランキングは支出額基準（予算0円のまま執行だけ動く事業があるため）。「去年から増えた?」「年度でどう変わった?」型の質問に使う。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            ...SANKEY_QUERY_SCHEMA,
            description: 'フィルタ条件（filter中心）。省略時はフィルタなし全体を比較する',
          },
          baseYear: { type: 'string', enum: ['2024', '2025'], description: '基準年度' },
          compareYear: { type: 'string', enum: ['2024', '2025'], description: '比較対象年度（baseYear と異なる年度）' },
        },
        required: ['baseYear', 'compareYear'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_highlights',
      description:
        '過去のレポートが人力で見つけた「発見の型」（支出の急増・急減、支出先「その他」比率、支出先の集中、品質スコアと予算規模の乖離、予算と執行の乖離、再委託の深さ）を全事業スキャンして返す。' +
        '「無駄遣いっぽいのを教えて」「気になる/面白い事業ない?」型の質問に使う。これは異常・無駄の判定ではなく観測可能なシグナルの列挙であることに注意（回答時も断定しないこと）。' +
        'metric省略時は複数指標に同時該当した事業（multiSignal）と各指標の上位3件のダイジェストを返す。metric指定時はその指標の上位10件を返す。',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: [...HIGHLIGHT_METRIC_NAMES],
            description: '単一指標に絞り込みたい場合に指定（省略時は全指標のダイジェスト）',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_recipients',
      description:
        '事業の支出先一覧（金額の大きい順・上位20件）。各支出先の金額・法人番号・契約方式（一般競争・随意契約・補助金等）・応札者数・落札率・役割・再委託の階層を返す。' +
        '「1者応札か」「随意契約か」「誰にいくら払ったか」「再委託先は」の問いに使う。',
      parameters: {
        type: 'object',
        properties: { pid: { type: 'string', description: '事業ID' } },
        required: ['pid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_funds',
      description:
        '基金（国が法人に積んだ資金）を名前・保有法人・府省で検索し、残高・国庫返納・終了予定・点検結果の要点を返す（上位10件）。' +
        'pid を指定すると、その事業が造成した／関連する基金を返す。詳細は get_fund。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '基金名・保有法人名・府省名の部分一致。pid 指定時は省略可' },
          pid: { type: 'string', description: '事業ID。この事業に関連する基金だけを返す' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund',
      description: '基金 1 件の詳細（年度ごとの残高・収支・国庫返納・保有割合、造成の経緯、必要性の記載、点検結果、関連事業）。key は search_funds の結果の key。',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: '基金のキー（search_funds の key）' } },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_vendor',
      description:
        '事業者（支出先の法人）の全府省での受注状況。年度ごとの受注額・件数、競争入札と1者応札の件数、主な支出元の府省、2年度以上1者応札が続く事業の一覧を返す。' +
        '「この会社はどこから受注しているか」「1者応札が続いている事業者は」の問いに使う。q で名前・法人番号を検索（上位10件）、key（法人番号）で1件の詳細。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '事業者名・法人番号の部分一致' },
          key: { type: 'string', description: '事業者のキー（法人番号13桁。検索結果の key）' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_budget_request',
      description: '事業の来年度（2027年度）概算要求。レビューシートの要求額と、財務省の概算要求明細表の 目 ごとの要求額・前年度額との突き合わせ結果を返す。「来年度いくら要求しているか」「増える／減るか」の問いに使う。',
      parameters: {
        type: 'object',
        properties: { pid: { type: 'string', description: '事業ID' } },
        required: ['pid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_budget_requests',
      description: '来年度（2027年度）概算要求の明細（財務省の概算要求明細表・レビューシートの要求額）を事業名・事項名・府省で検索する。「○○省の概算要求で大きいもの」「△△関連の要求はいくらか」のような、事業を特定しない概算要求の問いに使う。事業 1 件の要求額は get_budget_request',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '検索語（事業名・事項名・会計名の部分一致）。空なら全件' },
          ministry: { type: 'string', description: '府省名（完全一致。例: 「デジタル庁」「国土交通省」）。任意' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_tax_expenditures',
      description: '法人税の租税特別措置（税優遇の制度）を制度名・条文・キーワードで検索し、適用件数・適用額（千円）・AI による試行評価・関連する RS 事業を返す。「研究開発税制はいくら使われているか」「賃上げ税制の評価は」のような問いに使う',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '検索語（例: 「研究開発」「賃上げ」「中小企業」）。空なら適用額の大きい順' },
          year: { type: 'string', enum: [...TAX_EXPENDITURE_YEARS], description: `適用年度。省略時 "${TAX_EXPENDITURE_YEARS.at(-1)}"` },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estimate_tax_burden',
      description: '年収と世帯の型から、所得税・住民税・年金・医療・介護・雇用保険料と児童手当などの給付、純負担（税＋保険料−給付）とその率を試算する（2025年度制度・現行法のモデル計算）。「年収500万円で片働き子2人だと税と保険料はいくら？」「手取り率は？」のような家計の負担の問いに使う',
      parameters: {
        type: 'object',
        properties: {
          income: { type: 'number', description: '世帯の年収（円。共働きは合算）' },
          household: { type: 'string', enum: [...HOUSEHOLD_IDS], description: '世帯の型: single=単身・子なし / single-children=ひとり親・子2人 / one-earner=片働き夫婦・子なし / one-earner-children=片働き夫婦・子2人 / two-earners=共働き夫婦・子なし / two-earners-children=共働き夫婦・子2人。省略時 one-earner-children' },
          age: { type: 'number', description: '年齢（20〜64）。省略時 40' },
          share: { type: 'number', description: '共働きのとき第1就労者の収入割合（%）。省略時 67' },
          includeConsumption: { type: 'boolean', description: '消費税の推計額（家計調査の支出構成から）も含める。省略時 false' },
        },
        required: ['income'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate_page',
      description:
        'ユーザーが「〜に移動して」「〜を開いて」「〜で見たい」のようにページの移動を求めたときに呼ぶ。呼ぶと会話はそこで終わり、画面がそのページへ移る。' +
        '条件（query）を一緒に渡すと、移動先がサンキー図・評価一覧・委託構造・バブル図ならその条件で絞り込んだ状態で開く。' +
        '補助ビュー（概算要求・租税特別措置・国民負担・財政余力）は query ではなく params でページ固有の条件を渡す。' +
        `page の候補: ${NAV_TARGETS.map(t => `${t.key}=${t.label}${t.aliases.length ? `（${t.aliases.join('・')}）` : ''}`).join(' / ')}`,
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', enum: [...NAV_TARGET_KEYS], description: '移動先のページ' },
          query: { ...SANKEY_QUERY_SCHEMA, description: '移動先に適用する条件（任意）。直前に確定した条件を引き継ぐときはそれをそのまま渡す。サンキー図・評価一覧・委託構造・バブル図のみ' },
          params: {
            type: 'object',
            description: '補助ビュー固有の条件（任意）。移動先に関係ない項目は無視される',
            properties: {
              q: { type: 'string', description: '概算要求・租税特別措置: 検索語' },
              ministry: { type: 'string', description: '概算要求: 府省名（完全一致）' },
              year: { type: 'string', enum: [...TAX_EXPENDITURE_YEARS], description: '租税特別措置: 適用年度' },
              linkedOnly: { type: 'boolean', description: '租税特別措置: RS との関連を確認済みの制度だけ' },
              view: { type: 'string', description: `租税特別措置: ${TAX_EXPENDITURE_VIEWS.join(' / ')}。国民負担: curve（年収別の負担率）/ revenue（国の税目別歳入）/ stats（年齢別の統計）/ age（生涯の推移）/ heatmap（年収×年齢）` },
              income: { type: 'number', description: '国民負担: 年収（円）' },
              household: { type: 'string', enum: [...HOUSEHOLD_IDS], description: '国民負担: 世帯の型（estimate_tax_burden と同じ）' },
              age: { type: 'number', description: '国民負担: 年齢（20〜64）' },
              includeConsumption: { type: 'boolean', description: '国民負担: 消費税の推計を含める' },
              policies: {
                type: 'array',
                description: `財政余力: 試したい政策と年額（円）。id は ${FISCAL_POLICIES.map(p => `${p.id}=${p.name}`).join(' / ')}。例: 消費税減税 5 兆円なら [{ id: "consumption-tax", amountYen: 5000000000000 }]`,
                items: { type: 'object', properties: { id: { type: 'string', enum: FISCAL_POLICIES.map(p => p.id) }, amountYen: { type: 'number' } }, required: ['id', 'amountYen'] },
              },
            },
          },
          message: { type: 'string', description: 'ユーザーへの一言（例: 「サンキー図に移動します」）' },
        },
        required: ['page'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_result',
      description:
        '検証済みの最終フィルタ条件を確定する。run_sankey_query で結果を確認してから呼ぶこと。message にはユーザー向けの短い説明（何をどう絞ったか・何件マッチしたか）を日本語で書く。',
      parameters: {
        type: 'object',
        properties: {
          query: SANKEY_QUERY_SCHEMA,
          message: { type: 'string', description: 'ユーザー向けの説明文（日本語）' },
          interpretation: {
            type: 'string',
            description:
              '曖昧語を解釈して条件化した場合のみ指定する1文（200字以内）。書式例:「『子育て』を事業名に『子育て|こども|保育』を含む事業と解釈しました」。曖昧語がない明確な要求では省略する',
          },
          suggestions: {
            type: 'array',
            items: { type: 'string' },
            description:
              `次に聞ける質問の提案（最大${SUGGESTIONS_MAX}件、各${SUGGESTION_LIMIT}字以内）。現在のツール（get_project_detail / compare_years / get_highlights 等）で実際に答えられる問いのみ。ユーザーがそのまま送信できる短い日本語の質問文にする（例:「この中で品質スコアが低いのは?」「最大の事業の支出先は?」「再委託はある?」「去年から増えた?」「注目シグナルのある事業は?」）。図の適用と無関係な提案や、このアシスタントが答えられない提案（再委託有無・品質スコア・使途のフィルタ化等）は禁止`,
          },
        },
        required: ['query', 'message'],
      },
    },
  },
];

// ── システムプロンプト ──

function buildSystemPrompt(year: SupportedYear, currentQuery: SankeyQuery | undefined, ministryNames: string[], page?: string, pageState?: string): string {
  const lines = [
    // サイト名は出さない（開発リポジトリ名由来の「まるみえ」が応答文に漏れた実績あり。公開版は別名のため一般名称で自称する）
    'あなたは、日本の行政事業レビューの予算・支出データをサンキー図で可視化するサイトのAIアシスタントです。サイト名やシステム名は応答に含めないこと。',
    'ユーザーの自然言語の要求を SankeyQuery（フィルタ条件）に翻訳し、ツールで検証してから submit_result で確定します。',
    '',
    '## データの前提',
    ...(page ? [
      `- ユーザーはいま「${page}」のページを見ている。そのページで見られる情報を優先して案内し、サンキー図でしか見られない条件はその旨を添える`,
      ...(page !== 'サンキー図' ? [`- submit_result で確定した条件は「${page}」のページの絞り込みとして適用される（サンキー図ではない）。message では「サンキー図に反映した」「図に適用した」と書かず、「${page}を N 件に絞り込みました」のように、そのページ名で書く`] : []),
    ] : []),
    ...(pageState ? [
      '',
      '## いま見ている画面の状態（ページがブラウザで計算した結果の要約。ユーザーがこの画面について聞いたら、ツールを呼ばずにここから数字を転記して答える）',
      pageState,
      '- この要約はページの表示と同じ条件付きの試算で、推奨や公式の数値ではない。答えるときは「この条件では」「画面の試算では」と添える',
      '- 要約に無い値は「画面に出ていない」と言い、推測で補わない',
    ] : []),
    `- 対象年度: ${year}（事業年度${year}のデータは予算年度${Number(year) - 1}の執行実績）`,
    '- 対象は行政事業レビュー対象事業のみ（国の全予算の約27%。国債費・地方交付税等は含まない）',
    '- 全金額は1円単位（「100億円」= 10000000000、「1兆円」= 1000000000000）',
    '- 「その他」= 支出先名が文字通り「その他」と報告された支出。「その他の支出先」= 表示件数制限による集約ノード。両者は別物',
    `- filter.ministries は完全一致。実在する府省庁名: ${ministryNames.join('、')}`,
    '',
    '## 手順',
    'このアシスタントには2つのモードがある。要求の性質を見てどちらかを選ぶ:',
    '',
    '### A. フィルタ要求（図の表示条件を変えたい）',
    '- 「総合点（評価）が低い・高い事業を出して・見せて・絞って」「検証可能性が 40 点以下」はこのモード。filter.scores（低い = max: 40、高い = min: 80 を目安）で run_sankey_query → submit_result し、いま見ているページを絞り込む。評価一覧へ移動するのは「評価一覧に行って」のように移動を明示されたときだけ。テキストで上位 10 件を列挙して終えない',
    '「〜の事業」「〜な事業を見たい/教えて/探して」のように、条件に当てはまる事業の集合を求める要求はすべてこのモード。列挙するだけで終えず、必ず図へ適用（submit_result）する。',
    '- 名前・金額・府省庁・会計・再委託で表せる条件はそのまま filter に書く',
    '- 「怪しい/気になる/無駄っぽい」「支出先が1社に集中」「評価スコアが低い」「執行率が低い/予算と執行の乖離」のように名前や金額で表せない基準は、' +
    'get_highlights（metric: concentration / lowScoreHighBudget / execBudgetGap / otherRatio / spendingChange / subcontractDepth）や get_quality_scores で該当事業の pid を集め、' +
    'filter.projectIds にその pid を入れて submit_result する。interpretation に「どの指標の上位何件を選んだか」を書き、message で上位3〜5件の事業名と値を短く挙げる。' +
    '「怪しい」等は無駄の判定ではなく観測可能なシグナルであることを message に必ず添える',
    '- 複合条件（「1000億円以上で支出先がほぼ1社」）は、金額条件で run_sankey_query した結果の summary.recipients.topShare1 や get_highlights(concentration) を使って pid を絞り、金額条件と projectIds を両方入れる',
    '1. 要求を SankeyQuery に翻訳し run_sankey_query で実行する',
    '2. 結果を確認する: 0件なら条件を緩める（正規表現 | で類義語を足す、金額条件を外す等）。search_projects / search_recipients で実際の語彙を調べてもよい（search_projects は scope=details で概要・目的・現状課題も検索できる。事業名で0件のときに試すと、計上のねじれ（別府省庁に計上されたシステム等）も拾える）。多すぎるなら金額下限などで絞る',
    '3. 妥当な結果（1件以上）になったら、追加の探索はせず直ちに submit_result で確定する（message に何をどう絞って何件マッチしたかを書く）。run_sankey_query は通常1〜2回で十分',
    '- 表示件数や並び順の要望（「上位5件だけ」等）は view で表現できる。ユーザーが言及しない限り view は省略する',
    '',
    '### B. データへの質問（特定の事業・支出先の金額・内訳・年度比較・使途など、事業の集合ではなく値を知りたい）',
    '- get_project_detail / get_quality_scores / get_recipient_detail / get_subcontract_chain / compare_years / search_spending で調べ、結果をテキストで日本語回答する。submit_result は呼ばない（図の条件は変わらない）',
    '- 「〜にいくら使われている？」「〜を受注しているのは誰？」のような使途起点の質問は search_spending を使う。回答時は amountDirect（直接支出）と amountSubcontract（再委託）を必ず分けて述べる',
    '- 「去年から増えた?」「年度でどう変わった?」型の質問は compare_years を使う。回答時は「事業年度Nのデータ=予算年度N-1の実績」の注記を必ず添える',
    '- 「無駄遣いっぽい/怪しい/気になる事業を教えて」型の要求はモード A で扱う: get_highlights（metric 省略）で multiSignal（複数指標に同時該当）の事業を取り、その pid を filter.projectIds に入れて submit_result する（multiSignal が無ければ各指標の上位を合わせる）。message では上位数件の事業名と該当シグナルを挙げ、「無駄・不正の判定ではなく、支出の急増・支出先の集中・再委託の深さ・記載と規模の乖離などの観測可能なシグナルに該当したもの」であることを必ず添える。テキストの列挙だけで終えない',
    '- run_sankey_query の結果にある summary.recipients.topShare1 / topShare3 は支出先集中度（上位1社/3社への集中割合）。「集中度が高い事業を探して」型の質問で使える（compare_years の要約には含まれない）',
    '- 数値・事実は必ずツール応答から転記する。ツールで確認していない数値を推測で書かない',
    '- **0件・除外の理由を推測で説明しない**: 「なぜこの事業がマッチしなかったのか」を述べるときは、条件を変えた run_sankey_query（金額下限を外す等）や search_projects で実測してから、トークンごとに「名前不一致 / 金額条件で除外 / マッチ」を切り分けて答える（実例: 事業名の表記ゆれで0件だったものを「予算未満で除外」と誤説明した事故がある）',
    '- pid はユーザーには分からない前提。事業名から聞かれたら、まず search_projects でpidを特定してから深掘りツールを呼ぶ。支出先も同様に search_recipients でキーを特定する',
    '- 契約方式（1者応札・随意契約・落札率）や「誰にいくら払ったか」は get_project_recipients。事業者（法人）側から「どこから受注しているか」「1者応札が続く事業」は get_vendor。基金（残高・国庫返納・終了予定）は search_funds → get_fund。来年度の概算要求は事業 1 件なら get_budget_request、府省や事項名で探すなら search_budget_requests',
    '- 補助ビューの領域: 法人税の租税特別措置（税優遇の制度・適用額・AI 評価）は search_tax_expenditures。「年収○万円・片働き・子2人の税と保険料はいくら？」「手取り率は？」のような家計の負担は estimate_tax_burden（2025年度制度のモデル計算。回答に「モデル計算で実際の課税とは異なる」と添える）。財政余力（「次の1兆円で何が先に足りなくなるか」「消費税を5兆円減税したら」のような政策の仮定）は会話では計算できないので、navigate_page に params.policies（政策 id と年額）を付けて財政余力ページへ案内する',
    '- 品質スコアについて回答する際の語彙規律: スコアは「事業レビューシートに書かれた説明の質（支出先の特定可能性・使途の説明性・成果設計の明確さ等）」を評価したものであり、事業そのものの善悪・要不要・無駄の有無を判定するものではない。「この事業は無駄」のような断定はせず、「レビューシートの記載としては〜」のように表現する',
    '- ツール実行に失敗した・データが見つからない場合はその旨を正直に伝える（存在しないふりをしない）',
    '',
    '### C. ページの移動（「サンキー図に移動して」「委託構造で見たい」「トップに戻って」など）',
    '- navigate_page を呼ぶ。移動先は page の候補から選ぶ。直前に確定した条件があり「この条件のまま」「これを」のように引き継ぐ意図が読めるときは、同じ query を渡す。条件の指定が無ければ query は渡さない',
    '- 「〜の事業をサンキー図で見せて」のように条件と移動が同時に来たら、run_sankey_query で条件を確かめてから navigate_page に query を付けて呼ぶ（submit_result は呼ばない）',
    '- 「〜を出して」「〜を見せて」「〜に絞って」は現在のページの絞り込み（モード A）であって移動ではない。navigate_page はページ名を挙げて移動を求められたときだけ呼ぶ',
    '- 補助ビューへの移動は params で条件を渡す: 概算要求は q・ministry、租税特別措置は q・year・linkedOnly・view、国民負担は income・household・age・view・includeConsumption、財政余力は policies（政策 id と年額）。「年収600万円の共働きで国民負担を見せて」なら navigate_page({ page: "tax-burden", params: { income: 6000000, household: "two-earners" } })。値を聞く質問（「いくら？」）は移動せず estimate_tax_burden / search_* で答え、「見せて」「開いて」のときだけ移動する',
    '',
    '### 共通',
    '- 要求がこのデータのフィルタ条件にもデータ質問にも該当しない場合（雑談・データにない切り口等）は、ツールを呼ばずに、解釈できなかった旨と指定できる条件・質問の例を日本語のテキストで返す',
    '- **フィルタで表現できない絞り込み条件に注意**: SankeyQuery のフィルタは事業名・支出先名・府省庁・金額範囲・会計区分・再委託（filter.subcontract: 有無・ブロック階層の下限）・政策評価スコア（filter.scores）・継続年数（filter.yearsRunning）。政策評価スコア（総合点・成果設計・検証可能性・執行透明性・費用対内容・代替困難性）は filter.scores で絞れる（「総合点が低い事業」= { overall: { max: 40 } } など）。執行率や支出先の集中のようにフィルタに無い基準は get_highlights で pid を集めて filter.projectIds に入れる。再委託の有無・深さは filter.subcontract でフィルタ化できる。filter.recipientName は既定で**直接支出先のみ**に掛かるが、includeSubcontract=true を付ければ「支出先または再委託先が◯◯」（OR・事業単位）を表現できる。再委託先だけを厳密に対象とする条件は表現できないため、その場合は includeSubcontract=true での近似か調査ツールへの誘導を提案する。「使途が広報の事業だけ」のような使途起点の質問も search_spending に誘導する',
    '- 条件が曖昧でも合理的な解釈が1つ選べるなら聞き返さずに進める（フィルタはユーザーが適用前に件数を確認できる）',
    '- 応答はすべて日本語で書く',
    '',
    '## 解釈宣言（submit_result の interpretation）',
    '「子育て」「大型」「〜っぽい」のような曖昧語をAIが解釈して条件化した場合は、submit_result の interpretation に',
    '「『子育て』を事業名に『子育て|こども|保育』を含む事業と解釈しました」のような形式で必ず宣言し、ユーザーが解釈のズレを確認・修正できるようにする。',
    '曖昧語を含まない明確な要求（府省庁名・金額範囲・具体的な事業名等がそのまま条件になる場合）では interpretation は省略してよい。',
    '',
    '## 深掘り提案（submit_result の suggestions）',
    'suggestions には、現在のツール（get_project_detail / get_quality_scores / get_recipient_detail / get_subcontract_chain / compare_years / get_highlights）で実際に答えられる問いのみを、',
    'ユーザーがそのまま送信できる短い日本語の質問文として最大3件挙げる（例:「この中で品質スコアが低いのは?」「最大の事業の支出先は?」「再委託はある?」「去年から増えた?」「注目シグナルのある事業は?」）。',
    '図の適用と無関係な提案や、このアシスタントが答えられない提案（再委託有無・品質スコア・使途のフィルタ化等）は挙げないこと。',
  ];
  const compactQuery = currentQuery ? compactValue(currentQuery) : undefined;
  if (compactQuery !== undefined) {
    lines.push(
      '',
      '## 現在ページに適用中の条件',
      '「今の条件に追加して」「さらに絞って」のような差分指示はこの条件をベースに組み立てる:',
      JSON.stringify(compactQuery),
    );
  }
  return lines.join('\n');
}

/**
 * プロンプト埋め込み用に null / undefined / 空オブジェクト・空配列を再帰的に除去する。
 * URL復元由来の currentQuery は未指定フィールドを null で持つことがあり（例: view.pin の
 * projectId: null）、null を含む JSON をシステムプロンプトに埋め込むと一部プロバイダ
 * （hy3:free/Novita）で応答生成が壊れる事象が再現したため、意味のある値だけを渡す。
 */
function compactValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const items = value.map(compactValue).filter(v => v !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, compactValue(v)] as const)
      .filter(([, v]) => v !== undefined);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

// ── 引数の検証・クランプ ──

function parseToolArgs(raw: string): { args?: Record<string, unknown>; error?: string } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: 'ツール引数はJSONオブジェクトで指定してください' };
    }
    return { args: parsed as Record<string, unknown> };
  } catch (e) {
    return { error: `ツール引数のJSONが不正です: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** submit_result の interpretation を検証・クランプする（未指定・空文字は undefined） */
function clampInterpretation(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (t.length === 0) return undefined;
  return t.length <= INTERPRETATION_LIMIT ? t : `${t.slice(0, INTERPRETATION_LIMIT)}…`;
}

/** submit_result の suggestions を検証・クランプする（string以外・空文字は除去、最大3件・各60字） */
function clampSuggestions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => (s.length <= SUGGESTION_LIMIT ? s : `${s.slice(0, SUGGESTION_LIMIT)}…`))
    .slice(0, SUGGESTIONS_MAX);
  return items.length > 0 ? items : undefined;
}

// ── 進行イベント（onProgress は省略可能。コールバックの例外はループを壊さない） ──

/** onProgress を安全に呼ぶ（例外は握りつぶす。ループの継続を優先する） */
function emitProgress(onProgress: ((ev: SankeyChatProgressEvent) => void) | undefined, ev: SankeyChatProgressEvent): void {
  if (!onProgress) return;
  try {
    onProgress(ev);
  } catch {
    // 進行通知の失敗（SSE切断等）でエージェントループを止めない
  }
}

/** ツール実行直後の進行イベントを組み立てる（結果要約は判別可能な範囲でベストエフォート） */
function buildToolProgressEvent(tool: string, payload: unknown): SankeyChatProgressEvent {
  if ((tool === 'run_sankey_query' || tool === 'submit_result') && payload && typeof payload === 'object') {
    const summary = (payload as { summary?: { projects?: { count?: number } } }).summary;
    const matched = summary?.projects?.count;
    if (typeof matched === 'number') return { kind: 'tool', tool, matched };
  }
  if ((tool === 'search_projects' || tool === 'search_recipients' || tool === 'search_spending') && payload && typeof payload === 'object') {
    const hits = (payload as { totalHits?: number }).totalHits;
    if (typeof hits === 'number') return { kind: 'tool', tool, hits };
  }
  return { kind: 'tool', tool };
}

// ── ツール実行（エージェントループと MCP サーバーの共通部） ──

/** 会話を終える操作系（submit_result・navigate_page）を除いた、外部にも公開できるデータ取得ツール名 */
export const ACTION_TOOL_NAMES: readonly string[] = ['submit_result', 'navigate_page'];
/** navigate_page の query（サンキー条件）を適用できるページ */
export const QUERY_NAV_TARGETS: readonly string[] = ['sankey', 'quality', 'subcontracts', 'bubble'];
export const DATA_TOOL_NAMES = TOOLS.map(t => t.function.name).filter(name => !ACTION_TOOL_NAMES.includes(name));

/**
 * ツール 1 件を実行して LLM・MCP クライアントへ返す payload を作る。
 * 引数の検証（必須項目・年度・文字数下限）はここで一度だけ行い、呼び出し元（チャットのループ・/api/mcp）で揃える。
 * `result` は run_sankey_query が 1 件以上マッチしたときの確定候補（ループが安全網として保持する）。
 */
export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  executor: ChatToolExecutor,
  year: SupportedYear,
): Promise<{ payload: unknown; result?: SankeyChatResult }> {
  switch (name) {
    case 'run_sankey_query': {
      const { errors, result } = await executor.executeQuery((args.query ?? args) as SankeyQuery, year);
      if (errors) return { payload: { errors } };
      const matched = result!.summary.projects.count > 0;
      return {
        payload: {
          appliedQuery: result!.query, summary: result!.summary,
          hint: matched
            ? 'この結果が要求に合っていれば、追加の探索はせず submit_result で確定してください。'
            : '0件です。条件を緩めて（正規表現の別表記・金額下限を外す等）もう一度 run_sankey_query してください。',
        },
        ...(matched ? { result: result! } : {}),
      };
    }
    case 'search_projects':
    case 'search_recipients':
    case 'search_spending': {
      const q = typeof args.q === 'string' ? args.q.trim() : '';
      if (!q) return { payload: { error: 'q（検索キーワード）を指定してください' } };
      // API route（/api/search/spending）と同じ下限。1文字は総当たりに近くなるため弾く
      if (name === 'search_spending' && q.length < 2) return { payload: { error: 'search_spending の q は2文字以上で指定してください' } };
      if (name === 'search_projects') {
        const scope: ProjectSearchScope = args.scope === 'details' ? 'details' : 'name';
        return { payload: await executor.searchProjects(year, q, scope) };
      }
      if (name === 'search_recipients') return { payload: await executor.searchRecipients(year, q) };
      return { payload: await executor.searchSpending(year, q) };
    }
    case 'get_project_detail': {
      const pid = typeof args.pid === 'string' ? args.pid.trim() : '';
      return { payload: pid ? await executor.getProjectDetail(year, pid) : { error: 'pid（事業ID）を指定してください' } };
    }
    case 'get_quality_scores':
      return { payload: await executor.getQualityScores(year, args.pids) };
    case 'get_recipient_detail': {
      const key = typeof args.key === 'string' ? args.key.trim() : '';
      return { payload: key ? await executor.getRecipientDetail(year, key) : { error: 'key（支出先キー）を指定してください' } };
    }
    case 'get_subcontract_chain': {
      const pid = typeof args.pid === 'string' ? args.pid.trim() : '';
      return { payload: pid ? await executor.getSubcontractChain(year, pid) : { error: 'pid（事業ID）を指定してください' } };
    }
    case 'get_highlights':
      return { payload: await executor.getHighlights(year, args.metric) };
    case 'get_project_recipients': {
      const pid = typeof args.pid === 'string' ? args.pid.trim() : '';
      return { payload: pid ? await executor.getProjectRecipients(year, pid) : { error: 'pid（事業ID）を指定してください' } };
    }
    case 'search_funds': {
      const q = typeof args.q === 'string' ? args.q.trim() : '';
      const pid = typeof args.pid === 'string' && args.pid.trim() ? args.pid.trim() : null;
      if (!q && !pid) return { payload: { error: 'q（検索語）か pid（事業ID）のどちらかを指定してください' } };
      return { payload: await executor.searchFunds(q, pid) };
    }
    case 'get_fund': {
      const key = typeof args.key === 'string' ? args.key.trim() : '';
      return { payload: key ? await executor.getFund(key) : { error: 'key（基金のキー）を指定してください' } };
    }
    case 'get_vendor': {
      const q = typeof args.q === 'string' ? args.q.trim() : '';
      const key = typeof args.key === 'string' && args.key.trim() ? args.key.trim() : null;
      if (!q && !key) return { payload: { error: 'q（事業者名・法人番号）か key のどちらかを指定してください' } };
      return { payload: await executor.getVendor(q, key) };
    }
    case 'get_budget_request': {
      const pid = typeof args.pid === 'string' ? args.pid.trim() : '';
      return { payload: pid ? await executor.getBudgetRequest(pid) : { error: 'pid（事業ID）を指定してください' } };
    }
    case 'search_budget_requests': {
      const q = typeof args.q === 'string' ? args.q.trim().slice(0, 200) : '';
      const ministry = typeof args.ministry === 'string' ? args.ministry.trim().slice(0, 100) : '';
      return { payload: await executor.searchBudgetRequests(q, ministry) };
    }
    case 'search_tax_expenditures': {
      const q = typeof args.q === 'string' ? args.q.trim().slice(0, 200) : '';
      const year = args.year === undefined || args.year === '' ? TAX_EXPENDITURE_YEARS.at(-1)! : (TAX_EXPENDITURE_YEARS as readonly string[]).includes(String(args.year)) ? String(args.year) as TaxExpenditureYear : null;
      if (!year) return { payload: { error: `year は ${TAX_EXPENDITURE_YEARS.join(' / ')} のいずれかで指定してください` } };
      return { payload: await executor.searchTaxExpenditures(q, year) };
    }
    case 'estimate_tax_burden': {
      const parsed = parseTaxBurdenInput(args);
      if ('error' in parsed) return { payload: { error: parsed.error } };
      return { payload: await executor.estimateTaxBurden(parsed.input) };
    }
    case 'compare_years': {
      const baseYear = args.baseYear === '2024' || args.baseYear === '2025' ? args.baseYear : null;
      const compareYear = args.compareYear === '2024' || args.compareYear === '2025' ? args.compareYear : null;
      if (!baseYear || !compareYear) return { payload: { error: 'baseYear・compareYear には "2024" または "2025" を指定してください' } };
      return { payload: await executor.compareYears(args.query as SankeyQuery | undefined, baseYear, compareYear) };
    }
    default:
      return { payload: { error: `未知のツールです: ${name}` } };
  }
}

// ── エージェントループ本体 ──

export async function runSankeyChatAgentCore(
  chatMessages: SankeyChatMessage[],
  context: SankeyChatContext,
  callLlm: LlmCaller,
  executor: ChatToolExecutor,
  onProgress?: (ev: SankeyChatProgressEvent) => void,
): Promise<SankeyChatAgentResult> {
  const year: SupportedYear = context.year ?? SANKEY_QUERY_DEFAULTS.year;
  const ministryNames = await executor.getMinistryNames(year);

  const messages: LlmMessage[] = [
    { role: 'system', content: buildSystemPrompt(year, context.currentQuery, ministryNames, context.page, context.pageState) },
    ...chatMessages.map((m): LlmMessage => ({ role: m.role, content: m.content })),
  ];

  let toolCalls = 0;
  // 直前に結果（1件以上）が出た run_sankey_query。往復上限まで submit_result が呼ばれなくても、
  // 探索を繰り返すだけのモデルのために、この条件を適用して返す（「解釈できない」で終えない）
  let lastGood: SankeyChatResult | null = null;
  let nudged = false;
  for (let round = 0; round < MAX_LLM_ROUNDS; round++) {
    emitProgress(onProgress, { kind: 'llm_round', round: round + 1 });
    if (!nudged && round >= NUDGE_AFTER_ROUNDS && lastGood) {
      // ツール呼び出しを繰り返すモデルへの強い後押し。以降は確定かテキスト回答のみを求める
      messages.push({ role: 'system', content: 'これ以上の探索はしないでください。直前に結果が出た条件で submit_result を呼ぶか、条件化できない理由をテキストで短く答えてください。' });
      nudged = true;
    }
    const assistant = await callLlm(messages, TOOLS);
    messages.push(assistant);
    const calls = assistant.tool_calls ?? [];

    // ツールなしのテキスト応答 = 聞き返し or 解釈不能の返答として終了
    if (calls.length === 0) {
      const text = (assistant.content ?? '').trim();
      return { message: text || GIVE_UP_MESSAGE, toolCalls };
    }

    for (const call of calls) {
      toolCalls++;
      let payload: unknown;

      if (toolCalls > MAX_TOOL_CALLS) {
        payload = { error: 'ツール呼び出し回数の上限に達しました。これ以上の検証はできません。現時点で確定できないならテキストでその旨を返答してください' };
      } else {
        const { args, error } = parseToolArgs(call.function.arguments || '{}');
        if (error || !args) {
          payload = { error: error ?? 'ツール引数を解釈できませんでした' };
        } else if (call.function.name === 'navigate_page') {
          // ページ遷移。会話を終え、クライアントが href へ移動する。条件があれば検証して移動先に適用する
          const target = findNavTarget(args.page);
          if (!target) {
            payload = { error: `page は ${NAV_TARGET_KEYS.join(' / ')} のいずれかで指定してください` };
          } else {
            let result: SankeyChatResult | undefined;
            // サンキー条件を受け取れるのは事業一覧型のページだけ。補助ビューに query が付いてきても無視する（関係ない絞り込みを出さない）
            if (args.query && typeof args.query === 'object' && QUERY_NAV_TARGETS.includes(target.key)) {
              const executed = await executor.executeQuery(args.query as SankeyQuery, year);
              if (!executed.errors && executed.result) result = executed.result;
            }
            const destination = navTargetHref(target, args.params && typeof args.params === 'object' ? args.params as NavParams : undefined);
            const message = (typeof args.message === 'string' && args.message.trim() ? args.message.trim() : `${target.label}に移動します。`)
              + (destination.warnings.length ? `（受け付けなかった条件: ${destination.warnings.join('、')}）` : '');
            emitProgress(onProgress, buildToolProgressEvent('navigate_page', { page: target.key }));
            return { message, ...(result ? { result } : {}), navigate: { key: target.key, href: destination.href, label: target.label, ...(destination.scenario ? { scenario: destination.scenario } : {}) }, toolCalls };
          }
        } else if (call.function.name === 'submit_result') {
          // 確定はエージェントループ固有（会話を終える）。MCP など他の呼び出し元には公開しない
          const { errors, result } = await executor.executeQuery((args.query ?? {}) as SankeyQuery, year);
          if (errors) {
            payload = { errors, hint: 'クエリを修正して run_sankey_query で再検証してから submit_result してください' };
          } else {
            const message = typeof args.message === 'string' && args.message.trim()
              ? args.message.trim()
              : `${result!.summary.projects.count}事業がマッチしました。`;
            const interpretation = clampInterpretation(args.interpretation);
            const suggestions = clampSuggestions(args.suggestions);
            emitProgress(onProgress, buildToolProgressEvent('submit_result', { summary: result!.summary }));
            return {
              message,
              result: interpretation ? { ...result!, interpretation } : result!,
              ...(suggestions ? { suggestions } : {}),
              toolCalls,
            };
          }
        } else {
          const executed = await executeToolCall(call.function.name, args, executor, year);
          payload = executed.payload;
          if (executed.result) lastGood = executed.result;
        }
      }

      emitProgress(onProgress, buildToolProgressEvent(call.function.name, payload));
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(payload) });
    }
  }

  // 往復上限まで確定しなかった。結果のあった条件が一度でも出ていればそれを適用する（探索を繰り返すだけの
  // モデルへの安全網）。無ければユーザー決定事項により「解釈できなかった」旨の返信で終える
  if (lastGood) {
    return {
      message: `${lastGood.summary.projects.count}事業がマッチしました。AIが最終確定しなかったため、最後に結果のあった条件を適用しています。`,
      result: lastGood,
      toolCalls,
    };
  }
  return { message: GIVE_UP_MESSAGE, toolCalls };
}
