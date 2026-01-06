// src/checker.ts

import type { Env } from "./discord";
import type { GuildConfig } from "./config";
import { fetchGuildChannels, fetchGuildRoles } from "./discord";
import { sendWebhook } from "./webhook";
import type {
  DiscordChannel,
  DiscordPermissionOverwrite,
  DiscordRole,
} from "./types";

// Discord の VIEW_CHANNEL ビット値（0x400 = 1024）
const VIEW_CHANNEL_BIT = 1 << 10; // 1024

// 監視対象にするチャンネルタイプ
// 0: GUILD_TEXT, 5: GUILD_NEWS, 15: GUILD_FORUM など
const TARGET_CHANNEL_TYPES = new Set<number>([0, 5, 15]);

interface PublicChannelInfo {
  id: string;
  name: string;
  topic?: string | null;
}

/**
 * ギルドの @everyone デフォルト権限（baseEveryonePerms）と
 * チャンネルの permission_overwrites を元に、
 * 「このチャンネルが @everyone から見えるか」を判定する。
 */
function isViewableByEveryone(
  channel: DiscordChannel,
  guildId: string,
  baseEveryonePerms: bigint
): boolean {
  // ギルドの @everyone ロールに ViewChannel が付いているか
  const hasBaseView =
    (baseEveryonePerms & BigInt(VIEW_CHANNEL_BIT)) !== BigInt(0);

  const overwrites = channel.permission_overwrites ?? [];

  // このチャンネルに対する @everyone の Overwrite を探す
  const everyoneOverwrite:
    | DiscordPermissionOverwrite
    | undefined = overwrites.find((o) => o.id === guildId && o.type === 0); // type=0 は role

  // Overwrite がなければ、ギルドのデフォルト権限どおり
  if (!everyoneOverwrite) {
    return hasBaseView;
  }

  const allow = BigInt(everyoneOverwrite.allow);
  const deny = BigInt(everyoneOverwrite.deny);

  const denyView = (deny & BigInt(VIEW_CHANNEL_BIT)) !== BigInt(0);
  const allowView = (allow & BigInt(VIEW_CHANNEL_BIT)) !== BigInt(0);

  // Deny が明示されていれば見えない
  if (denyView) return false;
  // Allow が明示されていれば見える
  if (allowView) return true;

  // Allow / Deny どちらも Overwrite に書かれていない場合は、
  // ギルドのデフォルトをそのまま使う。
  return hasBaseView;
}

/**
 * 1ギルド分のチャンネルをチェックし、
 * 「@everyone から見える & whitelist ではない」チャンネル一覧を返す。
 */
async function checkGuild(
  env: Env,
  guildConfig: GuildConfig
): Promise<PublicChannelInfo[]> {
  const { guildId, whitelistChannelIds } = guildConfig;

  // チャンネル一覧とロール一覧を並列に取得
  const [channels, roles] = await Promise.all([
    fetchGuildChannels(env, guildId),
    fetchGuildRoles(env, guildId),
  ]);

  // id === guildId のロールが @everyone
  const everyoneRole: DiscordRole | undefined = roles.find(
    (r) => r.id === guildId
  );

  // @everyone の permissions を BigInt に変換（なければ 0）
  const baseEveryonePerms = everyoneRole
    ? BigInt(everyoneRole.permissions)
    : BigInt(0);

  const result: PublicChannelInfo[] = [];

  for (const ch of channels) {
    // テキスト/ニュース/フォーラム以外はスキップ
    if (!TARGET_CHANNEL_TYPES.has(ch.type)) continue;

    // ホワイトリスト（公開OKと明示）ならスキップ
    if (whitelistChannelIds.includes(ch.id)) continue;

    // @everyone から見えるかどうか判定
    if (isViewableByEveryone(ch, guildId, baseEveryonePerms)) {
      result.push({
        id: ch.id,
        name: ch.name,
        topic: ch.topic,
      });
    }
  }

  return result;
}

/**
 * 全ギルドをチェックして、問題があれば
 * 各ギルドに対応した通知用 Webhook（管理サーバー側）へ送信する。
 */
export async function runPermissionCheck(
  env: Env,
  guilds: GuildConfig[]
): Promise<void> {
  for (const guildConfig of guilds) {
    try {
      const openChannels = await checkGuild(env, guildConfig);

      if (openChannels.length === 0) {
        console.log(
          `[${guildConfig.guildName}] no problematic channels found.`
        );
        continue;
      }

      // 通知メッセージ組み立て
      const lines: string[] = [];
      lines.push(
        `🚨 **公開状態の可能性があるチャンネルを検出しました**`,
        ``,
        `監視対象サーバー: **${guildConfig.guildName}** (${guildConfig.guildId})`,
        `検出数: ${openChannels.length}`,
        ``
      );

      for (const ch of openChannels) {
        const topicLine = ch.topic ? `\n    トピック: ${ch.topic}` : "";
        lines.push(`- <#${ch.id}> (\`${ch.id}\`)${topicLine}`);
      }

      lines.push(
        ``,
        `> 公開で問題ないチャンネルの場合は、このサーバーの whitelist にチャンネルIDを追加してください。`
      );

      const message = lines.join("\n");

      // 通知先 Webhook（管理サーバー側）へ送信
      await sendWebhook(guildConfig.alertWebhookUrl, message);

      console.log(
        `[${guildConfig.guildName}] reported ${openChannels.length} channels via webhook.`
      );
    } catch (e) {
      console.error(
        `Error while checking guild ${guildConfig.guildName} (${guildConfig.guildId})`,
        e
      );
    }
  }
}
