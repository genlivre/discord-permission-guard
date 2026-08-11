// src/replyMonitor/poller.ts
//
// アーティスト個別チャンネルの未返信状態を差分ポーリングで更新する。
//
// 呼び出し数がチャンネル総数に比例しないよう、
// /guilds/{id}/channels（1リクエスト）に含まれる last_message_id を
// 前回観測値と比較し、動きのあったチャンネルと未返信継続中のチャンネルだけ
// メッセージを取得する。

import type { Env } from "../discord";
import type { GuildConfig } from "../config";
import {
  fetchChannelMessages,
  fetchGuildChannels,
  fetchGuildMember,
  fetchReactionUsers,
} from "../discord";
import {
  CHECK_EMOJI,
  filterJudgeable,
  hasCheckReaction,
  judgeChannel,
} from "./judge";
import {
  loadGuildReplyState,
  saveGuildReplyState,
  type ChannelReplyState,
  type GuildReplyState,
  type StateKV,
} from "./state";

// 監視対象にするチャンネルタイプ
// 0: GUILD_TEXT, 5: GUILD_NEWS。
// フォーラム(15)はメッセージがスレッド側に付くため対象外（第1フェーズのスコープ外）。
const REPLY_TARGET_CHANNEL_TYPES = new Set<number>([0, 5]);

// メンバーのロールキャッシュ TTL（秒）
const MEMBER_ROLE_CACHE_TTL = 3600;

export type PollEnv = Env & StateKV;

/**
 * ユーザーが運営（staffRoleIds のいずれかを持つメンバー）かどうかの判定器。
 * 同一実行内はメモリ、実行を跨いでは KV（TTL 1時間）でキャッシュする。
 */
class StaffChecker {
  private memo = new Map<string, boolean>();

  constructor(
    private env: PollEnv,
    private guildId: string,
    private staffRoleIds: string[]
  ) {}

  private cacheKey(userId: string): string {
    return `member_roles:${this.guildId}:${userId}`;
  }

  async isStaff(userId: string): Promise<boolean> {
    const memoized = this.memo.get(userId);
    if (memoized !== undefined) return memoized;

    let roles: string[] | null = null;

    const cached = await this.env.CONFIG_KV.get(this.cacheKey(userId));
    if (cached !== null) {
      roles = JSON.parse(cached) as string[];
    } else {
      const member = await fetchGuildMember(this.env, this.guildId, userId);
      roles = member?.roles ?? [];
      await this.env.CONFIG_KV.put(this.cacheKey(userId), JSON.stringify(roles), {
        expirationTtl: MEMBER_ROLE_CACHE_TTL,
      });
    }

    const staff = roles.some((r) => this.staffRoleIds.includes(r));
    this.memo.set(userId, staff);
    return staff;
  }
}

/**
 * 最新メッセージに「運営が付けた ✅」があるかを確認する。
 * reactions フィールドに ✅ が無ければ API を呼ばずに false。
 */
async function hasStaffCheckReaction(
  env: PollEnv,
  channelId: string,
  message: Parameters<typeof hasCheckReaction>[0],
  staffChecker: StaffChecker
): Promise<boolean> {
  if (!hasCheckReaction(message)) return false;

  const users = await fetchReactionUsers(env, channelId, message.id, CHECK_EMOJI);
  for (const user of users) {
    if (user.bot) continue;
    if (await staffChecker.isStaff(user.id)) return true;
  }
  return false;
}

export interface GuildPollResult {
  guildConfig: GuildConfig;
  state: GuildReplyState;
}

/**
 * 1ギルド分の未返信状態を更新して返す。
 */
