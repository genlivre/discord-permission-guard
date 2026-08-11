// src/replyMonitor/poller.test.ts
//
// pollGuild / runReplyPoll の統合テスト（Discord API をモック、KV はフェイク実装）

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordChannel, DiscordMessage } from "../types";
import type { GuildConfig } from "../config";

vi.mock("../discord", () => ({
  fetchGuildChannels: vi.fn(),
  fetchChannelMessages: vi.fn(),
  fetchGuildMember: vi.fn(),
  fetchReactionUsers: vi.fn(),
}));

import {
  fetchChannelMessages,
  fetchGuildChannels,
  fetchGuildMember,
  fetchReactionUsers,
} from "../discord";
import { runReplyPoll, type PollEnv } from "./poller";
import type { GuildReplyState } from "./state";

const GUILD_ID = "1234567890123456789";
const CHANNEL_ID = "9876543210987654321";
const STAFF_ROLE = "1111111111111111111";
const STAFF_ID = "2222222222222222222";
const ARTIST_ID = "3333333333333333333";

const guildConfig: GuildConfig = {
  guildId: GUILD_ID,
  guildName: "テストサーバー",
  alertWebhookUrl: "https://discord.com/api/webhooks/x",
  whitelistChannelIds: [],
  replyMonitor: {
    enabled: true,
    staffRoleIds: [STAFF_ROLE],
    excludedChannelIds: [],
  },
};

// Map ベースの簡易 KV フェイク
function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

function channel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    id: CHANNEL_ID,
    type: 0,
    name: "artist-yamada",
    last_message_id: "5000",
    ...overrides,
  };
}

let seq = 9000;
function msg(
  authorId: string,
  overrides: Partial<DiscordMessage> = {}
): DiscordMessage {
  seq += 1;
  return {
    id: String(seq),
    type: 0,
    author: { id: authorId },
    timestamp: new Date(1700000000000 + seq * 60000).toISOString(),
    ...overrides,
  };
}

function makeEnv(): PollEnv {
  return { DISCORD_BOT_TOKEN: "token", CONFIG_KV: fakeKV() };
}

async function seedState(env: PollEnv, state: GuildReplyState): Promise<void> {
  await env.CONFIG_KV.put(`reply_state:${GUILD_ID}`, JSON.stringify(state));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchGuildMember).mockImplementation(async (_env, _guild, userId) =>
    userId === STAFF_ID ? { roles: [STAFF_ROLE] } : { roles: [] }
  );
  vi.mocked(fetchReactionUsers).mockResolvedValue([]);
});

