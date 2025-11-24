// src/config.ts

export interface GuildConfig {
  // 監視対象のサーバー（ギルド）
  guildId: string;
  guildName: string;

  // このサーバーに問題があったときに通知する先（管理者用サーバー側）の Webhook
  alertWebhookUrl: string;

  // このサーバー内で「公開OK」とみなすチャンネルID
  whitelistChannelIds: string[];
}

export const GUILDS: GuildConfig[] = [
  {
    guildId: "111111111111111111", // 監視対象A
    guildName: "コミュニティA",
    alertWebhookUrl:
      "https://discord.com/api/webhooks/AAA/BBBBBBBBBBBBBBBBBBBB", // 管理サーバーの #alert-a 用Webhook
    whitelistChannelIds: [
      "333333333333333333", // Aサーバーの #お知らせ
      "444444444444444444", // Aサーバーの #ルール
    ],
  },
  {
    guildId: "555555555555555555", // 監視対象B
    guildName: "コミュニティB",
    alertWebhookUrl:
      "https://discord.com/api/webhooks/CCC/DDDDDDDDDDDDDDDDDDDD", // 管理サーバーの #alert-b 用Webhook
    whitelistChannelIds: [
      "777777777777777777", // Bサーバーの #announcements
    ],
  },
];
