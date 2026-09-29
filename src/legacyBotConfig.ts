// src/legacyBotConfig.ts
//
// EC2 上で常駐している Rust 製の「Discord Unanswered Messages Monitor Bot」（discord-unanswered-bot）が
// 起動時と定期更新で読む設定 API（/api/exclude-channels）の応答を組み立てる。
//
// この API は 2026-09-20 に別の端末から deploy された版（version 38）にだけ入っていて、
// 2026-09-21 にこのリポジトリから deploy し直した時に消えた。Bot は起動済みだった為に止まらず、
// 2026-09-29 に EC2 を再起動した時に「Cannot start without config」で起動できなくなった。
// 応答は version 38 と同じ形・同じ値の選び方にしてある（Bot のソースが手元に無く、9 日間この値で動いていた為）。
//
// Bot 側の型（バイナリから確認）: ApiGuildConfig { guildId, guildName, excludedChannelIds, staffRoleIds, staffUserIds, webhookUrl }

import type { GuildConfig } from "./config";

export interface LegacyBotGuildConfig {
  guildId: string;
  guildName: string;
  excludedChannelIds: string[];
  staffRoleIds: string[];
  staffUserIds: string[];
  webhookUrl: string;
}

// KV のギルド設定には、型に無い旧来の項目（トップレベルの staffRoleIds 等）が残っている
type StoredGuild = GuildConfig & {
  excludedChannelIds?: string[];
  staffRoleIds?: string[];
  staffUserIds?: string[];
  unansweredWebhookUrl?: string;
};

export function buildLegacyBotConfig(guilds: GuildConfig[]): LegacyBotGuildConfig[] {
  return (guilds as StoredGuild[]).map((guild) => ({
    guildId: guild.guildId,
    guildName: guild.guildName,
    // excludedChannelIds が未設定なら whitelistChannelIds を使う（version 38 と同じ）
    excludedChannelIds:
      guild.excludedChannelIds && guild.excludedChannelIds.length > 0
        ? guild.excludedChannelIds
        : guild.whitelistChannelIds ?? [],
    staffRoleIds: guild.staffRoleIds ?? [],
    staffUserIds: guild.staffUserIds ?? [],
    webhookUrl: guild.unansweredWebhookUrl || guild.alertWebhookUrl,
  }));
}

/**
 * 応答には Webhook の URL が含まれる為，トークン（secret LEGACY_BOT_CONFIG_TOKEN）を ?token= で要求する。
 * version 38 は認証無しで公開していた。Bot の CONFIG_API_URL にトークンを付けて呼ばせる。
 * secret が未設定なら常に拒否する（設定漏れで公開状態に戻らない様に）。
 */
export function isAuthorizedLegacyBotRequest(url: URL, expectedToken: string | undefined): boolean {
  if (!expectedToken) return false;
  const given = url.searchParams.get("token") ?? "";
  if (given.length !== expectedToken.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  return diff === 0;
}
