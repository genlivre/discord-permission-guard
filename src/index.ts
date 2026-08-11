// src/index.ts
import { runPermissionCheck } from "./checker";
import { handleAdminRequest, getConfig, type AdminEnv } from "./admin";
import { runReplyPoll } from "./replyMonitor/poller";
import { runReplyNotification } from "./replyMonitor/notifier";
import type { Env as DiscordEnv } from "./discord";

export interface Env extends DiscordEnv {
  CONFIG_KV: KVNamespace;
  GUILDS_CONFIG?: string; // JSON形式のギルド設定（KV未設定時のフォールバック）
}

// Cron 式（wrangler.toml の [triggers].crons と一致させること）
// Cloudflare の cron は UTC 基準。
const CRON_PERMISSION_CHECK = "*/10 * * * *"; // 権限チェック + 返信監視ポーリング（10分毎）
const CRON_MORNING_SUMMARY = "45 23 * * *"; // 未返信の朝サマリー（23:45 UTC = 8:45 JST）
const CRON_DAYTIME_REMINDER = "0 6 * * *"; // 未返信の日中リマインド（6:00 UTC = 15:00 JST）

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

    // 権限チェック + 返信監視ポーリング（10分毎）
    if (cron === CRON_PERMISSION_CHECK) {
      await runPermissionCheck(env, guilds);
      await runReplyPoll(env, guilds);
    }

    // 未返信の朝サマリー（8:45 JST・0件でも投稿して死活確認を兼ねる）
    if (cron === CRON_MORNING_SUMMARY) {
      await runReplyNotification(env, guilds, "morning");
    }

    // 未返信の日中リマインド（15:00 JST・0件なら投稿しない）
    if (cron === CRON_DAYTIME_REMINDER) {
      await runReplyNotification(env, guilds, "reminder");
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

    // 返信監視の手動実行（動作確認用）
    // /run-reply           : ポーリングのみ実行し、更新後の状態を JSON で返す
    // /run-reply?kind=morning|reminder : ポーリング + 通知送信まで実行
    if (url.pathname === "/run-reply") {
      const kind = url.searchParams.get("kind");
      if (kind === "morning" || kind === "reminder") {
        await runReplyNotification(env, guilds, kind);
        return new Response(`Completed reply ${kind} notification`, {
          status: 200,
        });
      }
      const results = await runReplyPoll(env, guilds);
      return Response.json(
        results.map((r) => ({
          guildId: r.guildConfig.guildId,
          guildName: r.guildConfig.guildName,
          channels: r.state,
        }))
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};
