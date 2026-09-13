/**
 * ChatMarkdown 用のスタイル文字列。
 *
 * ChatMarkdown.tsx ではなくこのファイルに置く理由: <style> はメッセージごとではなく
 * パネルで1回だけ描画したいが、AiChatPanel が ChatMarkdown.tsx から import すると
 * react-markdown ごと初期バンドルに入ってしまう（チャンク分離が壊れる）ため、
 * 依存のない文字列だけを分離している。
 *
 * 色は app/globals.css のデザインシステム CSS 変数を参照する（hex 直書きしない）。
 */

/** チャット吹き出し（fontSize 13 基調）に合わせたコンパクトな Markdown スタイル */
export const CHAT_MARKDOWN_STYLES = `
.ai-chat-md > :first-child { margin-top: 0; }
.ai-chat-md > :last-child { margin-bottom: 0; }
.ai-chat-md p { margin: 0 0 6px; }
.ai-chat-md h1, .ai-chat-md h2, .ai-chat-md h3, .ai-chat-md h4 {
  font-size: 13px; font-weight: 700; margin: 10px 0 4px; line-height: 1.5;
}
.ai-chat-md ul, .ai-chat-md ol { margin: 0 0 6px; padding-left: 18px; }
.ai-chat-md li { margin: 2px 0; }
.ai-chat-md a { color: var(--primary); text-underline-offset: 4px; }
.ai-chat-md a:hover { color: var(--primary-accent); }
.ai-chat-md code {
  font-size: 12px; background: var(--mirai-surface-light); border-radius: 3px; padding: 1px 4px;
}
.ai-chat-md pre { margin: 0 0 6px; overflow-x: auto; }
.ai-chat-md pre code { display: block; padding: 6px 8px; }
.ai-chat-md blockquote {
  margin: 0 0 6px; padding: 2px 0 2px 8px; border-left: 3px solid var(--mirai-border); color: var(--mirai-text-subtle);
}
.ai-chat-md hr { border: none; border-top: 1px solid var(--mirai-border); margin: 8px 0; }
.ai-chat-md .ai-chat-md-table-wrap { overflow-x: auto; margin: 0 0 6px; }
.ai-chat-md table { border-collapse: collapse; font-size: 11.5px; }
.ai-chat-md th, .ai-chat-md td {
  border: 1px solid var(--border); padding: 3px 7px; text-align: left; white-space: nowrap;
}
.ai-chat-md th { background: var(--mirai-surface); font-weight: 700; color: var(--mirai-text-subtle); }
`;
