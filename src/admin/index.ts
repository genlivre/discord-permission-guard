// src/admin/index.ts
import { renderAdminPage } from "./html";
import {
  getConfig,
  saveConfig,
  fetchBotGuilds,
  fetchChannelsWithCategories,
  fetchRolesList,
  type AdminEnv,
} from "./api";
import type { GuildConfig } from "../config";

/**
 * /admin 配下のリクエストをハンドル
 */
export async function handleAdminRequest(
  request: Request,
  env: AdminEnv
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS ヘッダー（ローカル開発用）
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 管理画面 HTML
    if (path === "/admin" || path === "/admin/") {
      return new Response(renderAdminPage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // API: 設定取得
    if (path === "/admin/api/config" && request.method === "GET") {
      const config = await getConfig(env);
      return Response.json(config, { headers: corsHeaders });
    }

    // API: 設定保存
    if (path === "/admin/api/config" && request.method === "PUT") {
      const config = (await request.json()) as GuildConfig[];
      await saveConfig(env, config);
      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // API: ボットが参加しているギルド一覧
    if (path === "/admin/api/guilds" && request.method === "GET") {
      const guilds = await fetchBotGuilds(env);
      return Response.json(guilds, { headers: corsHeaders });
    }

    // API: ギルドのチャンネル一覧
    const channelsMatch = path.match(/^\/admin\/api\/guilds\/(\d+)\/channels$/);
    if (channelsMatch && request.method === "GET") {
      const guildId = channelsMatch[1];
      const channels = await fetchChannelsWithCategories(env, guildId);
      return Response.json(channels, { headers: corsHeaders });
    }

    // API: ギルドのロール一覧
    const rolesMatch = path.match(/^\/admin\/api\/guilds\/(\d+)\/roles$/);
    if (rolesMatch && request.method === "GET") {
      const guildId = rolesMatch[1];
      const roles = await fetchRolesList(env, guildId);
      return Response.json(roles, { headers: corsHeaders });
    }

    return new Response("Not Found", { status: 404 });
  } catch (error) {
    console.error("Admin API error:", error);
    return Response.json(
      { error: String(error) },
      { status: 500, headers: corsHeaders }
    );
  }
}

// KVから設定を取得するヘルパーをエクスポート
export { getConfig } from "./api";
export type { AdminEnv } from "./api";
