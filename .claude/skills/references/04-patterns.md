# 04. 画面パターン

「コンポーネントの組み合わせとして頻出する状況」と「ちみ標準の組み方」をまとめる。コンポーネント単体の使い方は [`03-components.md`](03-components.md)、ボタン文言の選び方は [`05-writing.md`](05-writing.md)。

---

## 4.1 ローディング状態

### 鉄則：白紙で待たせない

データ取得中に画面が空白のまま固まる UX は **絶対に作らない**。次の 3 つから選ぶ:

| パターン | 用途 |
|---|---|
| **Skeleton** | カード・テーブル・リスト等、構造が固定の取得待ち |
| **Spinner**(中央) | 1 つの単位の操作中(送信中・データ更新中) |
| **Progress bar** | 進捗が定量的にわかる場合(アップロード・チェック処理) |

### Skeleton 例

```tsx
import { Skeleton } from "@/components/ui/skeleton";

if (isLoading) {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-3/4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- Skeleton の幅は実データの平均幅に合わせる(`w-3/4`、`w-24`)
- 動きは Tailwind の `animate-pulse`(既存)でよい
- **Skeleton と実データのレイアウトはピクセル単位で揃える**(取得後に画面がジャンプしないように)

### Spinner 例

```tsx
import { Loader2 } from "lucide-react";

<Button disabled={isSubmitting}>
  {isSubmitting && <Loader2 className="animate-spin" />}
  {isSubmitting ? "送信中..." : "送信する"}
</Button>
```

`lucide-react` の `Loader2` を `animate-spin` で回す。**送信中のボタン文言は「送信中...」のように現在進行形に変える**。

---

## 4.2 空状態(empty state)

### 鉄則：必ず 3 要素を揃える

```
アイコン(lucide)+ 1 行の説明 + CTA
```

「データがありません」だけで終わらせない。ユーザーの **次の一手** を必ず置く。

### 例

```tsx
import { Inbox } from "lucide-react";

<Card className="flex flex-col items-center justify-center py-16 gap-4">
  <Inbox className="size-12 text-muted-foreground" />
  <div className="text-center space-y-1">
    <p className="font-semibold">まだコメントがありません</p>
    <p className="text-sm text-muted-foreground">最初のコメントを投稿してみましょう</p>
  </div>
  <Button>コメントを投稿する</Button>
</Card>
```

| 要素 | ルール |
|---|---|
| アイコン | lucide-react から「該当領域の象徴」になるもの。`size-12` (= 48px)、`text-muted-foreground` |
| 主文 | `font-semibold`、何が無いかを明示 |
| 補助文 | `text-sm text-muted-foreground`、次の一手をほのめかす |
| CTA | プライマリ Button。可能なら 1 つに絞る |

### バリエーション

- **検索結果 0 件**：`<Search />` アイコン + 「該当する○○が見つかりません」 + 「検索条件を変える」CTA
- **権限がなくて見えない**：`<Lock />` アイコン + 「このページを見る権限がありません」 + 「ログイン」or 「管理者に問い合わせる」
- **エラー由来の空**：`<AlertTriangle />` アイコン + 「読み込みに失敗しました」 + 「再読み込み」

---

## 4.3 確認パターン(破壊的アクション)

### 鉄則：取り消せない操作には必ず Dialog を挟む

- 削除
- 公開取消
- アカウント削除
- 課金
- 大量データの上書き

```tsx
<Dialog>
  <DialogTrigger asChild>
    <Button variant="destructive">削除する</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>議案を削除しますか？</DialogTitle>
      <DialogDescription>
        この議案に紐づくコメント 24 件とリアクションも一緒に削除されます。
        この操作は取り消せません。
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <DialogClose asChild>
        <Button variant="outline">キャンセル</Button>
      </DialogClose>
      <Button variant="destructive" onClick={handleDelete}>
        削除する
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

ポイント:

- **副作用を具体的に書く**(「コメント 24 件も削除されます」)
- **「この操作は取り消せません」を明記**
- ボタン文言は **「削除する」「公開を取り消す」** のように動作を繰り返す(「OK」「実行」では弱い)
- 「キャンセル」は左、確定アクションは右

