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
    expect(report.awaitingChannels[0].manualChecked).toBe(false);
    expect(report.awaitingChannels[0].channelUrl).toBe(
      `https://discord.com/channels/${GUILD_ID}/1000000000000000001`
    );
    expect(report.staleChannels.map((c) => c.channelName)).toEqual([
      "artist-checked",
      "artist-stale",
    ]);
    expect(report.errorChannels.map((c) => c.channelName)).toEqual([
      "artist-error",
    ]);
    expect(report.pendingRescanCount).toBe(1);
    expect(report.staleNotifyDays).toBe(14);
    expect(report.errorChannels[0].channelUrl).toBe(
      `https://discord.com/channels/${GUILD_ID}/1000000000000000005`
    );
  });

  it("「対応済み」チェック付きの未返信は manualChecked フラグ付きで一覧に含める", () => {
    const stateMap = {
      checked: state({
        channelId: "1000000000000000007",
        channelName: "artist-manual-checked",
        awaitingReply: true,
        awaitingSince: "2026-08-10T00:00:00.000Z",
        latestMessageId: "m100",
        manualCheckMessageId: "m100",
      }),
      expired: state({
        channelId: "1000000000000000008",
        channelName: "artist-check-expired",
        awaitingReply: true,
        awaitingSince: "2026-08-10T01:00:00.000Z",
        latestMessageId: "m200", // チェック時とは別のメッセージ → 失効
        manualCheckMessageId: "m100",
      }),
    };
    const report = buildGuildStatusReport(guildConfig, stateMap, now);
    const byName = Object.fromEntries(
      report.awaitingChannels.map((c) => [c.channelName, c.manualChecked])
    );
    expect(byName["artist-manual-checked"]).toBe(true);
    expect(byName["artist-check-expired"]).toBe(false);
  });

  it("「不問」中のチャンネルは疎遠一覧にも載せない", () => {
    const stateMap = {
      dismissedStale: state({
        channelId: "1000000000000000012",
        channelName: "artist-dismissed-stale",
        // 未返信ではないが、不問マークが最新メッセージと一致していて有効
        latestMessageId: "m400",
        dismissedMessageId: "m400",
        lastHumanMessageAt: "2026-07-01T00:00:00.000Z", // 41日前 = 疎遠条件は満たす
      }),
    };
    const report = buildGuildStatusReport(guildConfig, stateMap, now);
    expect(report.staleChannels).toHaveLength(0);
    expect(report.dismissedChannels.map((c) => c.channelName)).toEqual([
      "artist-dismissed-stale",
    ]);
  });

  it("「不問」中のチャンネルは未返信一覧から外れ、dismissedChannels に載る", () => {
    const stateMap = {
      dismissed: state({
        channelId: "1000000000000000011",
        channelName: "artist-dismissed",
        awaitingReply: true,
        awaitingSince: "2026-08-10T00:00:00.000Z",
        latestMessageId: "m300",
        dismissedMessageId: "m300",
      }),
    };
    const report = buildGuildStatusReport(guildConfig, stateMap, now);
    expect(report.awaitingChannels).toHaveLength(0);
    expect(report.dismissedChannels.map((c) => c.channelName)).toEqual([
      "artist-dismissed",
    ]);
  });

  it("基準日時より前に終わっている会話は一覧自体に含めない", () => {
    const baselineConfig: GuildConfig = {
      ...guildConfig,
      replyMonitor: {
        ...guildConfig.replyMonitor!,
        baselineAt: "2026-08-01T00:00:00.000Z",
      },
    };
    const stateMap = {
      old: state({
        channelId: "1000000000000000009",
        channelName: "artist-old",
        awaitingReply: true,
        awaitingSince: "2023-07-21T04:30:57.291000+00:00",
        latestMessageAt: "2023-07-21T04:31:41.731000+00:00",
      }),
      recent: state({
        channelId: "1000000000000000010",
        channelName: "artist-recent-awaiting",
        awaitingReply: true,
        awaitingSince: "2026-08-10T00:00:00.000Z",
        latestMessageAt: "2026-08-10T00:00:00.000Z",
      }),
    };
    const report = buildGuildStatusReport(baselineConfig, stateMap, now);
    expect(report.awaitingChannels.map((c) => c.channelName)).toEqual([
      "artist-recent-awaiting",
    ]);
    expect(report.baselineAt).toBe("2026-08-01T00:00:00.000Z");
  });
});
