// src/config.ts

export interface GuildConfig {
  guildId: string;
  guildName: string; // ログや通知文用のわかりやすい名前
  alertChannelId: string; // 問題検出時に通知を送るチャンネル
  whitelistChannelIds: string[]; // 「ここは公開でもOK」なチャンネルID一覧
}

// ↓ 実際のサーバー情報に書き換える
export const GUILDS: GuildConfig[] = [
  {
    guildId: "111111111111111111",
    guildName: "メインコミュニティ",
    alertChannelId: "222222222222222222",
    whitelistChannelIds: [
      "333333333333333333", // #お知らせ
      "444444444444444444", // #ルール
    ],
  },
  {
    guildId: "555555555555555555",
    guildName: "サブコミュニティ",
    alertChannelId: "666666666666666666",
    whitelistChannelIds: [
      "777777777777777777", // #announcements
    ],
  },
];
