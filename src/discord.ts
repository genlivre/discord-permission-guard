// src/discord.ts
import type {
  DiscordChannel,
  DiscordGuildMember,
  DiscordMessage,
  DiscordRole,
  DiscordUser,
} from "./types";

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

  const doFetch = () =>
    fetch(DISCORD_API_BASE + path, {
      ...init,
      headers: {
        ...headers,
        ...(init?.headers ?? {}),
      },
    });

  let res = await doFetch();

  // レートリミット (429) は Retry-After を尊重して1回だけリトライ
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
    const waitMs = Math.min(Math.max(retryAfter, 0.5), 10) * 1000;
    console.warn(`Rate limited on ${path}, retrying after ${waitMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    res = await doFetch();
  }

  return res;
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

/**
 * チャンネルの直近メッセージを取得（新しい順）
 */
export async function fetchChannelMessages(
  env: Env,
  channelId: string,
  limit = 20
): Promise<DiscordMessage[]> {
  const res = await discordFetch(
    env,
    `/channels/${channelId}/messages?limit=${limit}`,
    { method: "GET" }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed to fetch messages", channelId, res.status, text);
    throw new Error(`Discord API error (messages): ${res.status}`);
  }

  return (await res.json()) as DiscordMessage[];
}

/**
 * ギルドメンバーを取得（脱退済みなど 404 の場合は null）
 */
export async function fetchGuildMember(
  env: Env,
  guildId: string,
  userId: string
): Promise<DiscordGuildMember | null> {
  const res = await discordFetch(env, `/guilds/${guildId}/members/${userId}`, {
    method: "GET",
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed to fetch member", guildId, userId, res.status, text);
    throw new Error(`Discord API error (member): ${res.status}`);
  }

  return (await res.json()) as DiscordGuildMember;
}

/**
 * メッセージに特定の絵文字リアクションを付けたユーザー一覧を取得
 */
export async function fetchReactionUsers(
  env: Env,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<DiscordUser[]> {
  const encoded = encodeURIComponent(emoji);
  const res = await discordFetch(
    env,
    `/channels/${channelId}/messages/${messageId}/reactions/${encoded}?limit=100`,
    { method: "GET" }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error(
      "Failed to fetch reaction users",
      channelId,
      messageId,
      res.status,
      text
    );
    throw new Error(`Discord API error (reactions): ${res.status}`);
  }

  return (await res.json()) as DiscordUser[];
}

/**
 * ギルド内の全ロールを取得
 */
export async function fetchGuildRoles(
  env: Env,
  guildId: string
): Promise<DiscordRole[]> {
  const res = await discordFetch(env, `/guilds/${guildId}/roles`, {
    method: "GET",
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed to fetch roles", guildId, res.status, text);
    throw new Error(`Discord API error (roles): ${res.status}`);
  }

  const data = (await res.json()) as DiscordRole[];
  return data;
}

