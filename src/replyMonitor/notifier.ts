// src/replyMonitor/notifier.ts
//
// 未返信チャンネルの通知（毎朝サマリー / 日中リマインド）。
// 通知前にポーリングを同期実行して鮮度を確保してから、
// 各ギルドの alertWebhookUrl（管理サーバー側）へ送信する。

import { resolveEmojisOf, type GuildConfig } from "../config";
import { sendWebhook } from "../webhook";
import { runReplyPoll, type GuildPollResult, type PollEnv } from "./poller";
import { isEffectivelyAwaiting, type ChannelReplyState } from "./state";

export type NotificationKind = "morning" | "reminder";

// Discord メッセージの 2000 文字制限に収めるための最大表示件数
// （ジャンプリンクが1件あたり約90文字あるため、余裕を持たせて 10 件に抑える）
const MAX_LISTED_CHANNELS = 10;

// 取得エラーのチャンネル名の最大表示件数
const MAX_LISTED_ERRORS = 5;

// Discord の content 上限（UTF-16 コード単位）
const DISCORD_CONTENT_LIMIT = 2000;

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
 * 通知文中での絵文字表示。カスタム絵文字（"名前:ID"）は Discord 上で
 * 絵文字として描画される <:名前:ID> 形式にする。
 */
function displayEmoji(emoji: string): string {
  return emoji.includes(":") ? `<:${emoji}>` : emoji;
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
  if (
    kind === "reminder" &&
    awaitingList.length === 0 &&
    errorList.length === 0 &&
    !result.error
  ) {
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

  // ギルド単位でポーリング自体が失敗した場合は障害として必ず可視化する
  // （「0件です」と誤読させない。監視が止まっている状態が最も危険）
  if (result.error) {
    lines.push(
      "🚨 **未返信チェックの実行に失敗しました。** 監視が機能していない可能性があります。",
      `エラー: ${result.error}`
    );
    return truncateForDiscord(lines.join("\n"));
  }

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

    const emojiLabels = resolveEmojisOf(
      guildConfig.replyMonitor ?? {
        enabled: false,
        staffRoleIds: [],
        excludedChannelIds: [],
      }
    )
      .map(displayEmoji)
      .join(" ");
    lines.push("");
    lines.push(
      `> 対応不要な場合は、対象の最終メッセージに ${emojiLabels} リアクションを付けるとアラート対象外になります。`
    );
  }

  if (errorList.length > 0) {
    const listedErrors = errorList
      .slice(0, MAX_LISTED_ERRORS)
      .map((s) => `#${s.channelName}`)
      .join(", ");
    const moreErrors =
      errorList.length > MAX_LISTED_ERRORS
        ? ` ほか ${errorList.length - MAX_LISTED_ERRORS} 件`
        : "";
    lines.push("");
    lines.push(
      `⚠️ 取得できないチャンネルが ${errorList.length} 件あります（Bot の閲覧権限を確認してください）: ${listedErrors}${moreErrors}`
    );
  }

  return truncateForDiscord(lines.join("\n"));
}

/**
 * Discord の content 上限（2000文字）に収める最終保証。
 * 件数制限で通常は超えないが、長いチャンネル名等で超えた場合に切り詰める。
 */
function truncateForDiscord(message: string): string {
  if (message.length <= DISCORD_CONTENT_LIMIT) return message;
  return message.slice(0, DISCORD_CONTENT_LIMIT - 1) + "…";
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
  const sendFailures: string[] = [];

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
      sendFailures.push(`${result.guildConfig.guildName}: ${String(e)}`);
    }
  }

  // Webhook 送信失敗を握りつぶすと Cron が成功扱いになり障害に気づけないため、
  // 最後に集約して例外にする（Cloudflare 側で実行失敗として観測できる）
  if (sendFailures.length > 0) {
    throw new Error(
      `Failed to send ${kind} notification(s): ${sendFailures.join(" / ")}`
    );
  }
}