### 二重確認は避ける

「削除 → 確認 → 確認」のような二段確認は **しない**。1 段で十分。代わりに、特に重要な削除(アカウント削除等)では **テキスト入力で確定** させる：

```tsx
<Input placeholder='"削除" と入力してください' />
<Button disabled={input !== "削除"} variant="destructive">削除する</Button>
```

---

## 4.4 通知パターン(toast)

### 鉄則：1 行で完結。複数アクションは Dialog へ

```tsx
toast.success("保存しました");
toast.error("保存できませんでした。通信を確認してください");
toast.info("自動保存しました");
```

| 状況 | toast |
|---|---|
| フォーム送信成功 | ✅ `toast.success` |
| ネットワークエラー | ❌ `toast.error` |
| 自動処理の完了 | ℹ️ `toast.info` |
| 注意喚起(バックグラウンド処理中) | ⚠️ `toast.warning` |

### Undo パターン(破壊的アクション直後)

削除直後に **5 秒だけ** Undo を出す。Dialog 確認の代わりに使うこともある(軽い削除に限る):

```tsx
toast("コメントを削除しました", {
  action: {
    label: "元に戻す",
    onClick: () => undoDelete(id),
  },
  duration: 5000,
});
```

サーバー側で 5 秒の猶予を持って実削除する設計が必要。**重大な削除(アカウント・課金)には使わない**。

---

## 4.5 リスト・テーブルパターン

### 短いリスト(〜20 件)

そのまま全表示。

### 中程度(20〜100 件)

ページネーション。**1 ページ 20 件** が標準。

```tsx
<div className="flex items-center justify-between mt-4">
  <p className="text-sm text-muted-foreground">{total} 件中 {start}〜{end} 件</p>
  <div className="flex gap-2">
    <Button size="sm" variant="outline" disabled={page === 1} onClick={prev}>前へ</Button>
    <Button size="sm" variant="outline" disabled={page === maxPage} onClick={next}>次へ</Button>
  </div>
</div>
```

### 長いリスト(100 件以上)

