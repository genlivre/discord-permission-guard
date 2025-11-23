# discord-permission-guard

Cloudflare Workers 上で動かす、**Discord サーバーのチャンネル権限監視 Bot** です。

- 複数の Discord サーバー（ギルド）を定期的にチェック
- 「@everyone に閲覧許可が付いてしまっているチャンネル」を検出
- サーバーごとに指定した **管理用サーバーの Webhook** に警告を通知
- 「お知らせ／ルール」などの公開 OK チャンネルはホワイトリストで除外

> ⚠️ この Worker は「Discord の REST API を叩くだけ」で、  
> Gateway (WebSocket) には接続しないシンプル構成です。

---

## 機能概要

- **監視対象サーバーを複数指定**  
  `config.ts` にギルド ID ごとの設定を記述します。
- **@everyone に ViewChannel(閲覧) 権限が付いているチャンネルを検出**
  - 対象チャンネルタイプ: `GUILD_TEXT (0)`, `GUILD_NEWS (5)`, `GUILD_FORUM (15)`
  - チャンネルの permission_overwrites から、  
    `id === guildId`（= @everyone ロール）かつ `allow` に `VIEW_CHANNEL` ビットが立っている場合を「公開」とみなします。
- **ホワイトリストで除外**
  - `config.ts` でギルドごとに `whitelistChannelIds` を指定
  - ここに含まれるチャンネルは、@everyone 公開でも警告対象外
- **通知は別サーバーの Webhook に送信**
  - 監視対象サーバーとは別の「管理用サーバー」のチャンネルに通知する想定
  - ギルドごとに `alertWebhookUrl` を設定
- **定期実行 (Cron)**
  - Cloudflare の Cron Triggers を利用
  - デフォルトは 10 分ごと (`*/10 * * * *`)

---

## ディレクトリ構成

```text
discord-permission-guard/
  package.json
  tsconfig.json
  wrangler.toml
  src/
    index.ts        # Worker エントリ (scheduled + fetch)
    config.ts       # 監視対象ギルドごとの設定
    discord.ts      # Discord REST API クライアント
    checker.ts      # 権限チェック & 通知ロジック
    webhook.ts      # Discord Webhook 用の送信ヘルパー
    types.ts        # Discord API の簡易型定義
```

---

## 動作イメージ

1. Cloudflare Cron (5 分ごと) → Worker の `scheduled()` を実行
2. `runPermissionCheck()` が呼ばれる
3. `config.ts` に記述されたギルド一覧をループ
4. 各ギルドに対して `/guilds/{guild.id}/channels` を叩いてチャンネル一覧取得
5. 各チャンネルの permission_overwrites をチェック
   - @everyone に `VIEW_CHANNEL` Allow が付いている
   - かつ whitelist ではない
6. 問題チャンネルがあれば、そのギルドに紐づいた **管理サーバー側 Webhook** にまとめて通知

---

## 事前準備

### 1. Discord Developer Portal で Bot 作成

1. <https://discord.com/developers/applications> へアクセス
2. 「New Application」でアプリケーション作成
3. 左メニュー「Bot」→「Add Bot」で Bot ユーザーを作成
4. Bot タブで **Token** をコピーしておく（これが後で `DISCORD_BOT_TOKEN` になる）

この Bot は **監視対象サーバー** に入れるためのものです。  
通知は Webhook 経由なので、通知先の管理サーバーに Bot を入れる必要はありません。

### 2. 監視対象サーバーに Bot を招待

1. Developer Portal の「OAuth2 → URL Generator」
2. SCOPES: `bot` を選択
3. BOT PERMISSIONS（最低限）
   - `View Channels`
   - `Read Message History`
   - `Send Messages`（ログ用／今後の拡張用）
4. 生成された Invite URL を開いて、監視対象サーバーに Bot を追加

### 3. 通知先（管理サーバー）で Webhook を作成

管理者用サーバーの通知したいチャンネルごとに Webhook を作成します。

1. Discord クライアントで通知用チャンネルを右クリック → 「編集」
2. 「連携」(Integrations) → 「Webhooks」
3. 「新しい Webhook」から Webhook を作成
4. Webhook URL をコピー  
   → これを `config.ts` の `alertWebhookUrl` に書きます

### 4. ギルド ID / チャンネル ID の取得

Discord クライアントで「開発者モード」を有効にします。

- ユーザー設定 → 詳細設定 → 「開発者モード」を ON
- サーバー名やチャンネル名を右クリック → 「ID をコピー」で各 ID を取得できます

---

## セットアップ

### 1. インストール

```bash
git clone <このリポジトリのURL>
cd discord-permission-guard

npm install
```

（wrangler v4 系推奨）

```bash
npm install --save-dev wrangler@4
```

### 2. Cloudflare アカウント & Wrangler ログイン

```bash
npx wrangler login
```

ブラウザで認証を完了させます。

### 3. Discord Bot Token を Secret に登録

**Bot タブでコピーしたトークンそのもの**を渡します（先頭に `Bot ` は含めない）。

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
# プロンプトが出るので Bot トークンを貼り付け
```

### 4. `config.ts` を編集

`src/config.ts` に監視対象ギルドと通知先 Webhook を設定します。

```ts
// src/config.ts