describe("runReplyPoll", () => {
  it("最新がアーティスト発言なら未返信として記録する", async () => {
    const env = makeEnv();
    vi.mocked(fetchGuildChannels).mockResolvedValue([channel()]);
    vi.mocked(fetchChannelMessages).mockResolvedValue([
      msg(ARTIST_ID),
      msg(STAFF_ID),
    ]);

    const [result] = await runReplyPoll(env, [guildConfig]);
    const state = result.state[CHANNEL_ID];
    expect(result.error).toBeUndefined();
    expect(state.awaitingReply).toBe(true);
    expect(state.hasStaffCheck).toBe(false);
  });

  it("最新が運営発言なら返信済みとして記録する", async () => {
    const env = makeEnv();
    vi.mocked(fetchGuildChannels).mockResolvedValue([channel()]);
    vi.mocked(fetchChannelMessages).mockResolvedValue([
      msg(STAFF_ID),
      msg(ARTIST_ID),
    ]);

    const [result] = await runReplyPoll(env, [guildConfig]);
    expect(result.state[CHANNEL_ID].awaitingReply).toBe(false);
  });

  it("直近50件がBot投稿で埋まっても未返信状態を解除しない（検知漏れ防止）", async () => {
    const env = makeEnv();
    await seedState(env, {
      [CHANNEL_ID]: {
        channelId: CHANNEL_ID,
        channelName: "artist-yamada",
        lastObservedMessageId: "4000",
        awaitingReply: true,
        awaitingSince: "2026-08-10T00:00:00.000Z",
        awaitingSinceMessageId: "3999",
        hasStaffCheck: false,
        updatedAt: "2026-08-10T00:10:00.000Z",
      },
    });

    vi.mocked(fetchGuildChannels).mockResolvedValue([channel()]);
    // limit と同数の Bot メッセージ = 履歴を遡り切れていない
    vi.mocked(fetchChannelMessages).mockResolvedValue(
      Array.from({ length: 50 }, () =>
        msg("bot-1", { author: { id: "bot-1", bot: true } })
      )
    );

    const [result] = await runReplyPoll(env, [guildConfig]);
    const state = result.state[CHANNEL_ID];
    expect(state.awaitingReply).toBe(true);
    expect(state.awaitingSince).toBe("2026-08-10T00:00:00.000Z");
    expect(state.lastError).toBeTruthy();
  });

  it("未返信継続中は前回の経過時間起点を引き継ぐ", async () => {
    const env = makeEnv();
    await seedState(env, {
      [CHANNEL_ID]: {
        channelId: CHANNEL_ID,
        channelName: "artist-yamada",
        lastObservedMessageId: "4000",
        awaitingReply: true,
        awaitingSince: "2020-01-01T00:00:00.000Z", // 新しい取得結果より古い
        awaitingSinceMessageId: "100",
        hasStaffCheck: false,
        updatedAt: "2026-08-10T00:10:00.000Z",
      },
    });

    vi.mocked(fetchGuildChannels).mockResolvedValue([channel()]);
    vi.mocked(fetchChannelMessages).mockResolvedValue([msg(ARTIST_ID)]);

    const [result] = await runReplyPoll(env, [guildConfig]);
    expect(result.state[CHANNEL_ID].awaitingSince).toBe(
      "2020-01-01T00:00:00.000Z"
    );
  });

  it("ギルド単位の失敗は error 付きの結果として返す（通知側で可視化するため）", async () => {
    const env = makeEnv();
    vi.mocked(fetchGuildChannels).mockRejectedValue(
      new Error("Discord API error: 500")
    );

    const results = await runReplyPoll(env, [guildConfig]);
    expect(results).toHaveLength(1);
    expect(results[0].error).toContain("500");
    expect(results[0].state).toEqual({});
  });

  it("変化のないチャンネルはメッセージ取得をスキップする（差分ポーリング）", async () => {
    const env = makeEnv();
    vi.mocked(fetchGuildChannels).mockResolvedValue([channel()]);
    vi.mocked(fetchChannelMessages).mockResolvedValue([
      msg(STAFF_ID),
      msg(ARTIST_ID),
    ]);

    // 1回目: 取得して返信済みになる
    await runReplyPoll(env, [guildConfig]);
    expect(vi.mocked(fetchChannelMessages)).toHaveBeenCalledTimes(1);

    // 2回目: last_message_id が同じなのでスキップ
    await runReplyPoll(env, [guildConfig]);
    expect(vi.mocked(fetchChannelMessages)).toHaveBeenCalledTimes(1);
  });

  it("運営ロール設定が変わったら last_message_id が同じでも再判定する", async () => {
    const env = makeEnv();
    vi.mocked(fetchGuildChannels).mockResolvedValue([channel()]);
    vi.mocked(fetchChannelMessages).mockResolvedValue([msg(STAFF_ID)]);

    await runReplyPoll(env, [guildConfig]);
    expect(vi.mocked(fetchChannelMessages)).toHaveBeenCalledTimes(1);

    const changedConfig: GuildConfig = {
      ...guildConfig,
      replyMonitor: {
        ...guildConfig.replyMonitor!,
        staffRoleIds: ["4444444444444444444"],
      },
    };
    await runReplyPoll(env, [changedConfig]);
    expect(vi.mocked(fetchChannelMessages)).toHaveBeenCalledTimes(2);
  });

  it("運営の対応済みリアクションが付いていれば hasStaffCheck になる", async () => {
    const env = makeEnv();
    vi.mocked(fetchGuildChannels).mockResolvedValue([channel()]);
    vi.mocked(fetchChannelMessages).mockResolvedValue([
      msg(ARTIST_ID, {
        reactions: [{ count: 1, emoji: { id: null, name: "✅" } }],
      }),
    ]);
    vi.mocked(fetchReactionUsers).mockResolvedValue([{ id: STAFF_ID }]);

    const [result] = await runReplyPoll(env, [guildConfig]);
    const state = result.state[CHANNEL_ID];
    expect(state.awaitingReply).toBe(true);
    expect(state.hasStaffCheck).toBe(true);
  });

  it("除外チャンネルとフォーラムは監視対象にしない", async () => {
    const env = makeEnv();
    const excluded = channel({ id: "8888888888888888888", name: "staff-room" });
    const forum = channel({ id: "7777777777777777777", type: 15 });
    vi.mocked(fetchGuildChannels).mockResolvedValue([excluded, forum]);

    const config: GuildConfig = {
      ...guildConfig,
      replyMonitor: {
        ...guildConfig.replyMonitor!,
        excludedChannelIds: [excluded.id],
      },
    };
    const [result] = await runReplyPoll(env, [config]);
    expect(Object.keys(result.state)).toHaveLength(0);
    expect(vi.mocked(fetchChannelMessages)).not.toHaveBeenCalled();
  });
});
