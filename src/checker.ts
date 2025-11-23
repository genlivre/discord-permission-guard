// src/checker.ts

import type { Env } from "./discord";
import type { GuildConfig } from "./config";
import { GUILDS } from "./config";
import { fetchGuildChannels } from "./discord";
import { sendWebhook } from "./webhook";
import type { DiscordChannel, DiscordPermissionOverwrite } from "./types";

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
 * @everyone に ViewChannel が Allow されているかどうかを判定する
 *
 * - permission_overwrites の中から
 *   - id === guildId（@everyone ロールと同じID）
 *   - type === 0（role）
 *   の Overwrite を探す
 * - allow に VIEW_CHANNEL ビットが立っていて、
 *   deny には立っていなければ「公開状態」とみなす
 */
function isOpenToEveryone(channel: DiscordChannel, guildId: string): boolean {
  const overwrites = channel.permission_overwrites ?? [];

  const everyoneOverwrite:
    | DiscordPermissionOverwrite
    | undefined = overwrites.find((o) => o.id === guildId && o.type === 0); // type=0 はロール

  if (!everyoneOverwrite) {
    // 明示的な Allow がない限りここでは問題なしと判断
    return false;
  }

  const allow = BigInt(everyoneOverwrite.allow);
  const deny = BigInt(everyoneOverwrite.deny);

  const isAllowed = (allow & BigInt(VIEW_CHANNEL_BIT)) !== BigInt(0);
  const isDenied = (deny & BigInt(VIEW_CHANNEL_BIT)) !== BigInt(0);

  // Allow が立っていて Deny が立っていなければ「公開」
  return isAllowed && !isDenied;
}

/**
 * 1ギルド分のチャンネルをチェックし、
 * 「@everyone に公開されているのに whitelist に入っていない」
 * チャンネルの一覧を返す
 */
async function checkGuild(
  env: Env,
  guildConfig: GuildConfig
): Promise<PublicChannelInfo[]> {
  const { guildId, whitelistChannelIds } = guildConfig;
  const channels = await fetchGuildChannels(env, guildId);

  const result: PublicChannelInfo[] = [];

  for (const ch of channels) {
    // テキスト/ニュース/フォーラム以外はスキップ
    if (!TARGET_CHANNEL_TYPES.has(ch.type)) continue;

    // ホワイトリスト（公開OKと明示）ならスキップ
    if (whitelistChannelIds.includes(ch.id)) continue;

    if (isOpenToEveryone(ch, guildId)) {
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
 * 各ギルドに対応した通知用 Webhook（管理サーバー側）へ送信する
 */
export async function runPermissionCheck(env: Env): Promise<void> {
  for (const guildConfig of GUILDS) {
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

      // ここで「それぞれの通知チャンネル」を判別している
      // guildConfig.alertWebhookUrl には管理サーバー側の Webhook URL が入っている想定
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
