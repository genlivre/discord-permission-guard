// src/index.ts
import { runPermissionCheck } from "./checker";
import type { Env as DiscordEnv } from "./discord";

export interface Env extends DiscordEnv {
  // ここに他の環境変数があれば追加
}

export default {
  /**
   * Cron Trigger から呼ばれる処理
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log("Cron triggered at", new Date().toISOString());
    ctx.waitUntil(runPermissionCheck(env));
  },

  /**
   * 開発・動作確認用 HTTP エンドポイント
   * - /health で簡易ヘルスチェック
   * - /run で手動実行（本番では限定してもOK）
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/run") {
      // 手動実行
      ctx.waitUntil(runPermissionCheck(env));
      return new Response("Started check", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
