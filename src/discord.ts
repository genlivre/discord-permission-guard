// src/discord.ts
import type { DiscordChannel } from "./types";

export interface Env {
  DISCORD_BOT_TOKEN: string;
}

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function discordFetch(
  env: Env,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const headers: HeadersInit = {
    Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  };

  return fetch(DISCORD_API_BASE + path, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * ギルド内の全チャンネルを取得
 */
export async function fetchGuildChannels(
  env: Env,
  guildId: string
): Promise<DiscordChannel[]> {
  const res = await discordFetch(env, `/guilds/${guildId}/channels`, {
    method: "GET",
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed to fetch channels", guildId, res.status, text);
    throw new Error(`Discord API error: ${res.status}`);
  }

  const data = (await res.json()) as DiscordChannel[];
  return data;
}

/**
 * テキストチャンネルへメッセージを送信
 */
export async function sendChannelMessage(
  env: Env,
  channelId: string,
  content: string
): Promise<void> {
  const res = await discordFetch(env, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed to send message", channelId, res.status, text);
    throw new Error(`Discord API error (send message): ${res.status}`);
  }
}
