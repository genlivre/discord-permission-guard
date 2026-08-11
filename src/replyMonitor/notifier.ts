// src/replyMonitor/notifier.ts
//
// 未返信チャンネルの通知（毎朝サマリー / 日中リマインド）。
// 通知前にポーリングを同期実行して鮮度を確保してから、
// 各ギルドの alertWebhookUrl（管理サーバー側）へ送信する。

import type { GuildConfig } from "../config";
import { sendWebhook } from "../webhook";
import { runReplyPoll, type GuildPollResult, type PollEnv } from "./poller";
import { isEffectivelyAwaiting, type ChannelReplyState } from "./state";

export type NotificationKind = "morning" | "reminder";

// Discord メッセージの 2000 文字制限に収めるための最大表示件数
// （ジャンプリンクが1件あたり約90文字あるため、余裕を持たせて 10 件に抑える）
const MAX_LISTED_CHANNELS = 10;

function jumpUrl(guildId: string, state: ChannelReplyState): string {
  const messageId = state.awaitingSinceMessageId ?? state.latestMessageId ?? "";
  return `https://discord.com/channels/${guildId}/${state.channelId}/${messageId}`;
}

/**
 * 経過時間を「18時間32分」の形式で整形
 */
export function formatElapsed(fromIso: string, now: Date): string {
  const elapsedMs = Math.max(0, now.getTime() - new Date(fromIso).getTime());
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  return `${hours}時間${String(minutes).padStart(2, "0")}分`;
}

/**
 * JST の日付文字列（YYYY-MM-DD）を返す。「前日から持ち越し」判定用。
 */
export function jstDateString(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * 1ギルド分の通知メッセージを組み立てる。
 * リマインドで通知することが無い場合は null を返す。
 */
export function buildNotificationMessage(
  result: GuildPollResult,
  kind: NotificationKind,
  now: Date
): string | null {
  const { guildConfig, state } = result;
  const states = Object.values(state);

  const awaitingList = states
    .filter(isEffectivelyAwaiting)
    .sort((a, b) => (a.awaitingSince ?? "").localeCompare(b.awaitingSince ?? ""));
  const errorList = states.filter((s) => s.lastError);

  // リマインドは 0 件ならノイズを避けて投稿しない（エラーがある場合は投稿する）
  if (kind === "reminder" && awaitingList.length === 0 && errorList.length === 0) {
    return null;
  }

  const lines: string[] = [];
  const todayJst = jstDateString(now);

  if (kind === "morning") {
    lines.push(`📋 **未返信チャンネルサマリー** — ${guildConfig.guildName}`);
  } else {
    lines.push(`⏰ **未返信リマインド** — ${guildConfig.guildName}`);
  }
  lines.push("");

  if (awaitingList.length === 0) {
    lines.push("✅ 未返信のチャンネルはありません。");
  } else {
    lines.push(`返信待ちのチャンネルが **${awaitingList.length}件** あります。`);
    lines.push("");

    const listed = awaitingList.slice(0, MAX_LISTED_CHANNELS);
    listed.forEach((s, i) => {
      const carriedOver =
        s.awaitingSince && jstDateString(new Date(s.awaitingSince)) < todayJst
          ? "（前日から持ち越し）"
          : "";
      const elapsed = s.awaitingSince ? formatElapsed(s.awaitingSince, now) : "-";
      lines.push(
        `${i + 1}. **#${s.channelName}** — 経過 ${elapsed}${carriedOver}`,
        `   ${jumpUrl(guildConfig.guildId, s)}`
      );
    });

    if (awaitingList.length > MAX_LISTED_CHANNELS) {
      lines.push(`   …ほか ${awaitingList.length - MAX_LISTED_CHANNELS} 件`);
    }

    lines.push("");
    lines.push(
      "> 対応不要な場合は、対象の最終メッセージに ✅ リアクションを付けるとアラート対象外になります。"
    );
  }

  if (errorList.length > 0) {
    lines.push("");
    lines.push(
      `⚠️ 取得できないチャンネルが ${errorList.length} 件あります（Bot の閲覧権限を確認してください）: ` +
        errorList.map((s) => `#${s.channelName}`).join(", ")
    );
  }

  return lines.join("\n");
}

/**
 * 返信監視が有効な全ギルドについて、ポーリング → 通知を実行する。
 */
export async function runReplyNotification(
  env: PollEnv,
  guilds: GuildConfig[],
  kind: NotificationKind
): Promise<void> {
  const results = await runReplyPoll(env, guilds);
  const now = new Date();

  for (const result of results) {
    const message = buildNotificationMessage(result, kind, now);
    if (message === null) {
      console.log(
        `[${result.guildConfig.guildName}] no unreplied channels, skipping ${kind} notification.`
      );
      continue;
    }

    try {
      await sendWebhook(result.guildConfig.alertWebhookUrl, message);
      console.log(
        `[${result.guildConfig.guildName}] sent ${kind} reply notification.`
      );
    } catch (e) {
      console.error(
        `Failed to send ${kind} notification for ${result.guildConfig.guildName}`,
        e
      );
    }
  }
}
