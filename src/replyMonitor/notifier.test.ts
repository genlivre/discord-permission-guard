// src/replyMonitor/notifier.test.ts
import { describe, expect, it } from "vitest";
import type { GuildConfig } from "../config";
import type { ChannelReplyState } from "./state";
import {
  buildNotificationMessage,
  formatElapsed,
  jstDateString,
} from "./notifier";

// ID は実際の Discord snowflake と同じ桁数（18〜19桁）で検証する
const GUILD_ID = "1234567890123456789";
const CHANNEL_ID = "9876543210987654321";
const MESSAGE_ID = "1122334455667788990";

const guildConfig: GuildConfig = {
  guildId: GUILD_ID,
  guildName: "テストサーバー",
  alertWebhookUrl: "https://discord.com/api/webhooks/x",
  whitelistChannelIds: [],
  replyMonitor: { enabled: true, staffRoleIds: ["r1"], excludedChannelIds: [] },
};

// 2026-08-11 12:00 JST
const now = new Date("2026-08-11T03:00:00.000Z");

function state(overrides: Partial<ChannelReplyState>): ChannelReplyState {
  return {
    channelId: CHANNEL_ID,
    channelName: "artist-yamada",
    lastObservedMessageId: MESSAGE_ID,
    awaitingReply: false,
    hasStaffCheck: false,
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

const awaitingState = state({
  awaitingReply: true,
  awaitingSince: "2026-08-11T00:00:00.000Z", // 9:00 JST（3時間前）
  awaitingSinceMessageId: MESSAGE_ID,
  latestMessageId: MESSAGE_ID,
});

describe("formatElapsed / jstDateString", () => {
  it("経過時間を 時間・分 で整形する", () => {
    expect(formatElapsed("2026-08-11T00:28:00.000Z", now)).toBe("2時間32分");
    expect(formatElapsed("2026-08-11T02:45:00.000Z", now)).toBe("15分");
  });

  it("JST の日付に変換する（UTC 15:00 以降は翌日になる）", () => {
    expect(jstDateString(new Date("2026-08-10T15:00:00.000Z"))).toBe("2026-08-11");
    expect(jstDateString(new Date("2026-08-10T14:59:00.000Z"))).toBe("2026-08-10");
  });
});

describe("buildNotificationMessage", () => {
  it("朝サマリーは0件でも投稿する（死活確認を兼ねる）", () => {
    const message = buildNotificationMessage(
      { guildConfig, state: { c1: state({}) } },
      "morning",
      now
    );
    expect(message).toContain("未返信のチャンネルはありません");
  });

  it("リマインドは0件なら投稿しない", () => {
    const message = buildNotificationMessage(
      { guildConfig, state: { c1: state({}) } },
      "reminder",
      now
    );
    expect(message).toBeNull();
  });

  it("未返信チャンネルは経過時間とジャンプリンク付きで列挙する", () => {
    const message = buildNotificationMessage(
      { guildConfig, state: { c1: awaitingState } },
      "reminder",
      now
    );
    expect(message).toContain("**1件**");
    expect(message).toContain("#artist-yamada");
    expect(message).toContain("経過 3時間00分");
    expect(message).toContain(
      `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${MESSAGE_ID}`
    );
  });

  it("前日から持ち越した未返信には持ち越しマークを付ける", () => {
    const carried = {
      ...awaitingState,
      awaitingSince: "2026-08-10T05:00:00.000Z", // 前日 14:00 JST
    };
    const message = buildNotificationMessage(
      { guildConfig, state: { c1: carried } },
      "morning",
      now
    );
    expect(message).toContain("（前日から持ち越し）");
  });

  it("運営の ✅ が付いたチャンネルは通知対象外", () => {
    const checked = { ...awaitingState, hasStaffCheck: true };
    const message = buildNotificationMessage(
      { guildConfig, state: { c1: checked } },
      "reminder",
      now
    );
    expect(message).toBeNull();
  });

  it("取得エラーのチャンネルはサマリーに明示する（サイレント監視漏れ防止）", () => {
    const errored = state({
      channelId: "c2",
      channelName: "artist-suzuki",
      lastError: "Discord API error (messages): 403",
    });
    const message = buildNotificationMessage(
      { guildConfig, state: { c2: errored } },
      "morning",
      now
    );
    expect(message).toContain("取得できないチャンネルが 1 件");
    expect(message).toContain("#artist-suzuki");
  });

  it("表示上限を超えた分は件数で表示し、2000文字制限に収まる", () => {
    const many: Record<string, ChannelReplyState> = {};
    for (let i = 0; i < 18; i++) {
      const channelId = `98765432109876${String(54000 + i)}`; // 19桁
      many[channelId] = {
        ...awaitingState,
        channelId,
        channelName: `artist-channel-name-${i}`,
      };
    }
    const message = buildNotificationMessage(
      { guildConfig, state: many },
      "morning",
      now
    );
    expect(message).toContain("ほか 8 件");
    // Discord の content 上限 2000 文字に収まっている
    expect((message ?? "").length).toBeLessThanOrEqual(2000);
  });
});
