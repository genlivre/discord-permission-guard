// src/replyMonitor/notifier.test.ts
import { describe, expect, it } from "vitest";
import type { GuildConfig } from "../config";
import type { ChannelReplyState } from "./state";
import {
  buildNotificationMessage,
  elapsedDays,
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

  it("elapsedDays は 24時間単位の切り捨て（ちょうどN日で対象、1ms手前は対象外）", () => {
    expect(elapsedDays("2026-07-28T03:00:00.000Z", now)).toBe(14);
    expect(elapsedDays("2026-07-28T03:00:00.001Z", now)).toBe(13);
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

  it("案内文には設定した対応済みリアクションを表示する（カスタム絵文字は描画形式）", () => {
    const withEmojis: GuildConfig = {
      ...guildConfig,
      replyMonitor: {
        enabled: true,
        staffRoleIds: ["r1"],
        excludedChannelIds: [],
        resolveReactionEmojis: ["✅", "🙆", "party_ok:123456789"],
      },
    };
    const message = buildNotificationMessage(
      { guildConfig: withEmojis, state: { c1: awaitingState } },
      "morning",
      now
    );
    expect(message).toContain("✅ 🙆 <:party_ok:123456789> リアクション");
  });

  it("管理画面の「対応済み」チェックが付いたチャンネルは通知対象外", () => {
    const checked = {
      ...awaitingState,
      latestMessageId: MESSAGE_ID,
      manualCheckMessageId: MESSAGE_ID,
    };
    const message = buildNotificationMessage(
      { guildConfig, state: { c1: checked } },
      "reminder",
      now
    );
    expect(message).toBeNull();
  });

  it("「不問」にしたチャンネルは通知対象外、新しいメッセージが来たら復活する", () => {
    const dismissed = {
      ...awaitingState,
      latestMessageId: MESSAGE_ID,
      dismissedMessageId: MESSAGE_ID,
    };
    expect(
      buildNotificationMessage({ guildConfig, state: { c1: dismissed } }, "reminder", now)
    ).toBeNull();

    const revived = {
      ...dismissed,
      latestMessageId: "9999999999999999999", // 不問後に新着 → 失効
    };
    expect(
      buildNotificationMessage({ guildConfig, state: { c1: revived } }, "reminder", now)
    ).toContain("**1件**");
  });

  it("チェック後に新しいメッセージが来たら再びアラート対象になる", () => {
    const reawakened = {
      ...awaitingState,
      latestMessageId: "9999999999999999999", // チェック時とは別のメッセージ
      manualCheckMessageId: MESSAGE_ID,
    };
    const message = buildNotificationMessage(
      { guildConfig, state: { c1: reawakened } },
      "reminder",
      now
    );
    expect(message).toContain("**1件**");
  });

  describe("基準日時（baselineAt）", () => {
    const baselineConfig: GuildConfig = {
      ...guildConfig,
      replyMonitor: {
        enabled: true,
        staffRoleIds: ["r1"],
        excludedChannelIds: [],
        baselineAt: "2026-08-01T00:00:00.000Z",
      },
    };

    it("基準日時より前に終わっている会話は通知対象外", () => {
      const oldConversation = {
        ...awaitingState,
        awaitingSince: "2023-07-21T04:30:57.291000+00:00",
        latestMessageAt: "2023-07-21T04:31:41.731000+00:00",
      };
      const message = buildNotificationMessage(
        { guildConfig: baselineConfig, state: { c1: oldConversation } },
        "reminder",
        now
      );
      expect(message).toBeNull();
    });

    it("基準日時より後にメッセージがあれば通知対象（自動復活）", () => {
      const revived = {
        ...awaitingState,
        latestMessageAt: "2026-08-10T00:00:00.000Z",
      };
      const message = buildNotificationMessage(
        { guildConfig: baselineConfig, state: { c1: revived } },
        "reminder",
        now
      );
      expect(message).toContain("**1件**");
    });
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

  describe("疎遠通知（staleNotifyDays）", () => {
    const staleConfig: GuildConfig = {
      ...guildConfig,
      replyMonitor: {
        enabled: true,
        staffRoleIds: ["r1"],
        excludedChannelIds: [],
        staleNotifyDays: 14,
      },
    };
    // 20日前にやり取りが止まったチャンネル
    const staleState = state({
      channelName: "artist-tanaka",
      lastHumanMessageAt: "2026-07-22T03:00:00.000Z",
    });

    it("朝サマリーに設定日数以上やり取りのないチャンネルを載せる", () => {
      const message = buildNotificationMessage(
        { guildConfig: staleConfig, state: { c1: staleState } },
        "morning",
        now
      );
      expect(message).toContain("しばらくやり取りのないチャンネル");
      expect(message).toContain("#artist-tanaka");
      expect(message).toContain("最後のやり取りから 20日");
    });

    it("日中リマインドには疎遠チャンネルを載せない", () => {
      const message = buildNotificationMessage(
        { guildConfig: staleConfig, state: { c1: staleState } },
        "reminder",
        now
      );
      expect(message).toBeNull();
    });

    it("設定日数未満のチャンネルは載せない", () => {
      const recent = state({
        lastHumanMessageAt: "2026-08-05T03:00:00.000Z", // 6日前
      });
      const message = buildNotificationMessage(
        { guildConfig: staleConfig, state: { c1: recent } },
        "morning",
        now
      );
      expect(message).not.toContain("しばらくやり取りのないチャンネル");
    });

    it("未返信として列挙済みのチャンネルは疎遠一覧に重複させない", () => {
      const awaitingAndStale = {
        ...awaitingState,
        lastHumanMessageAt: "2026-07-22T03:00:00.000Z",
      };
      const message = buildNotificationMessage(
        { guildConfig: staleConfig, state: { c1: awaitingAndStale } },
        "morning",
        now
      );
      expect(message).toContain("返信待ちのチャンネルが");
      expect(message).not.toContain("しばらくやり取りのないチャンネル");
    });

    it("取得エラー中のチャンネルは疎遠一覧に載せない（古い時刻での誤検知防止）", () => {
      const errored = {
        ...staleState,
        lastError: "Discord API error (messages): 403",
      };
      const message = buildNotificationMessage(
        { guildConfig: staleConfig, state: { c1: errored } },
        "morning",
        now
      );
      expect(message).not.toContain("しばらくやり取りのないチャンネル");
      expect(message).toContain("取得できないチャンネル");
    });

    it("バジェット持ち越し中のチャンネルは疎遠一覧から除外し、未完了を警告する", () => {
      const pending = { ...staleState, pendingRescan: true };
      const message = buildNotificationMessage(
        { guildConfig: staleConfig, state: { c1: pending } },
        "morning",
        now
      );
      expect(message).not.toContain("しばらくやり取りのないチャンネル");
      expect(message).toContain("疎遠チェックのデータ取得が未完了のチャンネルが 1 件");
    });

    it("staleNotifyDays 未設定なら疎遠一覧は出さない", () => {
      const message = buildNotificationMessage(
        { guildConfig, state: { c1: staleState } },
        "morning",
        now
      );
      expect(message).not.toContain("しばらくやり取りのないチャンネル");
    });
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
