/**
 * サンキー AI 絞り込みエージェントのモデル比較（開発用）。
 *
 * 同じ質問を複数のモデル／reasoning effort で実行し、成否・往復数・ツール回数・秒数・実トークン・推定コストを表にする。
 * 単価は OpenRouter の /models から取得する。既定モデル選定の根拠は docs/tasks/20260916_1026_*.md。
 *
 *   OPENROUTER_API_KEY=... npx tsx scripts/ai-model-bench.ts google/gemini-3.5-flash-lite:low openai/gpt-5.4-nano:low
 *   （引数省略時は既定モデルと gpt-5.4-nano を low で比較。effort は low|medium|high|none）
 *
 * データパイプライン層ではなく開発ツール。UI・API ロジックは含めない。従量課金の呼び出しを行うので手動実行のみ。
 */
import { runSankeyChatAgent } from '@/app/lib/ai/sankey-chat-agent';
import type { LlmCaller, LlmMessage } from '@/app/lib/ai/chat-core';
import { DEFAULT_SERVER_MODEL } from '@/app/api/ai/_lib/server-llm';

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY を設定してください'); process.exit(1); }
const PROMPTS = (process.env.BENCH_PROMPTS?.split('|').map(s => s.trim()).filter(Boolean)) ?? [
  '再エネ関連で予算100億円以上の事業', '経済産業省の事業だけ見たい', 'NTTデータが受注している事業',
];
type Effort = 'low' | 'medium' | 'high' | 'none';
const specs = (process.argv.slice(2).length ? process.argv.slice(2) : [`${DEFAULT_SERVER_MODEL}:low`, 'openai/gpt-5.4-nano:low'])
  .map(spec => { const i = spec.lastIndexOf(':'); return i > 0 && ['low', 'medium', 'high', 'none'].includes(spec.slice(i + 1)) ? { model: spec.slice(0, i), effort: spec.slice(i + 1) as Effort } : { model: spec, effort: 'low' as Effort }; });

async function prices(): Promise<Record<string, { p: number; c: number }>> {
  const res = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${KEY}` } });
  const data = await res.json() as { data: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
  return Object.fromEntries(data.data.map(m => [m.id, { p: Number(m.pricing?.prompt ?? 0) * 1e6, c: Number(m.pricing?.completion ?? 0) * 1e6 }]));
}

function caller(model: string, effort: Effort, acc: { prompt: number; completion: number; reasoning: number; rounds: number }): LlmCaller {
  return async (messages, tools) => {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.2, ...(effort !== 'none' ? { reasoning: { effort } } : {}) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as { choices?: { message?: LlmMessage }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } };
    acc.rounds++; acc.prompt += data.usage?.prompt_tokens ?? 0; acc.completion += data.usage?.completion_tokens ?? 0; acc.reasoning += data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const m = data.choices?.[0]?.message;
    if (!m) throw new Error('応答に choices[0].message がありません');
    return m;
  };
}

async function main() {
  const price = await prices();
  console.log('model:effort | prompt | outcome | rounds/tools | seconds | tokens in/out(reasoning) | est. cost');
  for (const { model, effort } of specs) {
    const unit = price[model] ?? { p: 0, c: 0 };
    let total = 0;
    for (const prompt of PROMPTS) {
      const acc = { prompt: 0, completion: 0, reasoning: 0, rounds: 0 };
      const t0 = Date.now();
      let outcome = 'text', tools = 0;
      try {
        const r = await runSankeyChatAgent([{ role: 'user', content: prompt }], { year: '2025' }, caller(model, effort, acc));
        outcome = r.result ? `RESULT ${r.result.summary.projects.count}件` : 'text'; tools = r.toolCalls;
      } catch (e) { outcome = `ERROR ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`; }
      const cost = (acc.prompt * unit.p + acc.completion * unit.c) / 1e6; total += cost;
      console.log(`${model}:${effort} | ${prompt} | ${outcome} | ${acc.rounds}/${tools} | ${((Date.now() - t0) / 1000).toFixed(1)}s | ${acc.prompt}/${acc.completion}(${acc.reasoning}) | $${cost.toFixed(4)}`);
    }
    console.log(`${model}:${effort} | TOTAL | $${total.toFixed(4)} (unit in $${unit.p}/M, out $${unit.c}/M)`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