**virtualize** する。`@tanstack/react-virtual` を使う。`map()` で 1000 件を生 DOM 化するとブラウザが固まる事例が実際にあった([山根 [Slack 2026-04-19]](https://team-mirai-staff.slack.com/archives/C0AFPQKSKS7/p1774620746459069?thread_ts=1774620746.459069))。

### 「もっと見る」パターン

「最初は 5 件 → ボタン押下で 10 件追加」のパターン。長文コメント・コメントスレッドで使う:

```tsx
const visible = items.slice(0, count);
{visible.map(...)}
{count < items.length && (
  <Button variant="outline" onClick={() => setCount(c => c + 10)}>
    もっと見る(残り {items.length - count} 件)
  </Button>
)}
```

「残り N 件」を明示することで、ユーザーに進捗感を与える。

---

## 4.6 タブ vs カラム vs 別画面

### 判断

- **タブ**：同じ対象を別の切り口で見せる(概要 / 詳細 / 関連)
- **カラム**：別の対象を横並びで比較したい
- **別画面**：別の対象に **遷移** する

「タブの中身が全部別 URL を持つ」のは避ける(タブ ≠ ナビゲーション)。タブはあくまで **同じ URL 内のビュー切替**。

---

## 4.7 検索・フィルタ

### 即時フィルタ vs Submit 型

- **即時フィルタ**(debounce 300ms)：候補が小さい・絞り込みが必要なリスト
- **Submit 型**：検索が高コスト(DB クエリ・AI 推論)の場合

### ファセット表示

複数のフィルタ条件を併用する場合は **左サイドバーまたは上部カード** に展開する：

```tsx
<aside className="w-[260px] space-y-4">
  <Card>
    <CardHeader><CardTitle>カテゴリ</CardTitle></CardHeader>
    <CardContent className="space-y-2">
      <Checkbox /> 公開済み
      <Checkbox /> 下書き
      <Checkbox /> アーカイブ
    </CardContent>
  </Card>
  {/* ... */}
</aside>
```

選択中のフィルタは画面上部にバッジで表示し、`×` で個別解除できるようにする。

---

## 4.8 通知パネル / アクティビティ

新着がある場合は **アイコン + バッジ**(赤丸 + 数字)。サイドバーやヘッダーに置く。クリックで `<Sheet side="right">` でドロワー展開、または専用ページへ遷移。

```tsx
<Button size="icon" variant="ghost" aria-label="通知">
  <Bell />
  {unread > 0 && (
    <span className="absolute -top-1 -right-1 size-4 bg-destructive text-white text-xs rounded-full flex items-center justify-center">
      {unread > 9 ? "9+" : unread}
    </span>
  )}
</Button>
```

---

## 4.9 フォーム多段(マルチステップ)

3 ステップ以上なら **左サイドバーに進捗表示**、もしくは **上部 stepper**：

```tsx
<div className="flex items-center gap-4 mb-8">
  {steps.map((step, i) => (
    <div key={i} className={cn(
      "flex items-center gap-2",
      i < current ? "text-primary" : i === current ? "text-foreground" : "text-muted-foreground"
    )}>
      <span className={cn(
        "size-6 rounded-full flex items-center justify-center text-xs font-bold",
        i < current ? "bg-primary text-primary-foreground" :
        i === current ? "border-2 border-primary" : "bg-muted"
      )}>
        {i < current ? <Check className="size-3" /> : i + 1}
      </span>
      <span className="text-sm">{step}</span>
      {i < steps.length - 1 && <ArrowRight className="size-4 text-muted-foreground" />}
    </div>
  ))}
</div>
```

- 各ステップ間で `<Button variant="outline">戻る</Button>` を残す(ユーザーが訂正できるように)
- 最終確認画面で全項目を一覧表示してから送信

---

## 4.10 比較・diff 表示

「変更前 / 変更後」を比較する場合は **左右並び** または **上下並び**。色は:

- 削除：`bg-destructive/10 text-destructive line-through`
- 追加：`bg-stance-for-bg text-stance-for`
- 変更なし：`text-muted-foreground`

---

## 4.11 検索結果の強調

該当キーワードは `<mark className="bg-mirai-highlight">` でハイライト：

```tsx
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const regex = new RegExp(`(${escapeRegex(query)})`, "gi");
  return (
    <>
      {text.split(regex).map((part, i) =>
        regex.test(part) ? <mark key={i} className="bg-mirai-highlight px-0.5 rounded-sm">{part}</mark> : <span key={i}>{part}</span>
      )}
    </>
  );
}
```

`--color-mirai-highlight` = `#F4FF5F`(蛍光イエロー)を使う。

---

## 4.12 AI 出力の表示

AI が生成した内容には **必ずラベルを付ける**:

```tsx
<Card>
  <CardHeader className="flex flex-row items-center gap-2">
    <Badge variant="light">AI 生成</Badge>
    <span className="text-xs text-muted-foreground">
      {model} ・ 参考情報として確認してください
    </span>
  </CardHeader>
  <CardContent>{output}</CardContent>
</Card>
```

理由：[`01-philosophy.md` 原則 2](01-philosophy.md) 参照。「AI おすすめ順」のように責任の所在をラベルに含める。

### ストリーミング表示

LLM の逐次出力には `streamdown` を使う(mirai-gikai で採用済み)。**完成前にユーザーがコピーする UI を出さない**(カーソルがチカチカしている間はコピー禁止)。

---

## 4.13 数値・通貨

```tsx
const formatYen = (n: number) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(n);

<span className="font-medium tabular-nums">{formatYen(amount)}</span>
```

- 桁区切りに `Intl.NumberFormat`
- 等幅で揃えるなら `tabular-nums`(テーブルで縦に揃う)
- 単位は数値より 1 段小さく

---

## 4.14 日時

```tsx
import { formatRelative, format } from "date-fns";
import { ja } from "date-fns/locale";

// 「2 時間前」「昨日 15:00」のような相対表示
{formatRelative(date, new Date(), { locale: ja })}

// 「2026年5月14日 (火) 15:00」のような絶対表示
{format(date, "yyyy年M月d日 (E) HH:mm", { locale: ja })}
```

- ホバーで絶対日時、表示は相対日時、というパターンが標準
- 日付の `/` 区切りは避ける(米式 mm/dd/yyyy と紛らわしいため)

---

## 4.15 画像

- `next/image` を使う(`<img>` を直書きしない)
- `alt` は必ず付ける(装飾画像なら `alt=""`)
- アスペクト比は `aspect-video`(16:9)・`aspect-square`(1:1)等で明示
- LCP に影響する hero 画像は `priority` を付ける

---

## 4.16 人物の表示(アバター付きメンション)

### 鉄則：個別の人に言及する UI には Slack アバターを添える

レポート・一覧・カード・表彰・アクティビティなど、**特定のメンバーを名前で出す画面では、その人の Slack プロフィール画像(アバター)を一緒に表示する**。名前テキストだけより「誰のことか」が一目でわかり、人の取り違えも減る。みらいいぬが生成する週次まとめなどの成果物でも、個別の人に触れるときはこのパターンに従う。

### アバター URL の取得元

メンバーの Slack アバター URL は **メンバーディレクトリ [`data/members/*.yaml`](../../../../design-spec/260531_member-directory-design.md) の `accounts.slack.avatar`** に入っている(identity hub が SSoT)。ここを引けば名前解決と同時にアバターも取れる。

- 直接 Slack から取るなら `users.info` の `profile.image_512`(または `image_192`)。`avatars.slack-edge.com` は認証不要の公開 CDN なので `<img src>` でそのまま読める
- アバター URL はユーザーが画像を変えると変わる。**永続保存せず表示のたびに引く**(member directory の値も更新され得る前提)

### 実装(React / shadcn)

shadcn の `<Avatar>` を使い、画像が無い/失敗したときは `<AvatarFallback>` にイニシャルを出す:

```tsx
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

<Avatar className="size-12">
  <AvatarImage src={member.avatar} alt={member.displayName} />
  <AvatarFallback className="bg-mirai-gradient text-mirai-text font-bold">
    {member.displayName.slice(0, 1)}
  </AvatarFallback>
</Avatar>
```

### 実装(素の HTML / artifact など Tailwind が無い場合)

`<img>` の背後にイニシャル＋みらいグラデの円を敷き、画像が読めればその上に重なる。JS なしでフォールバックが効く:

```html
<span class="avatar"><span class="ini">河</span>
  <img src="https://avatars.slack-edge.com/..." alt="河合道雄" referrerpolicy="no-referrer" loading="lazy" />
</span>
```

```css
.avatar { position: relative; width: 48px; height: 48px; border-radius: 9999px;
  overflow: hidden; background: linear-gradient(to bottom right, #64D8C6, #BCECD3);
  display: flex; align-items: center; justify-content: center; }
.avatar .ini { font-weight: 700; color: #103b35; }
.avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
```

### ルール

| 項目 | ルール |
|---|---|
| 形 | 円形(`rounded-full`)。角丸四角は使わない |
| サイズ | 一覧/カード見出し 40-56px、本文インライン 20-24px、ヒーロー 64px〜 |
| フォールバック | 必ず用意する(イニシャル＋`bg-mirai-gradient`)。画像が無い/読めない人がいても崩れないように |
| `alt` | 必ず本人の表示名を入れる |
| `referrerpolicy` | 外部 CDN 画像には `no-referrer` を付ける(リファラ起因のブロック回避) |
| 名前との対応 | アバターと名前の対応は member directory(email 突合済み)を正とする。表示名の当て推量でアバターを貼らない |

> アバターを取り違えると名指しの事故になる。表示名だけで判断せず、`data/members/*.yaml` の email(`<firstname>.<lastname>@team-mir.ai`)と突き合わせてから貼ること。

---

## 関連ページ

- [`03-components.md`](03-components.md) — 各コンポーネントの詳細
- [`05-writing.md`](05-writing.md) — ボタン文言・エラーメッセージのルール
- [`06-accessibility.md`](06-accessibility.md) — フォーカス・キーボード操作
- [メンバーディレクトリ設計](../../../../design-spec/260531_member-directory-design.md) — §4.16 で使うアバター URL の取得元(`accounts.slack.avatar`)
