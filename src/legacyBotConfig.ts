// src/legacyBotConfig.ts
//
// EC2 上で常駐している Rust 製の「Discord Unanswered Messages Monitor Bot」（discord-unanswered-bot）が
// 起動時と定期更新で読む設定 API（/api/exclude-channels）の応答を組み立てる。
//
// この API は 2026-09-20 に別の端末から deploy された版（version 38）にだけ入っていて、
// 2026-09-21 にこのリポジトリから deploy し直した時に消えた。2026-09-29 の EC2 再起動で Bot が起動できなくなり，PR #15 で戻した。
//
// 値は管理画面の「返信忘れ監視」の設定（replyMonitor）から取る（2026-09-29 の運営判断）。
// 管理画面で編集した運営ロール・監視除外チャンネルが，10 分毎の返信監視とリアルタイムの Bot の両方に効く。
// version 38 は公開 OK のホワイトリスト（whitelistChannelIds）とトップレベルの staffRoleIds を返していて，
// 1 月時点の Bot 専用の設定（unansweredMonitor，今の管理画面では編集できない）とも食い違っていた。

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

export function buildLegacyBotConfig(guilds: GuildConfig[]): LegacyBotGuildConfig[] {
  return guilds
    .filter((guild) => guild.replyMonitor?.enabled)
    .map((guild) => ({
      guildId: guild.guildId,
      guildName: guild.guildName,
      excludedChannelIds: guild.replyMonitor?.excludedChannelIds ?? [],
      staffRoleIds: guild.replyMonitor?.staffRoleIds ?? [],
      // 運営をユーザー単位で指定する設定は管理画面に無い（ロールで判定する）
      staffUserIds: [],
      webhookUrl: guild.alertWebhookUrl,
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
