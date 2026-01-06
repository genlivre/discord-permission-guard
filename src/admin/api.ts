// src/admin/api.ts
import type { Env } from "../discord";
import type { GuildConfig } from "../config";
import { fetchGuildChannels, fetchGuildRoles } from "../discord";

export interface AdminEnv extends Env {
  CONFIG_KV: KVNamespace;
  GUILDS_CONFIG?: string;
}

const CONFIG_KEY = "config:guilds";

/**
 * KVから設定を取得（なければ環境変数から初期化）
 */
export async function getConfig(env: AdminEnv): Promise<GuildConfig[]> {
  const stored = await env.CONFIG_KV.get(CONFIG_KEY);
  if (stored) {
    return JSON.parse(stored) as GuildConfig[];
  }

  // KVにない場合は環境変数から初期化
  if (env.GUILDS_CONFIG) {
    const config = JSON.parse(env.GUILDS_CONFIG) as GuildConfig[];
    await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(config));
    return config;
  }

  return [];
}

/**
 * KVに設定を保存
 */
export async function saveConfig(
  env: AdminEnv,
  config: GuildConfig[]
): Promise<void> {
  await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(config));
}

/**
 * ボットが参加しているサーバー一覧を取得
 */
export async function fetchBotGuilds(
  env: Env
): Promise<{ id: string; name: string; icon: string | null }[]> {
  const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch guilds: ${res.status}`);
  }

  return res.json();
}

/**
 * サーバーのチャンネル一覧（カテゴリ付き）を取得
 */
export async function fetchChannelsWithCategories(
  env: Env,
  guildId: string
): Promise<{
  categories: { id: string; name: string; channels: { id: string; name: string; type: number }[] }[];
  uncategorized: { id: string; name: string; type: number }[];
}> {
  const channels = await fetchGuildChannels(env, guildId);

  // カテゴリ（type=4）を取得
  const categories = new Map<string, { id: string; name: string; channels: { id: string; name: string; type: number }[] }>();
  const uncategorized: { id: string; name: string; type: number }[] = [];

  for (const ch of channels) {
    if (ch.type === 4) {
      categories.set(ch.id, { id: ch.id, name: ch.name, channels: [] });
    }
  }

  for (const ch of channels) {
    if (ch.type === 4) continue; // カテゴリ自体はスキップ
    if (![0, 5, 15].includes(ch.type)) continue; // テキスト系のみ

    const parentId = (ch as { parent_id?: string }).parent_id;
    if (parentId && categories.has(parentId)) {
      categories.get(parentId)!.channels.push({
        id: ch.id,
        name: ch.name,
        type: ch.type,
      });
    } else {
      uncategorized.push({ id: ch.id, name: ch.name, type: ch.type });
    }
  }

  return {
    categories: Array.from(categories.values()),
    uncategorized,
  };
}

/**
 * サーバーのロール一覧を取得
 */
export async function fetchRolesList(
  env: Env,
  guildId: string
): Promise<{ id: string; name: string; color: number; position: number }[]> {
  const roles = await fetchGuildRoles(env, guildId);

  return roles
    .filter((r) => r.name !== "@everyone")
    .sort((a, b) => (b as { position: number }).position - (a as { position: number }).position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: (r as { color: number }).color,
      position: (r as { position: number }).position,
    }));
}
