# discord-permission-guard

Cloudflare Workers 上で動かす、**Discord サーバーのチャンネル権限監視 Bot** です。

- 複数の Discord サーバー（ギルド）を定期的にチェック
- 「@everyone に閲覧許可が付いてしまっているチャンネル」を検出
- サーバーごとに指定した **管理用サーバーの Webhook** に警告を通知
- 「お知らせ／ルール」などの公開 OK チャンネルはホワイトリストで除外
- **返信忘れ監視**: アーティスト個別チャンネル等で「最新の発言が運営以外のまま放置されている」チャンネルを検出し、毎朝のサマリーと日中のリマインドを Webhook で通知
- **Web ベースの管理画面**で設定を変更可能

> ⚠️ この Worker は「Discord の REST API を叩くだけ」で、
> Gateway (WebSocket) には接続しないシンプル構成です。

---

## 機能概要

- **監視対象サーバーを複数指定**
  Web 管理画面または KV に保存された設定で管理します。
- **@everyone に ViewChannel(閲覧) 権限が付いているチャンネルを検出**
  - 対象チャンネルタイプ: `GUILD_TEXT (0)`, `GUILD_NEWS (5)`, `GUILD_FORUM (15)`
  - チャンネルの permission_overwrites から、
    `id === guildId`（= @everyone ロール）かつ `allow` に `VIEW_CHANNEL` ビットが立っている場合を「公開」とみなします。
- **ホワイトリストで除外**
  - 管理画面でギルドごとに `whitelistChannelIds` を指定
  - ここに含まれるチャンネルは、@everyone 公開でも警告対象外
- **通知は別サーバーの Webhook に送信**
  - 監視対象サーバーとは別の「管理用サーバー」のチャンネルに通知する想定
  - ギルドごとに `alertWebhookUrl` を設定
- **返信忘れ監視（Reply Monitor）**
  - ギルドごとに有効/無効を設定（管理画面の「返信忘れ監視」セクション）
  - 「運営ロール」を持たないユーザーの発言が最新のまま放置されているチャンネルを未返信として検出
  - 最終メッセージに**運営が「対応済みリアクション」**（デフォルト ✅。管理画面で追加・変更可能、カスタム絵文字は `名前:ID` 形式）を付けると「対応不要」としてアラート対象外にできる
  - 毎朝 8:45 JST にサマリー（0件でも投稿）、15:00 JST に未返信が残っていればリマインドを `alertWebhookUrl` へ通知
  - 運営内部チャンネルなどは「監視除外チャンネル」で除外
- **定期実行 (Cron)**
  - Cloudflare の Cron Triggers を利用
  - 権限チェック + 返信監視ポーリング: 10 分ごと (`*/10 * * * *`)
  - 返信監視の朝サマリー: `45 23 * * *`（UTC = 8:45 JST）
  - 返信監視の日中リマインド: `0 6 * * *`（UTC = 15:00 JST）
- **Web 管理画面**
  - `/admin` でサーバー設定、ホワイトリストチャンネル、返信忘れ監視（運営ロール・除外チャンネル・未返信状況の確認）の管理が可能
  - Cloudflare Access で認証保護推奨

---

## ディレクトリ構成

```text
discord-permission-guard/
  package.json
  tsconfig.json
  wrangler.toml.example
  src/
    index.ts        # Worker エントリ (scheduled + fetch)
    config.ts       # GuildConfig 型定義
    discord.ts      # Discord REST API クライアント
    checker.ts      # 権限チェック & 通知ロジック
    webhook.ts      # Discord Webhook 用の送信ヘルパー
    types.ts        # Discord API の簡易型定義
    replyMonitor/
      judge.ts      # 未返信判定の純粋ロジック（テスト対象）
      poller.ts     # 差分ポーリング（last_message_id ベース）
      state.ts      # 未返信状態の KV 保存
      notifier.ts   # 朝サマリー / 日中リマインドの組み立てと送信
    admin/
      index.ts      # Admin UI ルーティング
      api.ts        # 設定取得・保存 API
      html.ts       # Admin UI HTML/JS
```

---

## 動作イメージ

