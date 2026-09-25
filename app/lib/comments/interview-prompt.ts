/**
 * AIインタビューのプロンプト組み立て（Pure 層。React・HTTP・環境変数に依存しない）。
 *
 * 実行はBYOK（訪問者自身のキーでブラウザから OpenRouter を呼ぶ）のためクライアントから import される。
 * 「みらい議会ライク」の要点: 自由記入ではなく AI が意見を聞き 2〜3 回深掘りする／匿名／
 * 最後に本人が公開内容を確認する（設計: docs/tasks/20260828_1508）。
 */
import type { LlmMessage } from '@/app/lib/ai/chat-core';
import type { ProjectDetail } from '@/types/project-details';
import type { InterviewTurn } from '@/types/project-comments';
import { COMMENT_BODY_MAX_CHARS } from '@/types/project-comments';

/** インタビューのシステムプロンプトに注入する事業情報。数値は呼び出し側が分かる範囲で渡す */
export interface InterviewProjectContext {
  pid: string;
  year: string;
  projectName: string;
  ministry?: string;
  /** 事業概要等（/api/project-details）。無ければ名称だけで進める */
  detail?: ProjectDetail | null;
  /** 歳出予算現額（円） */
  budget?: number | null;
  /** 執行額（円） */
  execution?: number | null;
  /** 政策評価の総合点（0-100） */
  score?: number | null;
  /** 支出先上位（名称と金額）。あれば具体的な問いに使う */
  topRecipients?: { name: string; amount: number }[];
}

/** インタビュー開始のための隠しユーザー発話（画面には表示しない） */
export const INTERVIEW_KICKOFF_TEXT = '（インタビューを開始してください）';

/**
 * 冒頭の問いかけ（ルールベース）。「意見を伝える」を押すたびに LLM を呼ばないよう定型文にする。
 * 内容はシステムプロンプトの進め方（意見を聞かせてほしい旨＋率直な印象か気になる点を1つ尋ねる）と揃える。
 */
export function buildOpeningQuestion(ctx: Pick<InterviewProjectContext, 'projectName'>): string {
  return `「${ctx.projectName}」について、ご意見を聞かせてください。まずは率直な印象や、目的・金額・支出先・成果などで気になる点を1つ教えてください。`;
}

