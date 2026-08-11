#!/usr/bin/env node
/**
 * AIチャット（POST /api/ai/sankey-chat）の応答品質を反復評価するための開発用ハーネス。
 *
 * scripts/dev/ai-chat-eval-prompts.json の代表シナリオを順に投げ、
 * message / result有無 / toolCalls / レイテンシを記録して markdown テーブルで出力する。
 *
 * Usage:
 *   npm run dev  # 別ターミナルで localhost:3000 を起動しておく（OPENROUTER_API_KEY 必須）
 *   node scripts/dev/ai-chat-eval.mjs [--only <id>] [--out <path>] [--pace <ms>] [--stream]
 *   BASE_URL=http://localhost:3001 node scripts/dev/ai-chat-eval.mjs
 *
 * --stream: stream:true で送信し、progress イベント列（llm_round/tool/retry）を
 *   stderr に逐次出力する。最終結果は従来どおり markdown テーブルの行に載る
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { only: null, out: null, paceMs: 0, stream: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') args.only = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    // 無料枠のRPM制限対策: 各ターン送信後の待機ms（例: Gemini free tier は --pace 25000 目安）
    else if (argv[i] === '--pace') args.paceMs = Number(argv[++i]) || 0;
    // stream:true で送信し、progress イベント列を stderr に逐次出力する（回帰確認用）
    else if (argv[i] === '--stream') args.stream = true;
  }
  return args;
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? `${oneLine.slice(0, n)}…` : oneLine;
}

function escapeCell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * SSE本文（event:/data: 行）を読み進め、progress イベントを stderr に逐次出力し、
 * result/error イベントを従来のJSON応答と同じ形（message/result/usage or error）に正規化して返す。
 */
async function consumeSseBody(bodyStream, label) {
  const reader = bodyStream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let settled = null;
  while (!settled) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIndex;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      let eventName = 'message';
      let dataLine = '';
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith(':')) continue; // ping コメント行
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      let parsed;
      try {
        parsed = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (eventName === 'progress') {
        console.error(`[ai-chat-eval] ${label} progress: ${JSON.stringify(parsed)}`);
      } else if (eventName === 'result') {
        console.error(`[ai-chat-eval] ${label} result received`);
        settled = parsed;
      } else if (eventName === 'error') {
        console.error(`[ai-chat-eval] ${label} error: ${JSON.stringify(parsed)}`);
        // message は設定しない: JSONエラー経路と同様、エラーを assistant 発話として履歴に積まない
        settled = { error: parsed?.error };
      }
    }
  }
  return settled;
}

async function runScenario(baseUrl, scenario, paceMs, stream) {
  const history = [];
  const rows = [];
  for (let turnIndex = 0; turnIndex < scenario.turns.length; turnIndex++) {
    const userText = scenario.turns[turnIndex];
    history.push({ role: 'user', content: userText });

    const started = Date.now();
    let status = null;
    let body = null;
    let errorText = null;
    try {
      const res = await fetch(`${baseUrl}/api/ai/sankey-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, ...(stream ? { stream: true } : {}) }),
      });
      status = res.status;
      const contentType = res.headers.get('content-type') || '';
      if (stream && contentType.includes('text/event-stream') && res.body) {
        body = await consumeSseBody(res.body, `${scenario.id}#${turnIndex + 1}`);
        if (body === null) errorText = 'ストリームが result/error を送らずに終了しました';
        else if (body.error) errorText = body.error;
      } else {
        const text = await res.text();
        try {
          body = JSON.parse(text);
        } catch {
          errorText = text.slice(0, 300);
        }
      }
    } catch (e) {
      errorText = e instanceof Error ? e.message : String(e);
    }
    const latencyMs = Date.now() - started;

    if (status === 404) {
      throw new Error(
        'API が 404 を返しました（AIチャットが無効な環境の可能性）。' +
          '.env.local の OPENROUTER_API_KEY と SANKEY_AI_CHAT_ENABLED を確認してください。',
      );
    }

    const message = body?.message ?? errorText ?? '(応答なし)';
    const hasResult = Boolean(body?.result);
    const projectCount = body?.result?.summary?.projects?.count;
    const toolCalls = body?.usage?.toolCalls ?? '-';
    const model = body?.usage?.model ?? '-';
    const suggestionCount = Array.isArray(body?.suggestions) ? body.suggestions.length : 0;

    rows.push({
      id: scenario.id,
      model,
      turn: turnIndex + 1,
      userText: truncate(userText, 60),
      message: truncate(message, 200),
      hasResult,
      projectCount: hasResult && typeof projectCount === 'number' ? projectCount : '-',
      toolCalls,
      suggestionCount,
      latencyMs,
      status: status ?? 'ERR',
    });

    if (body?.message) {
      history.push({ role: 'assistant', content: body.message });
    } else {
      // これ以降のターンを送っても意味が薄いので打ち切る
      break;
    }
    if (paceMs > 0) await sleep(paceMs);
  }
  return rows;
}

function toMarkdownTable(rows) {
  const header = '| id | model | turn | user | result | count | toolCalls | sugg | ms | status | message |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) =>
    `| ${escapeCell(r.id)} | ${escapeCell(r.model)} | ${r.turn} | ${escapeCell(r.userText)} | ${r.hasResult ? 'yes' : 'no'} | ${r.projectCount} | ${r.toolCalls} | ${r.suggestionCount} | ${r.latencyMs} | ${r.status} | ${escapeCell(r.message)} |`,
  );
  return [header, sep, ...body].join('\n');
}

async function main() {
  const { only, out, paceMs, stream } = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const promptsPath = path.join(__dirname, 'ai-chat-eval-prompts.json');
  const scenarios = JSON.parse(readFileSync(promptsPath, 'utf-8'));
  const targets = only ? scenarios.filter((s) => s.id === only) : scenarios;

  if (targets.length === 0) {
    console.error(`シナリオが見つかりません: --only ${only}`);
    process.exit(1);
  }

  console.error(`[ai-chat-eval] ${targets.length}件のシナリオを ${baseUrl} に送信します${stream ? '（stream:true）' : ''}...`);

  const allRows = [];
  for (const scenario of targets) {
    try {
      const rows = await runScenario(baseUrl, scenario, paceMs, stream);
      allRows.push(...rows);
    } catch (e) {
      console.error(`[ai-chat-eval] シナリオ "${scenario.id}" でエラー: ${e.message}`);
      process.exit(1);
    }
  }

  const table = toMarkdownTable(allRows);
  console.log(table);

  if (out) {
    writeFileSync(out, `${table}\n`, 'utf-8');
    console.error(`[ai-chat-eval] 結果を書き込みました: ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
