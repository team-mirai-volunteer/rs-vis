import type { Metadata } from 'next';
import Link from 'next/link';
import { PRODUCT_NAME } from '@/components/navigation/pages';
import { SITE_URL } from '@/app/lib/site-url';
import { ExternalLink, LegalDocument, LegalSection } from '@/components/legal/LegalDocument';
import { LEGAL_UPDATED } from '@/app/lib/legal';

export const metadata: Metadata = {
  title: `プライバシーポリシー｜${PRODUCT_NAME}`,
  description: `チームみらいが運営する「${PRODUCT_NAME}」（${SITE_URL}）における個人情報・利用情報の取り扱い。`,
  alternates: { canonical: new URL('/privacy', SITE_URL).href },
};

/**
 * プライバシーポリシー。まるみえ・みらい議会のポリシーをもとに、このサイトが実際に扱う情報
 * （意見投稿の本文と IP アドレスのハッシュ、AI 機能の入力の送り先、ブラウザ内の保存）に限って書く。
 * 実装と食い違わないよう、取り扱いを変えるときは本文も更新する
 * （根拠: app/api/projects/[pid]/comments, app/api/ai, client/lib/ai/api-key-store.ts）。
 */
export default function PrivacyPage() {
  return (
    <LegalDocument
      title="プライバシーポリシー"
      updated={LEGAL_UPDATED}
      lead={<p>チームみらい（以下「当団体」）は、運営するウェブサイト「{PRODUCT_NAME}」（{SITE_URL}。以下「本サービス」）における個人情報およびその他の利用情報を、次のとおり取り扱います。</p>}
    >
      <LegalSection id="definition" heading="1. 個人情報の定義">
        <p>本ポリシーで「個人情報」とは、個人情報の保護に関する法律に定める個人情報をいい、氏名、住所、電話番号、メールアドレスなど特定の個人を識別できる情報、および他の情報と容易に照合することで特定の個人を識別できる情報を含みます。</p>
      </LegalSection>

      <LegalSection id="collected" heading="2. 取得する情報">
        <p>本サービスは会員登録を求めず、氏名やメールアドレスの入力欄も設けていません。取得する情報は次のとおりです。</p>
        <ul>
          <li><strong>意見の投稿内容。</strong>事業への意見を投稿する際、ユーザーが確認した意見文（1,000 字以内）、対象の事業 ID と年度、投稿日時を保存します。投稿に先立つ AI との対話の全文は、投稿条件の確認にのみ使い、保存しません。</li>
          <li><strong>IP アドレスのハッシュ。</strong>短時間の大量投稿や荒らしを防ぐため、投稿時の IP アドレスを当団体が管理する秘密の値（ソルト）とともにハッシュ化した値を、投稿と結びつけて保存します。元の IP アドレスそのものは保存しません。</li>
          <li><strong>AI 機能への入力。</strong>AI による絞り込み・対話・意見の整形に入力した文章は、後述の送り先で処理されます。当団体は本番環境でこれらの入力を保存しません。</li>
          <li><strong>アクセス情報。</strong>本サービスのホスティング事業者（Vercel Inc.）は、障害対応やセキュリティのために、IP アドレス、ブラウザの種類、アクセス日時、閲覧した URL などをアクセスログとして一時的に記録します。当団体はこれを個人を特定する目的で利用しません。</li>
          <li><strong>お問い合わせ。</strong>メールでお問い合わせいただいた場合、メールアドレスと内容を、回答と記録のために保存します。</li>
        </ul>
      </LegalSection>

      <LegalSection id="purpose" heading="3. 利用目的">
        <ul>
          <li>本サービスの提供、運営、維持、改善</li>
          <li>投稿された意見の公開、集計・分析、および政策の検討への活用</li>
          <li>不正利用、過度なアクセス、本規約に反する投稿への対応</li>
          <li>お問い合わせへの回答</li>
          <li>法令に基づく対応</li>
        </ul>
      </LegalSection>

      <LegalSection id="ai" heading="4. AI 機能における情報の送り先">
        <ol>
          <li><strong>自分の API キーで利用する場合（BYOK）。</strong>登録した OpenRouter の API キーとモデル名は、ユーザーのブラウザ内（IndexedDB）にのみ保存され、当団体のサーバーには送信されません。入力した文章と、画面に表示している事業名などの文脈は、ブラウザから直接 OpenRouter および選択したモデルの提供元に送られます。これらの事業者における取り扱いは、<ExternalLink href="https://openrouter.ai/privacy">OpenRouter のプライバシーポリシー</ExternalLink>および各モデル提供元の条件に従います。キーと設定は画面の「保存済みの設定を削除」でいつでも消せます。</li>
          <li><strong>サイト提供の AI で利用する場合。</strong>キーを登録していない環境でサイト提供の AI が有効なときは、入力した文章と文脈が当団体のサーバーを経由して OpenRouter に送られます。当団体のサーバーは応答を返すためにのみ内容を扱い、本番環境では保存しません。利用中の方式は画面に表示します。</li>
          <li>AI に送る文章には、自分や他人の個人情報を入力しないでください。</li>
        </ol>
      </LegalSection>

      <LegalSection id="third-party" heading="5. 第三者への提供と委託">
        <ol>
          <li>当団体は、次の場合を除き、取得した個人情報を第三者に提供しません。
            <ul>
              <li>本人の同意がある場合</li>
              <li>個人を識別できない統計情報や集計結果として公表する場合</li>
              <li>法令に基づく場合、または裁判所・警察などの公的機関から正当な手続きにより開示を求められた場合</li>
              <li>不正アクセスや本規約違反への対応のために必要な場合</li>
            </ul>
          </li>
          <li>当団体は、本サービスの運営のために次の事業者にデータの保管・処理を委託しています。
            <ul>
              <li>Vercel Inc.（ホスティング・配信。アクセスログを含む）</li>
              <li>Supabase, Inc.（意見投稿と IP アドレスのハッシュを保存するデータベース。東京リージョン）</li>
              <li>OpenRouter, Inc. およびそれを通じて利用するモデル提供元（AI 機能。前項のとおり、サイト提供の AI の場合のみ当団体を経由）</li>
            </ul>
          </li>
          <li>投稿された意見は、匿名で本サービス上に公開されるほか、個人を識別できない形で集計し、報告書などで公表することがあります。</li>
        </ol>
      </LegalSection>

      <LegalSection id="browser" heading="6. Cookie とブラウザ内の保存">
        <ol>
          <li>本サービスは、現時点でアクセス解析のための Cookie や外部の計測ツール（Google Analytics など）を使用していません。導入する場合は本ポリシーを更新して明示します。</li>
          <li>表示の設定（選択した年度など）や AI 機能の設定は、ユーザーのブラウザ内（localStorage・IndexedDB）に保存します。これらは当団体のサーバーには送信されず、ブラウザの設定から削除できます。</li>
          <li>ホスティング事業者が配信の最適化や不正対策のために技術的な Cookie を用いることがあります。</li>
        </ol>
      </LegalSection>

      <LegalSection id="security" heading="7. 安全管理">
        <p>当団体は、取得した情報への不正アクセス、漏えい、改ざんを防ぐため、通信の暗号化（HTTPS）、データベースへのアクセス権限の制限、投稿前の機械的なチェックなどの措置を講じます。</p>
      </LegalSection>

      <LegalSection id="retention" heading="8. 保管期間と削除">
        <ol>
          <li>意見の投稿内容は、本サービスの運営に必要な期間保存します。投稿した本人が削除を希望する場合は、第10項の連絡先までお知らせください。匿名投稿のため、投稿日時や内容を伺って本人を確認します。</li>
          <li>IP アドレスのハッシュは投稿と結びつけて保存し、投稿を削除するときにあわせて削除します。投稿回数の制限のための一時的な記録は数時間で自動的に削除します。</li>
          <li>公表済みの集計結果や統計は、個人を識別できないため削除の対象になりません。</li>
        </ol>
      </LegalSection>

      <LegalSection id="rights" heading="9. 開示・訂正・削除の請求">
        <p>ご自身の個人情報について、開示、訂正、利用停止、削除を希望する場合は、第10項の連絡先までご連絡ください。本人確認のうえ、法令に従って対応します。</p>
      </LegalSection>

      <LegalSection id="contact" heading="10. お問い合わせ">
        <p>個人情報の取り扱いに関するお問い合わせは、support@team-mir.ai までご連絡ください。本サービスの利用条件は<Link href="/terms" className="text-primary-accent underline underline-offset-4">利用規約</Link>をご覧ください。</p>
      </LegalSection>

      <LegalSection id="changes" heading="11. 改定">
        <p>当団体は、法令の改正や本サービスの変更に応じて本ポリシーを改定することがあります。改定後のポリシーは本サービス上に掲示した時点で効力を生じます。</p>
      </LegalSection>
    </LegalDocument>
  );
}
