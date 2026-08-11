// src/replyMonitor/statusApi.test.ts
import { describe, expect, it } from "vitest";
import type { GuildConfig } from "../config";
import type { ChannelReplyState } from "./state";
import type { StateKV } from "./state";
import {
  buildAllGuildStatusReports,
  buildGuildStatusReport,
} from "./statusApi";

const GUILD_ID = "1234567890123456789";
const CHANNEL_ID = "9876543210987654321";

const guildConfig: GuildConfig = {
  guildId: GUILD_ID,
  guildName: "テストサーバー",
  alertWebhookUrl: "https://discord.com/api/webhooks/x",
  whitelistChannelIds: [],
  replyMonitor: {
    enabled: true,
    staffRoleIds: ["1111111111111111111"],
    excludedChannelIds: [],
    staleNotifyDays: 14,
  },
};

const now = new Date("2026-08-11T03:00:00.000Z");

function state(overrides: Partial<ChannelReplyState>): ChannelReplyState {
  return {
    channelId: CHANNEL_ID,
    channelName: "artist-yamada",
    lastObservedMessageId: "m1",
    awaitingReply: false,
    hasStaffCheck: false,
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function makeEnv(kvData: Record<string, string> = {}): StateKV {
  const store = new Map(Object.entries(kvData));
  return {
    CONFIG_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as unknown as KVNamespace,
  };
}

describe("buildAllGuildStatusReports", () => {
  it("返信監視が有効なギルドの状態を KV から集めて返す", async () => {
    const env = makeEnv({
      [`reply_state:${GUILD_ID}`]: JSON.stringify({
        [CHANNEL_ID]: state({
          awaitingReply: true,
          awaitingSince: "2026-08-11T00:00:00.000Z",
          awaitingSinceMessageId: "m10",
        }),
      }),
    });
    const disabledGuild: GuildConfig = {
      ...guildConfig,
      guildId: "1111111111111111111",
      replyMonitor: { enabled: false, staffRoleIds: [], excludedChannelIds: [] },
    };

    const report = await buildAllGuildStatusReports(env, [
      guildConfig,
      disabledGuild,
    ]);

    expect(report.guilds).toHaveLength(1);
    expect(report.guilds[0].awaitingChannels).toHaveLength(1);
    expect(report.generatedAt).toBeTruthy();
  });
});

describe("buildGuildStatusReport", () => {
  it("未返信・疎遠・エラー・持ち越しを通知と同じ基準で分類する", () => {
    const stateMap = {
      awaiting: state({
        channelId: "1000000000000000001",
        channelName: "artist-awaiting",
        awaitingReply: true,
        awaitingSince: "2026-08-10T00:00:00.000Z",
        awaitingSinceMessageId: "m1",
      }),
      resolved: state({
        channelId: "1000000000000000002",
        channelName: "artist-checked",
        awaitingReply: true,
        hasStaffCheck: true, // ✅ 済み → 未返信に含めない
        lastHumanMessageAt: "2026-07-01T00:00:00.000Z", // 41日前 → 疎遠
      }),
      stale: state({
        channelId: "1000000000000000003",
        channelName: "artist-stale",
        lastHumanMessageAt: "2026-07-20T00:00:00.000Z", // 22日前
      }),
      recent: state({
        channelId: "1000000000000000004",
        channelName: "artist-recent",
        lastHumanMessageAt: "2026-08-10T00:00:00.000Z", // 1日前
      }),
      errored: state({
        channelId: "1000000000000000005",
        channelName: "artist-error",
        lastError: "403",
        lastHumanMessageAt: "2026-06-01T00:00:00.000Z", // エラー中 → 疎遠から除外
      }),
      pending: state({
        channelId: "1000000000000000006",
        channelName: "artist-pending",
        pendingRescan: true,
      }),
    };

    const report = buildGuildStatusReport(guildConfig, stateMap, now);

    expect(report.totalWatchedChannels).toBe(6);
    expect(report.awaitingChannels.map((c) => c.channelName)).toEqual([
      "artist-awaiting",
    ]);
    expect(report.staleChannels.map((c) => c.channelName)).toEqual([
      "artist-checked",
      "artist-stale",
    ]);
    expect(report.errorChannels.map((c) => c.channelName)).toEqual([
      "artist-error",
    ]);
    expect(report.pendingRescanCount).toBe(1);
    expect(report.staleNotifyDays).toBe(14);
    expect(report.awaitingChannels[0].jumpUrl).toBe(
      `https://discord.com/channels/${GUILD_ID}/1000000000000000001/m1`
    );
  });
});
