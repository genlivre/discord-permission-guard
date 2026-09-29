import { describe, expect, it } from "vitest";
import { buildLegacyBotConfig, isAuthorizedLegacyBotRequest } from "./legacyBotConfig";
import type { GuildConfig } from "./config";

describe("buildLegacyBotConfig", () => {
  const guild = (overrides: Record<string, unknown>) =>
    ({
      guildId: "g1",
      guildName: "Vtamp",
      alertWebhookUrl: "https://example.com/alert",
      whitelistChannelIds: ["public1"],
      staffRoleIds: ["legacy-role"],
      unansweredMonitor: { staffRoleIds: ["old"], excludedChannelIds: ["old-ex"] },
      replyMonitor: { enabled: true, staffRoleIds: ["r1", "r2"], excludedChannelIds: ["ex1"], resolveReactionEmojis: ["✅"] },
      ...overrides,
    }) as unknown as GuildConfig;

  it("管理画面の返信忘れ監視（replyMonitor）の運営ロールと監視除外チャンネルを返す", () => {
    expect(buildLegacyBotConfig([guild({})])).toEqual([
      {
        guildId: "g1",
        guildName: "Vtamp",
        excludedChannelIds: ["ex1"],
        staffRoleIds: ["r1", "r2"],
        staffUserIds: [],
        webhookUrl: "https://example.com/alert",
      },
    ]);
  });

  it("返信忘れ監視が無効・未設定のギルドは返さない", () => {
    const disabled = guild({ guildId: "g2", replyMonitor: { enabled: false, staffRoleIds: [], excludedChannelIds: [] } });
    const unset = guild({ guildId: "g3", replyMonitor: undefined });
    expect(buildLegacyBotConfig([guild({}), disabled, unset]).map((g) => g.guildId)).toEqual(["g1"]);
  });
});

describe("isAuthorizedLegacyBotRequest", () => {
  const url = (q: string) => new URL(`https://w.example/api/exclude-channels${q}`);

  it("トークンが一致すれば許可する", () => {
    expect(isAuthorizedLegacyBotRequest(url("?token=abc"), "abc")).toBe(true);
  });

  it("トークンが無い・違う・secret 未設定なら拒否する", () => {
    expect(isAuthorizedLegacyBotRequest(url(""), "abc")).toBe(false);
    expect(isAuthorizedLegacyBotRequest(url("?token=abd"), "abc")).toBe(false);
    expect(isAuthorizedLegacyBotRequest(url("?token=abc"), undefined)).toBe(false);
  });
});
