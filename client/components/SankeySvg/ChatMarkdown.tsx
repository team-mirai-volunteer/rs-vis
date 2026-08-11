'use client';

/**
 * AIチャットの assistant 応答を Markdown として描画する（表・強調・リスト対応）。
 *
 * react-markdown は生 HTML を描画しないため、LLM 出力をそのまま渡しても XSS の懸念がない。
 * AiChatPanel から React.lazy で遅延ロードされる（react-markdown + remark-gfm を
 * ページ初期バンドルに含めないため、このファイルは AiChatPanel から直接 import しない）。
 * スタイルは chat-markdown-styles.ts（依存なし）にあり、パネル側で1回だけ描画される。
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="ai-chat-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 外部リンクは新規タブで開く（チャット状態を保持したまま参照できるように）
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          // 表はパネル幅を超えることがあるため横スクロールで収める
          table: ({ children }) => (
            <div className="ai-chat-md-table-wrap"><table>{children}</table></div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
