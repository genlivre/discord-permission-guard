// src/index.ts
import { runPermissionCheck } from "./checker";
import { handleAdminRequest, getConfig, type AdminEnv } from "./admin";
import type { Env as DiscordEnv } from "./discord";

export interface Env extends DiscordEnv {
  CONFIG_KV: KVNamespace;
  GUILDS_CONFIG?: string; // JSON形式のギルド設定（KV未設定時のフォールバック）
}

export default {
  /**
   * Cron Trigger から呼ばれる処理
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    const cron = event.cron;
    console.log("Cron triggered:", cron, "at", new Date().toISOString());

    // KVから設定を取得（なければ環境変数からフォールバック）
    const guilds = await getConfig(env as AdminEnv);

    // 権限チェック（10分毎）
    if (cron === "*/10 * * * *") {
      await runPermissionCheck(env, guilds);
    }
  },

  /**
   * 開発・動作確認用 HTTP エンドポイント
   * - /health で簡易ヘルスチェック
   * - /run で権限チェック手動実行
   * - /admin/* で管理画面
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // 管理画面
    if (url.pathname.startsWith("/admin")) {
      return handleAdminRequest(request, env as AdminEnv);
    }

    // KVから設定を取得
    const guilds = await getConfig(env as AdminEnv);

    if (url.pathname === "/run") {
      await runPermissionCheck(env, guilds);
      return new Response("Completed permission check", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
