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

// Discord snowflake ID の形式
const SNOWFLAKE = /^\d{17,20}$/;
// カスタム絵文字設定の形式（名前:ID）
const CUSTOM_EMOJI = /^[A-Za-z0-9_]{2,32}:\d{17,20}$/;

/**
 * 保存前の設定バリデーション。
 * ID 値は管理画面の HTML/inline handler へ埋め込まれるため、
 * snowflake 形式を強制することで stored XSS の入口を塞ぐ。
 * 問題があればエラーメッセージ、無ければ null を返す。
 */
export function validateConfig(config: GuildConfig[]): string | null {
  for (const guild of config) {
    if (!SNOWFLAKE.test(guild.guildId)) {
      return `不正なギルドID: ${JSON.stringify(guild.guildId)}`;
    }
    for (const id of guild.whitelistChannelIds ?? []) {
      if (!SNOWFLAKE.test(id)) {
        return `不正なチャンネルID (whitelist): ${JSON.stringify(id)}`;
      }
    }

    const rm = guild.replyMonitor;
    if (!rm) continue;

    for (const id of rm.staffRoleIds ?? []) {
      if (!SNOWFLAKE.test(id)) {
        return `不正なロールID: ${JSON.stringify(id)}`;
      }
    }
    for (const id of rm.excludedChannelIds ?? []) {
      if (!SNOWFLAKE.test(id)) {
        return `不正なチャンネルID (除外): ${JSON.stringify(id)}`;
      }
    }
    if (rm.enabled && (rm.staffRoleIds ?? []).length === 0) {
      return `${guild.guildName}: 返信忘れ監視を有効にするには運営ロールを1つ以上設定してください`;
    }
    if (
      rm.baselineAt !== undefined &&
      Number.isNaN(Date.parse(rm.baselineAt))
    ) {
      return `基準日時が不正です: ${JSON.stringify(rm.baselineAt)}`;
    }
    if (
      rm.staleNotifyDays !== undefined &&
      (!Number.isInteger(rm.staleNotifyDays) ||
        rm.staleNotifyDays < 1 ||
        rm.staleNotifyDays > 365)
    ) {
      return `疎遠通知の日数は 1〜365 の整数で指定してください: ${JSON.stringify(rm.staleNotifyDays)}`;
    }
    const emojis = rm.resolveReactionEmojis ?? [];
    if (emojis.length > 10) {
      return "対応済みリアクションは10個までにしてください";
    }
    for (const emoji of emojis) {
      const trimmed = emoji.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.includes(":")) {
        if (!CUSTOM_EMOJI.test(trimmed)) {
          return `不正なカスタム絵文字形式（名前:ID で指定）: ${JSON.stringify(trimmed)}`;
        }
      } else if (trimmed.length > 16 || /[<>"'&\\]/.test(trimmed)) {
        return `不正な絵文字設定: ${JSON.stringify(trimmed)}`;
      }
    }
  }
  return null;
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
