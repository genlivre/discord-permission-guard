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

  it("最後の人間の発言時刻を lastHumanMessageAt として記録する", async () => {
    const env = makeEnv();
    vi.mocked(fetchGuildChannels).mockResolvedValue([channel()]);
    const staffMsg = msg(STAFF_ID);
    const botMsg = msg("bot-1", { author: { id: "bot-1", bot: true } });
    // 最新が Bot でも、人間の最新発言（運営）の時刻が採用される
    vi.mocked(fetchChannelMessages).mockResolvedValue([botMsg, staffMsg]);

    const [result] = await runReplyPoll(env, [guildConfig]);
    const state = result.state[CHANNEL_ID];
    expect(state.awaitingReply).toBe(false);
    expect(state.lastHumanMessageAt).toBe(staffMsg.timestamp);
  });

  it("APIバジェット超過で持ち越したチャンネルには pendingRescan を立てる", async () => {
    const env = makeEnv();
    // バジェット(40)超過を起こす: guild取得1 + member取得1 + チャンネルごとにメッセージ取得1
    const manyChannels = Array.from({ length: 45 }, (_, i) =>
      channel({
        id: `90000000000000${String(10000 + i)}`,
        name: `artist-${i}`,
      })
    );
    vi.mocked(fetchGuildChannels).mockResolvedValue(manyChannels);
    vi.mocked(fetchChannelMessages).mockResolvedValue([msg(ARTIST_ID)]);

    const [result] = await runReplyPoll(env, [guildConfig]);
    const states = Object.values(result.state);
    const deferred = states.filter((s) => s.pendingRescan);
    const processed = states.filter((s) => !s.pendingRescan);

    expect(deferred.length).toBeGreaterThan(0);
    expect(processed.length).toBeGreaterThan(0);
    expect(deferred.length + processed.length).toBe(45);
    // 持ち越しはエラー扱いにしない（次回実行で自動処理される）
    expect(deferred.every((s) => !s.lastError)).toBe(true);
  });

  it("大規模ギルドがバジェットを使い切っても後続ギルドは独立したバジェットで処理される", async () => {
    const env = makeEnv();
    const GUILD2_ID = "1111111111111111111";
    const guild2Channel = channel({
      id: "6666666666666666666",
      name: "artist-guild2",
    });
    const guild2Config: GuildConfig = {
      ...guildConfig,
      guildId: GUILD2_ID,
      guildName: "第2ギルド",
    };

    vi.mocked(fetchGuildChannels).mockImplementation(async (_env, guildId) =>
      guildId === GUILD2_ID
        ? [guild2Channel]
        : Array.from({ length: 60 }, (_, i) =>
            channel({
              id: `90000000000000${String(20000 + i)}`,
              name: `artist-big-${i}`,
            })
          )
    );
    vi.mocked(fetchChannelMessages).mockResolvedValue([msg(ARTIST_ID)]);

    const results = await runReplyPoll(env, [guildConfig, guild2Config]);

    // ギルド1はバジェット超過で一部持ち越し
    expect(
      Object.values(results[0].state).some((s) => s.pendingRescan)
    ).toBe(true);
    // ギルド2は独立バジェットで正常に処理される（スターブしない）
    expect(results[1].error).toBeUndefined();
    expect(results[1].state[guild2Channel.id].awaitingReply).toBe(true);
  });

  it("REPLY_API_BUDGET_PER_GUILD でバジェットを引き上げられる", async () => {
    const env = { ...makeEnv(), REPLY_API_BUDGET_PER_GUILD: "250" };
    vi.mocked(fetchGuildChannels).mockResolvedValue(
      Array.from({ length: 60 }, (_, i) =>
        channel({
          id: `90000000000000${String(30000 + i)}`,
          name: `artist-${i}`,
        })
      )
    );
    vi.mocked(fetchChannelMessages).mockResolvedValue([msg(ARTIST_ID)]);

    const [result] = await runReplyPoll(env, [guildConfig]);
    // 250 あれば 60 チャンネルは全件処理できる（持ち越しなし）
    expect(
      Object.values(result.state).every((s) => !s.pendingRescan)
    ).toBe(true);
    expect(Object.keys(result.state)).toHaveLength(60);
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
