// src/checker.ts
import type { Env } from "./discord";
import type { GuildConfig } from "./config";
import { GUILDS } from "./config";
import { fetchGuildChannels, sendChannelMessage } from "./discord";
import type { DiscordChannel, DiscordPermissionOverwrite } from "./types";

// Discordの VIEW_CHANNEL ビット値（0x400 = 1024）
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
 * @everyone に ViewChannel が Allow されているかチェック
 *
 * ※簡易判定：
 *   - permission_overwrites の中に
 *     - id が guildId（@everyoneロールと同じID）
 *     - allow に VIEW_CHANNEL ビットが立っている
 *   を「公開状態」とみなす。
 */
function isOpenToEveryone(channel: DiscordChannel, guildId: string): boolean {
  const overwrites = channel.permission_overwrites ?? [];

  const everyoneOverwrite:
    | DiscordPermissionOverwrite
    | undefined = overwrites.find(
    (o) => o.id === guildId && o.type === 0 // type=0 はロール
  );

  if (!everyoneOverwrite) {
    // ここでは「明示的にAllowしている」場合だけを検出したいので、
    // Overwriteがなければ false（=ここでは問題なし）としておく。
    return false;
  }

  const allow = BigInt(everyoneOverwrite.allow);
  const deny = BigInt(everyoneOverwrite.deny);

  const isAllowed = (allow & BigInt(VIEW_CHANNEL_BIT)) !== BigInt(0);
  const isDenied = (deny & BigInt(VIEW_CHANNEL_BIT)) !== BigInt(0);

  // Allowが立っていて、かつDenyされていないなら「公開」とみなす
  return isAllowed && !isDenied;
}

/**
 * 1ギルド分のチャンネルをチェックし、
 * 問題のある（@everyoneに公開されている）チャンネルを返す
 */
async function checkGuild(
  env: Env,
  guildConfig: GuildConfig
): Promise<PublicChannelInfo[]> {
  const { guildId, whitelistChannelIds } = guildConfig;
  const channels = await fetchGuildChannels(env, guildId);

  const result: PublicChannelInfo[] = [];

  for (const ch of channels) {
    if (!TARGET_CHANNEL_TYPES.has(ch.type)) continue; // テキスト系だけ対象
    if (whitelistChannelIds.includes(ch.id)) continue; // ホワイトリスト除外

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
 * 全ギルドをチェックして、問題があればそれぞれの通知チャンネルへ送信
 */
export async function runPermissionCheck(env: Env): Promise<void> {
  for (const guildConfig of GUILDS) {
    try {
      const openChannels = await checkGuild(env, guildConfig);

      if (openChannels.length === 0) {
        // 問題なしなら何もしない（通知しない）
        console.log(
          `[${guildConfig.guildName}] no problematic channels found.`
        );
        continue;
      }

      // 通知メッセージを組み立てる
      const lines: string[] = [];
      lines.push(
        `🚨 **公開状態の可能性があるチャンネルを検出しました**`,
        ``,
        `サーバー: **${guildConfig.guildName}** (${guildConfig.guildId})`,
        `検出数: ${openChannels.length}`,
        ``
      );

      for (const ch of openChannels) {
        const topic = ch.topic ? `\n    トピック: ${ch.topic}` : "";
        lines.push(`- <#${ch.id}> (\`${ch.id}\`)${topic}`);
      }

      lines.push(
        ``,
        `> 公開で問題ないチャンネルの場合は、ホワイトリスト設定（config.ts）にチャンネルIDを追加してください。`
      );

      const message = lines.join("\n");

      await sendChannelMessage(env, guildConfig.alertChannelId, message);

      console.log(
        `[${guildConfig.guildName}] reported ${openChannels.length} channels.`
      );
    } catch (e) {
      console.error(
        `Error while checking guild ${guildConfig.guildName} (${guildConfig.guildId})`,
        e
      );
    }
  }
}