async function pollGuild(
  env: PollEnv,
  guildConfig: GuildConfig
): Promise<GuildPollResult> {
  const { guildId } = guildConfig;
  const monitor = guildConfig.replyMonitor!;
  const staffChecker = new StaffChecker(env, guildId, monitor.staffRoleIds);

  const channels = await fetchGuildChannels(env, guildId);
  const targets = channels.filter(
    (ch) =>
      REPLY_TARGET_CHANNEL_TYPES.has(ch.type) &&
      !monitor.excludedChannelIds.includes(ch.id)
  );

  const prevState = await loadGuildReplyState(env, guildId);
  const nextState: GuildReplyState = {};
  const now = new Date().toISOString();

  for (const ch of targets) {
    const prev: ChannelReplyState | undefined = prevState[ch.id];
    const observedLastMessageId = ch.last_message_id ?? null;

    // 差分判定: 最新メッセージIDが動いていない・未返信でもない・エラーも無い → 再取得不要
    const unchanged =
      prev !== undefined &&
      prev.lastObservedMessageId === observedLastMessageId &&
      !prev.awaitingReply &&
      !prev.lastError;

    if (unchanged) {
      nextState[ch.id] = { ...prev, channelName: ch.name };
      continue;
    }

    try {
      const messages = await fetchChannelMessages(env, ch.id);

      // 判定対象メッセージの発言者のロールを先に解決してから純粋関数で判定する
      const authorIds = [
        ...new Set(filterJudgeable(messages).map((m) => m.author.id)),
      ];
      const staffMap = new Map<string, boolean>();
      for (const authorId of authorIds) {
        staffMap.set(authorId, await staffChecker.isStaff(authorId));
      }

      const result = judgeChannel(messages, (id) => staffMap.get(id) ?? false);

      if (result.awaiting && result.latestMessage && result.awaitingSinceMessage) {
        const staffCheck = await hasStaffCheckReaction(
          env,
          ch.id,
          result.latestMessage,
          staffChecker
        );

        nextState[ch.id] = {
          channelId: ch.id,
          channelName: ch.name,
          lastObservedMessageId: observedLastMessageId,
          awaitingReply: true,
          awaitingSince: result.awaitingSinceMessage.timestamp,
          awaitingSinceMessageId: result.awaitingSinceMessage.id,
          latestMessageId: result.latestMessage.id,
          latestMessageAt: result.latestMessage.timestamp,
          hasStaffCheck: staffCheck,
          updatedAt: now,
        };
      } else {
        nextState[ch.id] = {
          channelId: ch.id,
          channelName: ch.name,
          lastObservedMessageId: observedLastMessageId,
          awaitingReply: false,
          hasStaffCheck: false,
          updatedAt: now,
        };
      }
    } catch (e) {
      // 403（閲覧権限なし）等でもチャンネル単位で失敗を記録して続行。
      // サイレントな監視漏れが最悪の事故なので、エラーは通知側で可視化する。
      console.error(`Reply poll failed for channel ${ch.id} (${ch.name})`, e);
      nextState[ch.id] = {
        ...(prev ?? {
          channelId: ch.id,
          channelName: ch.name,
          lastObservedMessageId: null,
          awaitingReply: false,
          hasStaffCheck: false,
        }),
        channelName: ch.name,
        lastError: String(e),
        lastErrorAt: now,
        updatedAt: now,
      };
    }
  }

  // 削除・除外されたチャンネルの状態は持ち越さない（nextState に含めない）

  await saveGuildReplyState(env, guildId, nextState);
  return { guildConfig, state: nextState };
}

/**
 * 返信監視が有効な全ギルドをポーリングし、更新後の状態を返す。
 */
export async function runReplyPoll(
  env: PollEnv,
  guilds: GuildConfig[]
): Promise<GuildPollResult[]> {
  const results: GuildPollResult[] = [];

  for (const guildConfig of guilds) {
    if (!guildConfig.replyMonitor?.enabled) continue;

    try {
      results.push(await pollGuild(env, guildConfig));
    } catch (e) {
      console.error(
        `Reply poll failed for guild ${guildConfig.guildName} (${guildConfig.guildId})`,
        e
      );
    }
  }

  return results;
}
