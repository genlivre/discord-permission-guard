// src/admin/index.ts
import { renderAdminPage } from "./html";
import { renderReplyStatusPage } from "./replyStatusPage";
import { buildAllGuildStatusReports } from "../replyMonitor/statusApi";
import { saveGuildReplyState } from "../replyMonitor/state";
import {
  getConfig,
  saveConfig,
  validateConfig,
  fetchBotGuilds,
  fetchChannelsWithCategories,
  fetchRolesList,
  type AdminEnv,
} from "./api";
import type { GuildConfig } from "../config";
import { loadGuildReplyState } from "../replyMonitor/state";

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

    // 未返信チェックページ（毎朝の定例での指差し確認用）
    if (path === "/admin/reply-status") {
      return new Response(renderReplyStatusPage(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // API: 全ギルドの未返信状態（上記ページ用）
    if (path === "/admin/api/reply-status-all" && request.method === "GET") {
      const config = await getConfig(env);
      const report = await buildAllGuildStatusReports(env, config);
      return Response.json(report, {
        headers: { ...corsHeaders, "Cache-Control": "no-store" },
      });
    }

    // API: 「対応済み」チェックの付け外し
    // チェックはその時点の最新メッセージIDに紐づき、新着メッセージで自動失効する
    if (path === "/admin/api/reply-check" && request.method === "POST") {
      const body = (await request.json()) as {
        guildId?: string;
        channelId?: string;
        checked?: boolean;
      };
      if (!/^\d{17,20}$/.test(body.guildId ?? "") || !/^\d{17,20}$/.test(body.channelId ?? "")) {
        return Response.json({ error: "invalid id" }, { status: 400, headers: corsHeaders });
      }

      const state = await loadGuildReplyState(env, body.guildId!);
      const entry = state[body.channelId!];
      if (!entry) {
        return Response.json({ error: "channel state not found" }, { status: 404, headers: corsHeaders });
      }

      if (body.checked) {
        entry.manualCheckMessageId = entry.latestMessageId ?? entry.lastObservedMessageId ?? undefined;
      } else {
        delete entry.manualCheckMessageId;
      }
      await saveGuildReplyState(env, body.guildId!, state);
      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // API: 基準日時の設定・クリア
    // set: 現在時刻を基準にし、それより前に終わっている会話を一括で不問にする
    // clear: 基準を解除してすべてを対象に戻す
    if (path === "/admin/api/reply-baseline" && request.method === "POST") {
      const body = (await request.json()) as {
        guildId?: string;
        action?: "set" | "clear";
      };
      if (!/^\d{17,20}$/.test(body.guildId ?? "")) {
        return Response.json({ error: "invalid id" }, { status: 400, headers: corsHeaders });
      }

      const config = await getConfig(env);
      const guild = config.find((g) => g.guildId === body.guildId);
      if (!guild?.replyMonitor) {
        return Response.json({ error: "guild not found" }, { status: 404, headers: corsHeaders });
      }

      if (body.action === "clear") {
        delete guild.replyMonitor.baselineAt;
      } else {
        guild.replyMonitor.baselineAt = new Date().toISOString();
      }
      await saveConfig(env, config);
      return Response.json(
        { success: true, baselineAt: guild.replyMonitor.baselineAt ?? null },
        { headers: corsHeaders }
      );
    }

    // API: チャンネルを監視対象外にする（除外リストへ追加 + 状態を削除）
    if (path === "/admin/api/reply-exclude" && request.method === "POST") {
      const body = (await request.json()) as {
        guildId?: string;
        channelId?: string;
      };
      if (!/^\d{17,20}$/.test(body.guildId ?? "") || !/^\d{17,20}$/.test(body.channelId ?? "")) {
        return Response.json({ error: "invalid id" }, { status: 400, headers: corsHeaders });
      }

      const config = await getConfig(env);
      const guild = config.find((g) => g.guildId === body.guildId);
      if (!guild?.replyMonitor) {
        return Response.json({ error: "guild not found" }, { status: 404, headers: corsHeaders });
      }
      if (!guild.replyMonitor.excludedChannelIds.includes(body.channelId!)) {
        guild.replyMonitor.excludedChannelIds.push(body.channelId!);
        await saveConfig(env, config);
      }

      const state = await loadGuildReplyState(env, body.guildId!);
      if (state[body.channelId!]) {
        delete state[body.channelId!];
        await saveGuildReplyState(env, body.guildId!, state);
      }
      return Response.json({ success: true }, { headers: corsHeaders });
    }

    // API: 設定取得
    if (path === "/admin/api/config" && request.method === "GET") {
      const config = await getConfig(env);
      return Response.json(config, { headers: corsHeaders });
    }

    // API: 設定保存
    if (path === "/admin/api/config" && request.method === "PUT") {
      const config = (await request.json()) as GuildConfig[];
      const validationError = validateConfig(config);
      if (validationError !== null) {
        return Response.json(
          { error: validationError },
          { status: 400, headers: corsHeaders }
        );
      }
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

    // API: ギルドの未返信状態（返信忘れ監視の現況確認用）
    const replyStateMatch = path.match(
      /^\/admin\/api\/guilds\/(\d+)\/reply-status$/
    );
    if (replyStateMatch && request.method === "GET") {
      const guildId = replyStateMatch[1];
      const state = await loadGuildReplyState(env, guildId);
      return Response.json(state, { headers: corsHeaders });
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
