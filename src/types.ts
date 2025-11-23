// src/types.ts

export interface DiscordChannel {
  id: string;
  type: number; // 0=text, 5=news, 15=forum など
  name: string;
  topic?: string | null;
  guild_id?: string;
  permission_overwrites?: DiscordPermissionOverwrite[];
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
}
