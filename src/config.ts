// src/config.ts

export interface ReplyMonitorConfig {
  // 返信忘れ監視を有効にするか
  enabled: boolean;

  // 「運営メンバー」とみなすロールID。
  // このロールを持たないユーザーの発言が最新のまま放置されると未返信扱いになる。
  staffRoleIds: string[];

  // 返信監視の対象外にするチャンネルID（運営内部チャンネルなど）
  excludedChannelIds: string[];

  // 運営が最終メッセージに付けると「対応済み」とみなすリアクション。
  // 標準絵文字は絵文字そのもの（例: "✅"）、カスタム絵文字は "名前:ID" 形式。
  // 未設定・空の場合は ✅ のみが対象（後方互換）。
  resolveReactionEmojis?: string[];

  // この日数以上「人間のやり取り」が無いチャンネルを朝サマリーで
  // 「しばらくやり取りのないチャンネル」として通知する（疎遠アーティスト検知）。
  // 未設定・0 の場合は無効。
  staleNotifyDays?: number;
}

// resolveReactionEmojis 未設定時のデフォルト
export const DEFAULT_RESOLVE_EMOJIS = ["✅"];

/**
 * 設定から「対応済み」リアクションの一覧を取得（未設定なら ✅ のみ）
 */
export function resolveEmojisOf(monitor: ReplyMonitorConfig): string[] {
  const emojis = (monitor.resolveReactionEmojis ?? [])
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  return emojis.length > 0 ? emojis : DEFAULT_RESOLVE_EMOJIS;
}

export interface GuildConfig {
  // 監視対象のサーバー（ギルド）
  guildId: string;
  guildName: string;

  // このサーバーに問題があったときに通知する先（管理者用サーバー側）の Webhook
  alertWebhookUrl: string;

  // このサーバー内で「公開OK」とみなすチャンネルID
  whitelistChannelIds: string[];

  // 返信忘れ監視の設定（未設定なら監視しない）
  replyMonitor?: ReplyMonitorConfig;
}

/**
 * 環境変数からギルド設定を取得
 * GUILDS_CONFIG: JSON配列形式の文字列
 */
export function getGuilds(guildsConfigJson: string | undefined): GuildConfig[] {
  if (!guildsConfigJson) {
    console.error("GUILDS_CONFIG environment variable is not set");
    return [];
  }

  try {
    const guilds = JSON.parse(guildsConfigJson) as GuildConfig[];
    console.log(`Loaded ${guilds.length} guild(s) from config`);
    return guilds;
  } catch (error) {
    console.error("Failed to parse GUILDS_CONFIG:", error);
    return [];
  }
}
