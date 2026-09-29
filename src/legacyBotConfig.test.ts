import { describe, expect, it } from "vitest";
import { buildLegacyBotConfig, isAuthorizedLegacyBotRequest } from "./legacyBotConfig";
import type { GuildConfig } from "./config";

describe("buildLegacyBotConfig", () => {
  it("version 38 と同じ選び方で組み立てる（除外は whitelist に倒し、運営ロールはトップレベル、Webhook は alert）", () => {
    const stored = {
      guildId: "g1",
      guildName: "Vtamp",
      alertWebhookUrl: "https://example.com/alert",
      whitelistChannelIds: ["c1", "c2"],
      staffRoleIds: ["r1"],
      replyMonitor: { enabled: true, staffRoleIds: ["other"], excludedChannelIds: ["x"], resolveReactionEmojis: ["✅"] },
    } as unknown as GuildConfig;
    expect(buildLegacyBotConfig([stored])).toEqual([
      {
        guildId: "g1",
        guildName: "Vtamp",
        excludedChannelIds: ["c1", "c2"],
        staffRoleIds: ["r1"],
        staffUserIds: [],
        webhookUrl: "https://example.com/alert",
      },
    ]);
  });

  it("旧来の excludedChannelIds と unansweredWebhookUrl があればそちらを使う", () => {
    const stored = {
      guildId: "g2",
      guildName: "EN",
      alertWebhookUrl: "https://example.com/alert",
      whitelistChannelIds: ["c1"],
      excludedChannelIds: ["e1"],
      staffUserIds: ["u1"],
      unansweredWebhookUrl: "https://example.com/unanswered",
    } as unknown as GuildConfig;
    const [config] = buildLegacyBotConfig([stored]);
    expect(config.excludedChannelIds).toEqual(["e1"]);
    expect(config.staffUserIds).toEqual(["u1"]);
    expect(config.webhookUrl).toBe("https://example.com/unanswered");
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