1. Cloudflare Cron (10 分ごと) → Worker の `scheduled()` を実行
2. `runPermissionCheck()` が呼ばれる
3. KV に保存されたギルド設定をループ
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
4. 生成された Invite URL を開いて、監視対象サーバーに Bot を追加

### 3. 通知先（管理サーバー）で Webhook を作成

管理者用サーバーの通知したいチャンネルごとに Webhook を作成します。

1. Discord クライアントで通知用チャンネルを右クリック → 「編集」
2. 「連携」(Integrations) → 「Webhooks」
3. 「新しい Webhook」から Webhook を作成
4. Webhook URL をコピー
   → これを管理画面の `alertWebhookUrl` に設定します

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

### 2. wrangler.toml を作成

```bash
cp wrangler.toml.example wrangler.toml
```

### 3. KV Namespace を作成

```bash
npx wrangler kv namespace create CONFIG_KV
npx wrangler kv namespace create CONFIG_KV --preview
```

出力された ID を `wrangler.toml` に設定します：

```toml
[[kv_namespaces]]
binding = "CONFIG_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
preview_id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
```

### 4. Cloudflare アカウント & Wrangler ログイン

```bash
npx wrangler login
```

ブラウザで認証を完了させます。

### 5. Discord Bot Token を Secret に登録

**Bot タブでコピーしたトークンそのもの**を渡します（先頭に `Bot ` は含めない）。

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
# プロンプトが出るので Bot トークンを貼り付け
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

`src/index.ts` では、以下のエンドポイントを提供しています。

| エンドポイント | 説明 |
|----------------|------|
| `GET /health` | ヘルスチェック（`"OK"` を返す） |
| `GET /run` | 権限チェックを即座に実行 |
| `GET /run-reply` | 返信監視ポーリングを即座に実行し、未返信状態を JSON で返す |
| `GET /run-reply?kind=morning` | ポーリング + 朝サマリー通知まで実行（`kind=reminder` で日中リマインド） |
| `GET /admin` | 管理画面 |
| `GET /admin/api/*` | 管理画面用 API |

ブラウザまたは curl で叩きます：

```bash
curl http://localhost:8787/health      # => OK
curl http://localhost:8787/run         # => Completed permission check
```

### 3. 管理画面

ブラウザで `http://localhost:8787/admin` にアクセスすると、以下の操作ができます：

- Bot が参加しているサーバーの追加
- Webhook URL の設定
- ホワイトリストチャンネルの選択

---

## デプロイ

```bash
npx wrangler deploy
```

`wrangler.toml` に設定してある内容に従ってデプロイされます。

デプロイが成功すると、Cloudflare 側に Cron Trigger が設定され、
**10 分おきに `scheduled()` → `runPermissionCheck()` が自動実行されます。**

---

## 管理画面のセキュリティ

デプロイ後、`/admin` と `/run` エンドポイントは公開状態になります。
本番環境では **Cloudflare Access** で保護することを強く推奨します。

### Cloudflare Access の設定手順

1. Cloudflare ダッシュボード → Zero Trust → Access → Applications
2. 「Add an Application」→「Self-hosted」
3. Application domain に Worker の URL を入力
4. Path に `/admin*` と `/run*` を追加（`/run*` は `/run-reply` も含む）
5. Policy でアクセス許可するメールアドレスやドメインを設定
6. 保存

これにより、設定したユーザーのみが管理画面にアクセスできるようになります。

---

## 権限判定ロジックについて

### 対象チャンネル

- type が以下のものだけを監視
  - `0`: GUILD_TEXT（通常のテキストチャンネル）
  - `5`: GUILD_NEWS
  - `15`: GUILD_FORUM

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

## 返信忘れ監視のロジックについて

### 目的

運営とアーティストの個別チャンネルで「アーティストからの連絡に運営が返信し忘れる」事故を防ぐための機能です。
毎朝のサマリーを定例で確認（指差し確認）し、日中のリマインドで当日中の返信忘れを拾います。

### 未返信の判定

1. 対象チャンネル: `GUILD_TEXT (0)` と `GUILD_NEWS (5)`。監視除外チャンネルはスキップ
   （フォーラム(15)はメッセージがスレッド側に付くため現状対象外）