export interface GuildConfig {
  guildId: string; // 監視対象サーバーの ID
  guildName: string; // ログや通知用の名前
  alertWebhookUrl: string; // 管理サーバーの Webhook URL
  whitelistChannelIds: string[]; // 公開OKにするチャンネル ID
}

// 実際の ID / URL に置き換えてください
export const GUILDS: GuildConfig[] = [
  {
    guildId: "111111111111111111",
    guildName: "サーバー1",
    alertWebhookUrl:
      "https://discord.com/api/webhooks/AAA/BBBBBBBBBBBBBBBBBBBB",
    whitelistChannelIds: [
      "333333333333333333", // サーバー1のお知らせチャンネル
      "444444444444444444", // サーバー1のルールチャンネル
    ],
  },
  {
    guildId: "222222222222222222",
    guildName: "サーバー2",
    alertWebhookUrl:
      "https://discord.com/api/webhooks/CCC/DDDDDDDDDDDDDDDDDDDD",
    whitelistChannelIds: [
      "555555555555555555", // サーバー2の announcements
    ],
  },
];
```

---

## ローカル開発

### 1. dev 実行

Cloudflare 上の Secret を使いたい場合は `--remote` 推奨：

```bash
npx wrangler dev --remote
```

ローカルモードで `.dev.vars` を使う場合は（任意）：

```bash
echo 'DISCORD_BOT_TOKEN=あなたのBotトークン' > .dev.vars
npx wrangler dev
```

> `.dev.vars` を使う場合は `.gitignore` に追加してください。

### 2. HTTP エンドポイント

`src/index.ts` では、開発用に 2 つのエンドポイントを生やしています。

- `GET /health`  
  → 単純に `"OK"` を返すヘルスチェック
- `GET /run`  
  → 即座に `runPermissionCheck()` を実行（Cron を待たずにテストできる）

ブラウザまたは curl で叩きます：

```bash
curl http://localhost:8787/health      # => OK
curl http://localhost:8787/run         # => Started check
```

コンソールには、ギルドごとのログや Discord API のエラーが出力されます。

---

## デプロイ

```bash
npx wrangler deploy
```

`wrangler.toml` に設定してある内容に従ってデプロイされます。

### wrangler.toml（例）

```toml
name = "discord-permission-guard"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[triggers]
crons = ["*/10 * * * *"] # 10分ごとに scheduled() 実行
```

デプロイが成功すると、Cloudflare 側に Cron Trigger が設定され、  
**10 分おきに `scheduled()` → `runPermissionCheck()` が自動実行されます。**

---

## 権限判定ロジックについて

### 対象チャンネル

- type が以下のものだけを監視
  - `0`: GUILD_TEXT（通常のテキストチャンネル）
  - `5`: GUILD_NEWS
  - `15`: GUILD_FORUM`

### 「公開状態」の判定

1. `channel.permission_overwrites` から
   - `id === guildId`（@everyone ロールと同じ ID）
   - `type === 0`（role）
     のものを探す
2. その Overwrite の
   - `allow` に `VIEW_CHANNEL` (ビット値 1024) が立っている
   - `deny` には立っていない
3. 上記を満たす場合、「@everyone から見えるチャンネル」とみなす

```ts
const VIEW_CHANNEL_BIT = 1 << 10; // 1024

const allow = BigInt(everyoneOverwrite.allow);
const deny = BigInt(everyoneOverwrite.deny);

const isAllowed = (allow & BigInt(VIEW_CHANNEL_BIT)) !== BigInt(0);
const isDenied = (deny & BigInt(VIEW_CHANNEL_BIT)) !== BigInt(0);

return isAllowed && !isDenied;
```

> ※ 「サーバー全体のロール設定」で @everyone に ViewChannels が付いているケースなど、  
> もっと厳密なチェックをしたい場合は、このロジックを拡張する必要があります。

---

## セキュリティ・運用上の注意

- **Bot トークンは必ず Secret / .dev.vars で管理**
  - `wrangler.toml` や Git リポジトリに直書きしない
- Webhook URL も外部に漏れると勝手に通知を飛ばされるので注意
  - 可能なら Webhook URL も Secret 化 or 別の Config 管理方法にする
- `git log` やスクショにトークン・Webhook URL を映さない

---

## よくあるハマりポイント

- `401 Unauthorized` が出る
  - トークンの種類が違う（Bot タブ以外の値を使っている）
  - トークンに `Bot ` まで含めてしまっている
  - dev モードで env が正しく渡っていない（`.dev.vars` or `--remote` を確認）
- 通知が飛ばない
  - `config.ts` の `alertWebhookUrl` に typo
  - Webhook のチャンネルが削除された／権限不足
- 「このチャンネルは公開で問題ないのに毎回警告が出る」
  - `whitelistChannelIds` にチャンネル ID を追加し忘れている

---

## 今後の拡張アイデア

- Cloudflare KV を使って「前回検出した問題チャンネル」を保存し、  
  **状態が変わった時だけ通知する（差分通知）**
- ホワイトリストを ID ではなく「トピックに `#perm-whitelist` を含むチャンネル」などで判定
- @everyone 以外にも「絶対に見せたくないロール」を設定してチェック対象に含める
- 通知内容を Embed 化して読みやすくする（Webhook で簡単に可能）
