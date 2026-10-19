import type { Metadata } from 'next';
import Link from 'next/link';
import { PRODUCT_NAME } from '@/components/navigation/pages';
import { SITE_URL } from '@/app/lib/site-url';
import { LegalDocument, LegalSection } from '@/components/legal/LegalDocument';
import { PRIVACY_UPDATED } from '@/app/lib/legal';

export const metadata: Metadata = {
  title: `プライバシーポリシー｜${PRODUCT_NAME}`,
  description: `チームみらいが運営する「${PRODUCT_NAME}」（${SITE_URL}）における個人情報・利用情報の取り扱い。`,
  alternates: { canonical: new URL('/privacy', SITE_URL).href },
};

/**
 * プライバシーポリシー。まるみえ・みらい議会のポリシーと同じ粒度に揃える
 * （ホスティング等の事業者名は書かない。アクセス解析は Google Analytics と明示する）。
 * 実装と食い違わないよう、取り扱いを変えるときは本文も更新する
 * （根拠: app/api/projects/[pid]/comments, app/api/ai, client/lib/ai/api-key-store.ts,
 * components/analytics/SiteGoogleAnalytics.tsx）。
 */
export default function PrivacyPage() {
  return (
    <LegalDocument
      title="プライバシーポリシー"
      updated={PRIVACY_UPDATED}
      lead={<p>チームみらい（以下「当団体」）は、運営するウェブサイト「{PRODUCT_NAME}」（{SITE_URL}。以下「本サービス」）における個人情報およびその他の利用情報を、次のとおり取り扱います。</p>}
    >
      <LegalSection id="definition" heading="1. 個人情報の定義">
        <p>本ポリシーで「個人情報」とは、個人情報の保護に関する法律に定める個人情報をいい、氏名、住所、電話番号、メールアドレスなど特定の個人を識別できる情報、および他の情報と容易に照合することで特定の個人を識別できる情報を含みます。本サービスの意見投稿や AI との対話を通じて取得する対話ログに個人情報が含まれる場合も、同様に取り扱います。</p>
      </LegalSection>

      <LegalSection id="collected" heading="2. 取得する情報と利用目的">
        <p>本サービスは会員登録を求めません。当団体が取得する情報と、その利用目的は次のとおりです。</p>
        <ul>
          <li><strong>意見の投稿内容と対話ログ。</strong>事業への意見を投稿する際、ユーザーが確認した意見文と対象の事業、投稿日時、および投稿に至る AI との対話の内容（対話ログ）を取得します。意見文は本サービスでの公開、集計・分析、政策の検討に利用します。対話ログは公開せず、サービスの運営・改善、政策の検討、不正対策に利用します。</li>
          <li><strong>AI 機能への入力と応答（対話ログ）。</strong>AI による絞り込みや対話に入力した内容と、それに対する AI の応答を取得します。入力した内容は、応答を生成するために外部の AI サービスで処理します。対話ログは公開せず、サービスの運営・改善、政策の検討、不正対策に利用します。個人を特定する情報とは結びつけません。ユーザー自身の API キーを登録して利用する場合は、入力した内容はユーザーのブラウザから直接外部の AI サービスに送られ、当団体は取得しません。外部の AI サービスが自社の条件に基づいて入力内容を一時的に保持することがあります。</li>
          <li><strong>不正利用対策のための情報。</strong>短時間の大量投稿や荒らしを防ぐため、投稿時の IP アドレスを、当団体だけが持つ秘密の値を加えたハッシュ値に変換して保存します（生の IP アドレスは保存しません）。投稿回数の制限と不正利用への対応に利用します。</li>
          <li><strong>アクセス情報。</strong>本サービスの提供に用いるサーバーは、障害対応やセキュリティのためにアクセスログを一時的に記録します。当団体はこれを個人を特定する目的で利用しません。</li>
          <li><strong>利用状況。</strong>本サービスの改善のため、閲覧したページ（絞り込み条件などを含む URL）、参照元、おおよその地域、利用した端末の種類などの利用状況をアクセス解析ツールで取得します。個人を特定する目的では利用しません。</li>
          <li><strong>お問い合わせ。</strong>メールでお問い合わせいただいた場合、メールアドレスと内容を、回答と記録のために利用します。</li>
        </ul>
        <p>このほか、本サービスの運営・改善、本規約に反する利用への対応、法令に基づく対応のために、取得した情報を利用することがあります。</p>
      </LegalSection>

      <LegalSection id="third-party" heading="3. 第三者への提供">
        <ol>
          <li>当団体は、次の場合を除き、取得した個人データ（個人情報の保護に関する法律に定める個人データを指します。）を第三者に提供しません。
            <ul>
              <li>本人の同意がある場合</li>
              <li>法令に基づく場合、または裁判所・警察などの公的機関から正当な手続きにより開示を求められた場合</li>
              <li>不正アクセスや本規約違反への対応のために必要な場合</li>
            </ul>
          </li>
          <li>投稿された意見は、匿名で本サービス上に公開されるほか、個人を識別できない形で統計化し、または集計し、報告書などで公表することがあります。対話ログは公開せず、次項の委託先を除き第三者に提供しません。</li>
          <li>本サービスの提供にあたり、ホスティング、データの保管、AI による応答の生成、アクセス解析を外部のサービスに委ねています。AI 機能に入力した内容は、応答の生成のために外部の AI サービスで処理されます。ユーザー自身の API キーを登録して AI 機能を利用する場合、入力した内容はユーザーのブラウザから直接その外部サービスに送られます。公開サイトの利用状況は、アクセス解析のために Google に送信します。</li>
        </ol>
      </LegalSection>

      <LegalSection id="security" heading="4. 安全管理">
        <p>当団体は、取得した情報への不正アクセス、漏えい、改ざんを防ぐため、通信の暗号化、アクセス権限の管理、投稿前の機械的なチェックなど適切な安全管理措置を講じます。AI 処理に伴うデータの取り扱いについても、適切な措置を講じます。</p>
      </LegalSection>

      <LegalSection id="cookie" heading="5. Cookie とブラウザ内の保存">
        <ol>
          <li>本サービスは、公開サイトの利用状況を把握するために Google Analytics を使用します。Google Analytics は Cookie を用いて、閲覧したページ、参照元、おおよその地域、端末の種類などを Google に送信します。この計測は本番の公開サイトでのみ行い、プレビューや開発環境では行いません。Google による情報の利用については「<a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer" className="text-primary-accent underline underline-offset-4">Google のサービスを使用するサイトやアプリから収集した情報の Google による使用</a>」をご覧ください。Cookie はブラウザの設定から拒否できます。</li>
          <li>表示の設定や AI 機能の設定（ユーザー自身の API キーを含む）は、ユーザーのブラウザ内に保存します。これらは当団体のサーバーには送信されず、ブラウザの設定や画面の操作で削除できます。</li>
        </ol>
      </LegalSection>

      <LegalSection id="retention" heading="6. 保管期間と削除">
        <ol>
          <li>取得した個人情報および対話ログ（意見投稿に至る対話と、AI 機能への入力・応答を含みます）は、原則として 7 年間保管した後、適切な方法で廃棄・削除します。投稿した本人が意見の削除を希望する場合は、第8項の連絡先までお知らせください。匿名投稿のため、投稿日時や内容を伺って本人を確認し、意見文と対話ログをあわせて削除します。</li>
          <li>公表済みの集計結果や統計など、個人を識別できない形に加工した情報は、削除の対象になりません。</li>
          <li>アクセス解析のために Google に送った利用状況は、当団体のサーバーには保存しません。</li>
        </ol>
      </LegalSection>

      <LegalSection id="rights" heading="7. 開示・訂正・削除の請求">
        <p>ご自身の個人情報について、開示、訂正、利用停止、削除を希望する場合は、第8項の連絡先までご連絡ください。本人確認のうえ、法令に従って対応します。</p>
      </LegalSection>

      <LegalSection id="contact" heading="8. お問い合わせ">
        <p>個人情報の取り扱いに関するお問い合わせは、support@team-mir.ai までご連絡ください。本サービスの利用条件は<Link href="/terms" className="text-primary-accent underline underline-offset-4">利用規約</Link>をご覧ください。</p>
      </LegalSection>

      <LegalSection id="changes" heading="9. 改定">
        <p>当団体は、法令の改正や本サービスの変更に応じて本ポリシーを改定することがあります。改定する場合は、改定内容と効力発生日を本サービス上に掲示します。</p>
      </LegalSection>
    </LegalDocument>
  );
}