2. 直近メッセージのうち、通常メッセージ（type 0/19）かつ Bot 以外の発言だけを判定対象にする
3. 最新の判定対象メッセージの発言者が **運営ロールを持っていれば返信済み**、持っていなければ**未返信**
4. 未返信の場合、非運営ユーザーの連投を遡った先頭メッセージを「経過時間の起点」とする
5. ただし最新メッセージに**運営が付けた「対応済みリアクション」**があればアラート対象外
   - 対象の絵文字は管理画面でギルドごとに設定（デフォルト ✅。複数指定可、カスタム絵文字は `名前:ID` 形式）
   - 設定に無いリアクション（🙇 など）は返信とみなさない
   （返信不要で会話が終わっているケースの運用逃げ道）

### 差分ポーリングとレートリミット

チャンネル数が増えても API 呼び出しがチャンネル総数に比例しない設計です。

1. `GET /guilds/{id}/channels`（1リクエスト）で全チャンネルの `last_message_id` を取得
2. 前回観測値から**動きのあったチャンネルと未返信継続中のチャンネルだけ** `GET /channels/{id}/messages` を取得
   （未返信継続中は ✅ の後付け・メッセージ削除を検知するため毎回再取得）
3. 発言者のロールは `GET /guilds/{id}/members/{user}` を KV で 1 時間キャッシュ
   （新しい順に「最初の運営発言」に当たるまでしか解決しないため、呼び出し数は連投の長さ程度）
4. 429 発生時は `Retry-After` を尊重して 1 回リトライ（10秒超の指示はリトライせず次回実行へ）
5. 1 回の実行で Discord API を呼ぶ回数に上限（40）を設けており、超えたチャンネルは
   前回状態のまま次回実行へ持ち越す（Cloudflare Workers のサブリクエスト上限対策）
6. 直近 50 件に人間の発言が 1 件も無い場合（Bot 投稿で埋まっているケース）は
   「返信済み」と確定せず前回の未返信状態を維持する（検知漏れ防止）
7. ギルド単位でポーリング自体が失敗した場合は、朝サマリー / リマインドで
   「実行に失敗しました」と必ず通知する（監視のサイレント停止を防ぐ）

### 状態の保存先（KV）

| キー | 内容 |
|------|------|
| `reply_state:{guildId}` | チャンネルごとの未返信状態（`Record<channelId, ChannelReplyState>`） |
| `member_roles:{guildId}:{userId}` | メンバーのロールキャッシュ（TTL 1時間） |

メッセージ本文・発言者名は保存も通知もしません（通知はチャンネル名とジャンプリンクのみ）。

### Bot に必要な権限

権限チェック機能と同じ `View Channels` + `Read Message History` のみで動作します。
Bot に閲覧権限がないチャンネルは取得エラーとして記録され、朝サマリーの末尾に
「取得できないチャンネル」として明示されます（サイレントな監視漏れを防ぐため）。

### テスト

判定ロジック（`src/replyMonitor/judge.ts`）と通知整形（`notifier.ts`）は vitest でテストしています。

```bash
npm test
```

---

## セキュリティ・運用上の注意

- **Bot トークンは必ず Secret / .dev.vars で管理**
  - `wrangler.toml` や Git リポジトリに直書きしない
- **wrangler.toml は .gitignore に含める**
  - KV の ID などが含まれるため
- Webhook URL も外部に漏れると勝手に通知を飛ばされるので注意
- `git log` やスクショにトークン・Webhook URL を映さない
- **管理画面は Cloudflare Access で保護する**

---

## よくあるハマりポイント

- `401 Unauthorized` が出る
  - トークンの種類が違う（Bot タブ以外の値を使っている）
  - トークンに `Bot ` まで含めてしまっている
  - dev モードで env が正しく渡っていない（`.dev.vars` or `--remote` を確認）
- 通知が飛ばない
  - 管理画面の `alertWebhookUrl` に typo
  - Webhook のチャンネルが削除された／権限不足
- 「このチャンネルは公開で問題ないのに毎回警告が出る」
  - 管理画面でホワイトリストにチャンネルを追加し忘れている
- 管理画面にアクセスできない
  - Cloudflare Access で保護している場合、許可されたユーザーでログインしているか確認

---

## ライセンス

MIT
