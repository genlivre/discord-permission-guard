// src/types.ts

export interface DiscordChannel {
  id: string;
  type: number; // 0=text, 5=news, 15=forum など
  name: string;
  topic?: string | null;
  guild_id?: string;
  parent_id?: string | null;
  // このチャンネルの最新メッセージID（削除済みIDを指す場合もある）
  last_message_id?: string | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
}

export interface DiscordUser {
  id: string;
  username?: string;
  bot?: boolean;
}

export interface DiscordReaction {
  count: number;
  emoji: {
    id: string | null; // カスタム絵文字は ID、標準絵文字は null
    name: string; // 標準絵文字は絵文字そのもの（例: "✅"）
  };
}

export interface DiscordMessage {
  id: string;
  type: number; // 0=DEFAULT, 19=REPLY など
  author: DiscordUser;
  timestamp: string; // ISO8601
  reactions?: DiscordReaction[];
}

export interface DiscordGuildMember {
  user?: DiscordUser;
  roles: string[]; // ロールIDの配列
}

export interface DiscordPermissionOverwrite {
  id: string; // role or user id
  type: number; // 0=role, 1=member
  allow: string; // bitfield string
  deny: string; // bitfield string
}

export interface DiscordRole {
  id: string;
  name: string;
  permissions: string; // bitfield string
  position: number;
  color: number;
}

