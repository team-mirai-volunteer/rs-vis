import type { Metadata } from 'next';
import Link from 'next/link';
import { PRODUCT_NAME } from '@/components/navigation/pages';
import { SITE_URL } from '@/app/lib/site-url';
import { LegalDocument, LegalSection } from '@/components/legal/LegalDocument';
import { LEGAL_UPDATED } from '@/app/lib/legal';

export const metadata: Metadata = {
  title: `プライバシーポリシー｜${PRODUCT_NAME}`,
  description: `チームみらいが運営する「${PRODUCT_NAME}」（${SITE_URL}）における個人情報・利用情報の取り扱い。`,
  alternates: { canonical: new URL('/privacy', SITE_URL).href },
};

/**
 * プライバシーポリシー。まるみえ・みらい議会のポリシーと同じ粒度（事業者名や保存方式の詳細は書かない）に揃える。
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
        <p>本ポリシーで「個人情報」とは、個人情報の保護に関する法律に定める個人情報をいい、氏名、住所、電話番号、メールアドレスなど特定の個人を識別できる情報、および他の情報と容易に照合することで特定の個人を識別できる情報を含みます。本サービスの意見投稿や AI との対話を通じて取得する内容に個人情報が含まれる場合も、同様に取り扱います。</p>
      </LegalSection>

      <LegalSection id="collected" heading="2. 取得する情報と利用目的">
        <p>本サービスは会員登録を求めません。当団体が取得する情報と、その利用目的は次のとおりです。</p>
        <ul>
          <li><strong>意見の投稿内容。</strong>事業への意見を投稿する際、ユーザーが確認した意見文と対象の事業、投稿日時を取得し、本サービスでの公開、集計・分析、政策の検討に利用します。投稿に先立つ AI との対話の内容は、意見文の作成のためにのみ用い、保存しません。</li>
          <li><strong>AI 機能への入力。</strong>AI による絞り込みや対話に入力した内容は、応答を生成するためにのみ用い、当団体は保存しません。</li>
          <li><strong>不正利用対策のための情報。</strong>短時間の大量投稿や荒らしを防ぐため、投稿時の IP アドレスを復元できない形に加工した値を取得し、投稿回数の制限と不正利用への対応に利用します。</li>
          <li><strong>アクセス情報。</strong>本サービスの提供に用いるサーバーは、障害対応やセキュリティのためにアクセスログを一時的に記録します。当団体はこれを個人を特定する目的で利用しません。</li>
          <li><strong>お問い合わせ。</strong>メールでお問い合わせいただいた場合、メールアドレスと内容を、回答と記録のために利用します。</li>
        </ul>
        <p>このほか、本サービスの運営・改善、本規約に反する利用への対応、法令に基づく対応のために、取得した情報を利用することがあります。</p>
      </LegalSection>

      <LegalSection id="third-party" heading="3. 第三者への提供">
        <ol>
          <li>当団体は、次の場合を除き、取得した個人情報を第三者に提供しません。
            <ul>
              <li>本人の同意がある場合</li>
              <li>個人を識別できない統計情報や集計結果として公表する場合</li>
              <li>法令に基づく場合、または裁判所・警察などの公的機関から正当な手続きにより開示を求められた場合</li>
              <li>不正アクセスや本規約違反への対応のために必要な場合</li>
            </ul>
          </li>
          <li>投稿された意見は、匿名で本サービス上に公開されるほか、個人を識別できない形で集計し、報告書などで公表することがあります。</li>
          <li>本サービスの提供にあたり、ホスティング、データの保管、AI による応答の生成を外部のサービスに委ねています。AI 機能に入力した内容は、応答の生成のために外部の AI サービスで処理されます。ユーザー自身の API キーを登録して AI 機能を利用する場合、入力した内容はユーザーのブラウザから直接その外部サービスに送られます。</li>
        </ol>
      </LegalSection>

      <LegalSection id="security" heading="4. 安全管理">
        <p>当団体は、取得した情報への不正アクセス、漏えい、改ざんを防ぐため、通信の暗号化、アクセス権限の管理、投稿前の機械的なチェックなど適切な安全管理措置を講じます。AI 処理に伴うデータの取り扱いについても、適切な措置を講じます。</p>
      </LegalSection>

      <LegalSection id="cookie" heading="5. Cookie とブラウザ内の保存">
        <ol>
          <li>本サービスは、現時点でアクセス解析のための Cookie や外部の計測ツールを使用していません。導入する場合は本ポリシーを更新して明示します。</li>
          <li>表示の設定や AI 機能の設定（ユーザー自身の API キーを含む）は、ユーザーのブラウザ内に保存します。これらは当団体のサーバーには送信されず、ブラウザの設定や画面の操作で削除できます。</li>
        </ol>
      </LegalSection>

      <LegalSection id="retention" heading="6. 保管期間と削除">
        <ol>
          <li>取得した情報は、本サービスの運営に必要な期間保管した後、適切な方法で削除します。投稿した本人が意見の削除を希望する場合は、第8項の連絡先までお知らせください。匿名投稿のため、投稿日時や内容を伺って本人を確認します。</li>
          <li>公表済みの集計結果や統計など、個人を識別できない形に加工した情報は、削除の対象になりません。</li>
        </ol>
      </LegalSection>

      <LegalSection id="rights" heading="7. 開示・訂正・削除の請求">
        <p>ご自身の個人情報について、開示、訂正、利用停止、削除を希望する場合は、第8項の連絡先までご連絡ください。本人確認のうえ、法令に従って対応します。</p>
      </LegalSection>

      <LegalSection id="contact" heading="8. お問い合わせ">
        <p>個人情報の取り扱いに関するお問い合わせは、support@team-mir.ai までご連絡ください。本サービスの利用条件は<Link href="/terms" className="text-primary-accent underline underline-offset-4">利用規約</Link>をご覧ください。</p>
      </LegalSection>

      <LegalSection id="changes" heading="9. 改定">
        <p>当団体は、法令の改正や本サービスの変更に応じて本ポリシーを改定することがあります。改定後のポリシーは本サービス上に掲示した時点で効力を生じます。</p>
      </LegalSection>
    </LegalDocument>
  );
}
