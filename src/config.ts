// src/config.ts

export interface ReplyMonitorConfig {
  // 返信忘れ監視を有効にするか
  enabled: boolean;

  // 「運営メンバー」とみなすロールID。
  // このロールを持たないユーザーの発言が最新のまま放置されると未返信扱いになる。
  staffRoleIds: string[];

  // 返信監視の対象外にするチャンネルID（運営内部チャンネルなど）
  excludedChannelIds: string[];
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