function yen(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}兆円`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}億円`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}万円`;
  return `${n.toLocaleString()}円`;
}

function clip(text: string | undefined | null, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 事業情報を LLM 向けの箇条書きにする */
export function describeProject(ctx: InterviewProjectContext): string {
  const lines: string[] = [];
  lines.push(`- 事業名: ${ctx.projectName}（事業ID ${ctx.pid}、${ctx.year}年度データ）`);
  const ministry = ctx.ministry ?? ctx.detail?.ministry;
  if (ministry) lines.push(`- 府省庁: ${ministry}${ctx.detail?.bureau ? ` / ${ctx.detail.bureau}` : ''}`);
  if (ctx.budget != null) lines.push(`- 歳出予算現額: ${yen(ctx.budget)}`);
  if (ctx.execution != null) lines.push(`- 執行額: ${yen(ctx.execution)}`);
  if (ctx.score != null) lines.push(`- 政策評価の総合点: ${ctx.score}/100（AIによる報告書の形式品質評価。事業の良し悪しそのものではない）`);
  const d = ctx.detail;
  if (d) {
    if (d.category) lines.push(`- 事業区分: ${d.category}${d.startYear ? `（${d.startYear}年度開始）` : ''}`);
    if (d.implementationMethods?.length) lines.push(`- 実施方法: ${d.implementationMethods.join('・')}`);
    if (d.purpose) lines.push(`- 目的: ${clip(d.purpose, 400)}`);
    if (d.currentIssues) lines.push(`- 現状・課題: ${clip(d.currentIssues, 400)}`);
    if (d.overview) lines.push(`- 概要: ${clip(d.overview, 600)}`);
  }
  if (ctx.topRecipients?.length) {
    lines.push(`- 主な支出先: ${ctx.topRecipients.slice(0, 5).map(r => `${r.name}（${yen(r.amount)}）`).join('、')}`);
  }
  return lines.join('\n');
}

/** インタビュー用システムプロンプト */
export function buildInterviewSystemPrompt(ctx: InterviewProjectContext): string {
  return [
    'あなたは日本の国の予算事業について、市民の意見を丁寧に聞き取るインタビュアーです。',
    '対象の事業は次のとおりです。',
    '',
    describeProject(ctx),
    '',
    '## 進め方',
    '- 冒頭の問いかけ（意見を聞かせてほしい旨と、率直な印象や気になる点を1つ尋ねる質問）は定型文で送信済みです。相手の最初の返答を受け止めるところから始め、同じ問いかけを繰り返さないこと。事業の説明を長々と繰り返さないこと。',
    '- 相手の発言を受けて、「なぜそう思うか」「どの部分（目的・金額・支出先・成果など）が気になるか」「どうなればよいと考えるか」を1回に1つずつ、合計2〜3回深掘りしてください。',
    '- 質問は短く（2〜3文以内）。相手の言葉を1文で受け止めてから次の質問をしてください。',
    '- 事業データに基づく事実の補足は1〜2文まで。評価や誘導はせず、賛成・反対どちらの意見も同じ態度で聞くこと。',
    '- 2〜3回の深掘りが済み論点が見えたら、「ここまでの内容を意見としてまとめられます。画面下の『意見をまとめる』を押してください」と案内し、それ以上質問を重ねないでください。',
    '- 個人が特定される情報（氏名・所属・連絡先）は聞かないこと。相手が書いた場合は、公開文には含めないと伝えてください。',
    '- 意見と無関係な依頼（一般的な質問・雑談・コード生成など）には応じず、事業への意見に話を戻してください。',
    '- Markdown の見出しや箇条書きは使わず、話し言葉の平文で答えてください。',
  ].join('\n');
}

/** 公開文への整形指示（最終ステップ）。JSON だけを返させる */
export function buildSummarizeSystemPrompt(ctx: InterviewProjectContext): string {
  return [
    'あなたは市民インタビューの記録を、公開用の意見文に整形する編集者です。',
    `対象事業: ${ctx.projectName}（事業ID ${ctx.pid}）`,
    '',
    '## 整形ルール',
    '- 相手（user）の発言内容だけを材料にし、インタビュアーの発言や、相手が言っていない主張・数値を加えないこと。',
    '- 一人称の「私は」で始まる自然な日本語の意見文にする。結論（賛成・反対・改善要望など）→ 理由 → こうしてほしい、の順。',
    `- 全体で${Math.floor(COMMENT_BODY_MAX_CHARS * 0.6)}字以内、通常は150〜400字。Markdown・見出し・箇条書きは使わない。`,
    '- 氏名・所属・連絡先・URL など個人や第三者を特定できる情報は必ず削除する。',
    '- 特定の個人への誹謗中傷・差別表現は、内容を保ったまま事業や制度への意見に言い換える。',
    '',
    '## 出力形式',
    '次の JSON オブジェクトのみを出力する（前後に説明文やコードフェンスを付けない）:',
    '{"body": "意見文", "stance": "賛成|反対|改善要望|疑問|その他"}',
  ].join('\n');
}

/**
 * インタビュー用の LLM メッセージ列を組み立てる（先頭に system、続けて履歴）。
 * 履歴が定型の問いかけ（assistant）から始まる場合も、system の直後を user にするため
 * 隠しの開始発話を補う（system → assistant の並びを受け付けないモデルがある）。
 */
export function buildInterviewMessages(ctx: InterviewProjectContext, turns: InterviewTurn[]): LlmMessage[] {
  const history: LlmMessage[] = turns.map(t => ({ role: t.role, content: t.content }));
  if (history.length === 0 || history[0].role !== 'user') history.unshift({ role: 'user', content: INTERVIEW_KICKOFF_TEXT });
  return [{ role: 'system', content: buildInterviewSystemPrompt(ctx) }, ...history];
}

/** 整形用の LLM メッセージ列 */
export function buildSummarizeMessages(ctx: InterviewProjectContext, turns: InterviewTurn[]): LlmMessage[] {
  const transcript = turns
    .map(t => `${t.role === 'user' ? '相手' : 'インタビュアー'}: ${t.content}`)
    .join('\n');
  return [
    { role: 'system', content: buildSummarizeSystemPrompt(ctx) },
    { role: 'user', content: `以下のインタビュー記録を整形してください。\n\n${transcript}` },
  ];
}

export interface SummarizedOpinion {
  body: string;
  stance: string | null;
}

/** 整形応答（JSON のはず）を安全に読む。JSON でなければ本文として丸ごと扱う */
export function parseSummarizedOpinion(raw: string | null | undefined): SummarizedOpinion {
  const text = (raw ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const obj = JSON.parse(text) as { body?: unknown; stance?: unknown };
    if (typeof obj.body === 'string' && obj.body.trim()) {
      return {
        body: obj.body.trim().slice(0, COMMENT_BODY_MAX_CHARS),
        stance: typeof obj.stance === 'string' ? obj.stance : null,
      };
    }
  } catch {
    // JSON でない応答はそのまま本文にする
  }
  return { body: text.slice(0, COMMENT_BODY_MAX_CHARS), stance: null };
}
