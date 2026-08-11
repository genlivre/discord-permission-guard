// src/replyMonitor/statusApi.test.ts
import { describe, expect, it } from "vitest";
import type { GuildConfig } from "../config";
import type { ChannelReplyState } from "./state";
import {
  buildGuildStatusReport,
  handleReplyStatusRequest,
  timingSafeEqual,
  type StatusApiEnv,
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

function makeEnv(token?: string, kvData: Record<string, string> = {}): StatusApiEnv {
  const store = new Map(Object.entries(kvData));
  return {
    REPLY_STATUS_API_TOKEN: token,
    CONFIG_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as unknown as KVNamespace,
  };
}

function req(auth?: string): Request {
  return new Request("https://example.com/api/reply-status", {
    headers: auth ? { Authorization: auth } : {},
  });
}

describe("timingSafeEqual", () => {
  it("一致・不一致・長さ違いを正しく判定する", () => {
    expect(timingSafeEqual("secret", "secret")).toBe(true);
    expect(timingSafeEqual("secret", "secreT")).toBe(false);
    expect(timingSafeEqual("secret", "secret2")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("handleReplyStatusRequest", () => {
  it("トークン未設定なら 404（機能無効）", async () => {
    const res = await handleReplyStatusRequest(
      req("Bearer x"),
      makeEnv(undefined),
      [guildConfig]
    );
    expect(res.status).toBe(404);
  });

  it("トークン不一致・ヘッダー無しは 401", async () => {
    const env = makeEnv("correct-token");
    expect((await handleReplyStatusRequest(req(), env, [guildConfig])).status).toBe(401);
    expect(
      (await handleReplyStatusRequest(req("Bearer wrong"), env, [guildConfig])).status
    ).toBe(401);
  });

  it("正しいトークンなら状態レポートを返す（no-store付き）", async () => {
    const kv = {
      [`reply_state:${GUILD_ID}`]: JSON.stringify({
        [CHANNEL_ID]: state({
          awaitingReply: true,
          awaitingSince: "2026-08-11T00:00:00.000Z",
          awaitingSinceMessageId: "m10",
        }),
      }),
    };
    const env = makeEnv("correct-token", kv);
    const res = await handleReplyStatusRequest(
      req("Bearer correct-token"),
      env,
      [guildConfig]
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { guilds: Array<{ awaitingChannels: unknown[] }> };
    expect(body.guilds).toHaveLength(1);
    expect(body.guilds[0].awaitingChannels).toHaveLength(1);
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
