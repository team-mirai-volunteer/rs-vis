/**
 * MCP サーバーのツールカタログと、チャットと共通のツール実行（executeToolCall）の検証。
 * サーバー実装（ローダ）は使わず、ChatToolExecutor のスタブで引数検証と委譲先だけを確かめる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCP_TOOLS, MCP_INSTRUCTIONS, resolveToolYear } from '../app/lib/ai/mcp-tools';
import { DATA_TOOL_NAMES, TOOLS, executeToolCall, type ChatToolExecutor } from '../app/lib/ai/chat-core';

function stubExecutor(): { executor: ChatToolExecutor; calls: string[] } {
  const calls: string[] = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push(`${name}:${JSON.stringify(args)}`); return { ok: name }; };
  const executor: ChatToolExecutor = {
    getMinistryNames: () => [],
    executeQuery: (input, year) => {
      calls.push(`executeQuery:${JSON.stringify([input, year])}`);
      return { result: { query: { year } as never, summary: { projects: { count: 2 } } as never } } as never;
    },
    searchProjects: record('searchProjects'),
    searchRecipients: record('searchRecipients'),
    searchSpending: record('searchSpending'),
    getProjectDetail: record('getProjectDetail'),
    getQualityScores: record('getQualityScores'),
    getRecipientDetail: record('getRecipientDetail'),
    getSubcontractChain: record('getSubcontractChain'),
    getHighlights: record('getHighlights'),
    compareYears: record('compareYears'),
    getProjectRecipients: record('getProjectRecipients'),
    searchFunds: record('searchFunds'),
    getFund: record('getFund'),
    getVendor: record('getVendor'),
    getBudgetRequest: record('getBudgetRequest'),
  };
  return { executor, calls };
}

test('MCP のカタログはチャットのツールから submit_result を除き、全ツールに year を足したもの', () => {
  const names = MCP_TOOLS.map(t => t.name);
  assert.deepEqual(names, DATA_TOOL_NAMES);
  assert.ok(!names.includes('submit_result'));
  assert.equal(names.length, TOOLS.length - 2, 'submit_result と navigate_page は MCP に出さない');
  assert.ok(!names.includes('navigate_page'));
  for (const tool of MCP_TOOLS) {
    const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
    assert.deepEqual(props.year.enum, ['2024', '2025'], `${tool.name} に year が無い`);
    assert.ok(tool.description.length > 0);
  }
  // 元の定義を書き換えていない（チャット側には year が増えない）
  const original = TOOLS.find(t => t.function.name === 'search_projects')!;
  assert.ok(!('year' in (original.function.parameters.properties as Record<string, unknown>)));
});

test('instructions にデータの約束事（1円単位・その他・シート年度・AI評価・出典）が入っている', () => {
  for (const must of ['1 円単位', 'その他の支出先', 'シート年度', '公式評価ではありません', '出典']) {
    assert.ok(MCP_INSTRUCTIONS.includes(must), `instructions に「${must}」が無い`);
  }
});

test('resolveToolYear: 省略は既定年度、対応年度はそのまま、それ以外はエラー', () => {
  assert.deepEqual(resolveToolYear({}), { year: '2024' });
  assert.deepEqual(resolveToolYear({ year: '' }), { year: '2024' });
  assert.deepEqual(resolveToolYear({ year: '2025' }), { year: '2025' });
  assert.ok('error' in resolveToolYear({ year: '2023' }));
  assert.ok('error' in resolveToolYear({ year: 2025 }));
});

test('executeToolCall: 必須引数の検証と委譲先', async () => {
  const { executor, calls } = stubExecutor();
  assert.deepEqual((await executeToolCall('search_projects', {}, executor, '2025')).payload, { error: 'q（検索キーワード）を指定してください' });
  assert.deepEqual((await executeToolCall('search_spending', { q: 'a' }, executor, '2025')).payload, { error: 'search_spending の q は2文字以上で指定してください' });
  assert.deepEqual((await executeToolCall('get_project_detail', { pid: ' ' }, executor, '2025')).payload, { error: 'pid（事業ID）を指定してください' });
  assert.ok('error' in ((await executeToolCall('compare_years', { baseYear: '2023', compareYear: '2025' }, executor, '2025')).payload as object));
  assert.deepEqual((await executeToolCall('no_such_tool', {}, executor, '2025')).payload, { error: '未知のツールです: no_such_tool' });
  assert.equal(calls.length, 0, '検証で弾いたときは実行層を呼ばない');

  await executeToolCall('search_projects', { q: ' 子育て ', scope: 'details' }, executor, '2025');
  await executeToolCall('get_subcontract_chain', { pid: '6498' }, executor, '2024');
  await executeToolCall('compare_years', { baseYear: '2024', compareYear: '2025' }, executor, '2025');
  assert.deepEqual(calls, [
    'searchProjects:["2025","子育て","details"]',
    'getSubcontractChain:["2024","6498"]',
    'compareYears:[null,"2024","2025"]',
  ]);
});

test('executeToolCall: 段階 C のツール（支出先・基金・事業者・概算要求）の引数検証と委譲先', async () => {
  const { executor, calls } = stubExecutor();
  assert.ok('error' in ((await executeToolCall('get_project_recipients', {}, executor, '2025')).payload as object));
  assert.ok('error' in ((await executeToolCall('search_funds', {}, executor, '2025')).payload as object), 'q も pid も無ければエラー');
  assert.ok('error' in ((await executeToolCall('get_fund', { key: '' }, executor, '2025')).payload as object));
  assert.ok('error' in ((await executeToolCall('get_vendor', {}, executor, '2025')).payload as object), 'q も key も無ければエラー');
  assert.ok('error' in ((await executeToolCall('get_budget_request', {}, executor, '2025')).payload as object));
  assert.equal(calls.length, 0);

  await executeToolCall('get_project_recipients', { pid: ' 6498 ' }, executor, '2025');
  await executeToolCall('search_funds', { pid: '100' }, executor, '2025');
  await executeToolCall('search_funds', { q: '蓄電池' }, executor, '2025');
  await executeToolCall('get_fund', { key: 'lineage-1' }, executor, '2025');
  await executeToolCall('get_vendor', { q: 'NTT' }, executor, '2025');
  await executeToolCall('get_vendor', { key: '1010001000001' }, executor, '2025');
  await executeToolCall('get_budget_request', { pid: '1' }, executor, '2025');
  assert.deepEqual(calls, [
    'getProjectRecipients:["2025","6498"]',
    'searchFunds:["","100"]',
    'searchFunds:["蓄電池",null]',
    'getFund:["lineage-1"]',
    'getVendor:["NTT",null]',
    'getVendor:["","1010001000001"]',
    'getBudgetRequest:["1"]',
  ]);
  // MCP のカタログにも載る（submit_result 以外）
  for (const name of ['get_project_recipients', 'search_funds', 'get_fund', 'get_vendor', 'get_budget_request']) {
    assert.ok(MCP_TOOLS.some(t => t.name === name), `${name} が MCP カタログに無い`);
  }
});

test('executeToolCall: run_sankey_query は 1 件以上マッチしたとき result（確定候補）を返す', async () => {
  const { executor, calls } = stubExecutor();
  const r = await executeToolCall('run_sankey_query', { query: { projectNameRegex: '子育て' } }, executor, '2025');
  assert.ok(r.result, 'result が無い');
  assert.equal(calls[0], 'executeQuery:[{"projectNameRegex":"子育て"},"2025"]');
  const payload = r.payload as { hint: string };
  assert.ok(payload.hint.includes('submit_result'));
});
