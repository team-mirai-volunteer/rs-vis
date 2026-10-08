'use client';

/** 委託構造（/subcontracts と事業ごとのフロー）のヘッダーの「説明」 */
import { HeaderHelp } from '@/client/components/HeaderHelp';

export function SubcontractsHelp() {
  return <HeaderHelp id="subcontracts-help" label="委託構造の説明">
    <h2 className="mb-2 text-[13px] font-bold">委託構造とは</h2>
    <p className="text-mirai-text-subtle">事業のお金が、国から誰に支払われ、そこからさらに誰へ再委託されたかを、行政事業レビューシートの「支出先」（5-1）と「支出ブロックのつながり」（5-2）から組み立てたものです。</p>
    <dl className="mt-3 space-y-2 text-mirai-text-subtle">
      <div><dt className="font-bold text-mirai-text">ブロック</dt>
        <dd>同じ役割の支出先のまとまりです（A・B・C…）。国から直接支払うブロックと、他のブロックから再委託を受けるブロックがあります。</dd></div>
      <div><dt className="font-bold text-mirai-text">差額（ブロック単位）</dt>
        <dd>ブロックの記載額から、直下の再委託先の記載額を引いた額です。記載額の差であり、実際の受取額や利益を示すものではありません。</dd></div>
      <div><dt className="font-bold text-mirai-text">金額の数え方</dt>
        <dd>「支出額合計」は再委託先への支払いも足すので、同じお金を二重に数えることがあります。国から出たお金は「直接支出合計」で見てください。</dd></div>
      <div><dt className="font-bold text-mirai-text">別財源・合流・分岐</dt>
        <dd>別財源は、事業から直接も再委託でもつながりを確認できない起点のブロックで、接続未確認の財源を表します。財投借入・自己収入などから出ている可能性がありますが、つながりの記載が無いことから判定しており、財源データで確かめたものではありません。合流は複数のブロックからお金を受けるブロック、分岐は複数のブロックへ再委託するブロックです。</dd></div>
      <div><dt className="font-bold text-mirai-text">「その他」</dt>
        <dd>上位以外の支出先を府省がまとめて記載した行です。件数が分かるときは「その他（N件）」と表示します（支出先の数 − 名前のある行。府省の記載に基づく値です）。</dd></div>
    </dl>
    <h2 className="mb-2 mt-4 text-[13px] font-bold">使い方</h2>
    <ul className="m-0 list-disc space-y-1 pl-4 text-mirai-text-subtle">
      <li>一覧の列見出しにカーソルを合わせると定義が、クリックで並べ替えができます。</li>
      <li>事業名をクリックすると、その事業のブロックと資金の流れの図を開きます。</li>
    </ul>
  </HeaderHelp>;
}
