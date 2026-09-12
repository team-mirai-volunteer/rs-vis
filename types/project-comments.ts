/**
 * 事業コメント（AIインタビューで集めた匿名意見）の共有型。
 * API（app/api/projects/[pid]/comments）とクライアント（client/lib/comments）で使う。
 */

/** インタビュー1発言。LLM へ渡す履歴と、保存する transcript の両方でこの形 */
export interface InterviewTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 公開済み意見（一覧表示用。投稿者情報は一切含めない） */
export interface ProjectComment {
  id: string;
  body: string;
  createdAt: string;
}

/** GET /api/projects/[pid]/comments の応答 */
export interface ProjectCommentsResponse {
  comments: ProjectComment[];
  /** 公開済み件数（ページングに関係なく全件） */
  total: number;
  /** 次ページ取得用（この created_at より前を取る）。無ければ null */
  nextCursor: string | null;
}

/** POST /api/projects/[pid]/comments のリクエスト */
export interface PostProjectCommentRequest {
  year: string;
  /** 公開する意見本文（インタビューから整形・本人が確認済み） */
  body: string;
  /** インタビュー全文（非公開） */
  transcript: InterviewTurn[];
}

/** POST /api/projects/[pid]/comments の応答 */
export interface PostProjectCommentResponse {
  id: string;
  /** hidden = スクリーニングで保留（保存はされるが公開されない） */
  status: 'published' | 'hidden';
  /** hidden のときの理由（利用者向け文言） */
  reason?: string;
}

/** 意見本文の上限（DB の check 制約と一致させる） */
export const COMMENT_BODY_MAX_CHARS = 1000;
/** インタビューの最大ターン数（利用者の発言回数） */
export const INTERVIEW_MAX_USER_TURNS = 8;
/** インタビュー1発言の入力上限 */
export const INTERVIEW_INPUT_MAX_CHARS = 500;
/** 保存する transcript の上限（assistant 含む発言数） */
export const TRANSCRIPT_MAX_TURNS = INTERVIEW_MAX_USER_TURNS * 2 + 2;
/** レート制限: ip_hash あたりの投稿数 / 時 */
export const COMMENT_RATE_LIMIT_PER_HOUR = 5;
