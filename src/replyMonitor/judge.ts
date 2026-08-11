// src/replyMonitor/judge.ts
//
// 未返信判定の純粋ロジック。
// Discord API に依存しない形に分離してテスト可能にしている。

import type { DiscordMessage, DiscordReaction } from "../types";

// 判定対象にするメッセージタイプ
// 0: DEFAULT（通常メッセージ）, 19: REPLY（返信）
const JUDGEABLE_MESSAGE_TYPES = new Set<number>([0, 19]);

/**
 * 判定対象のメッセージだけに絞り込む。
 * システムメッセージ（ピン留め通知など）と Bot / Webhook の発言は判定に含めない。
 */
export function filterJudgeable(messages: DiscordMessage[]): DiscordMessage[] {
  return messages.filter(
    (m) => JUDGEABLE_MESSAGE_TYPES.has(m.type) && !m.author.bot
  );
}

/**
 * リアクションが設定された「対応済み」絵文字に一致するか。
 * - 標準絵文字: 設定値は絵文字そのもの（例: "✅"）→ emoji.id が null で name が一致
 * - カスタム絵文字: 設定値は "名前:ID" 形式 → emoji.id が ID 部分と一致
 */
export function reactionMatchesEmoji(
  reaction: DiscordReaction,
  emoji: string
): boolean {
  const colonIndex = emoji.lastIndexOf(":");
  if (colonIndex >= 0) {
    return reaction.emoji.id === emoji.slice(colonIndex + 1);
  }
  return reaction.emoji.id === null && reaction.emoji.name === emoji;
}

/**
 * メッセージに付いているリアクションのうち、
 * 「対応済み」絵文字に一致するものを返す（誰が付けたかは見ない）。
 */
export function matchedResolveEmojis(
  message: DiscordMessage,
  resolveEmojis: string[]
): string[] {
  const reactions = message.reactions ?? [];
  return resolveEmojis.filter((emoji) =>
    reactions.some((r) => reactionMatchesEmoji(r, emoji))
  );
}

export interface JudgeResult {
  // 未返信（最新の発言が非運営ユーザーのまま）か
  awaiting: boolean;
  // 未返信の場合: 最新メッセージ（✅ 確認・通知リンクの対象）
  latestMessage?: DiscordMessage;
  // 未返信の場合: 非運営ユーザーの連投の先頭メッセージ（経過時間の起点）
  awaitingSinceMessage?: DiscordMessage;
}

/**
 * チャンネルの直近メッセージ（新しい順）から未返信状態を判定する。
 *
 * - 最新の判定対象メッセージの発言者が運営（isStaff が true）なら返信済み
 * - 非運営なら未返信。連続する非運営発言を遡って先頭を経過時間の起点にする
 *   （limit 件すべて非運営の場合は取得範囲の最古で近似）
 */
export function judgeChannel(
  messagesNewestFirst: DiscordMessage[],
  isStaff: (userId: string) => boolean
): JudgeResult {
  const judgeable = filterJudgeable(messagesNewestFirst);

  if (judgeable.length === 0) {
    return { awaiting: false };
  }

  const latest = judgeable[0];

  if (isStaff(latest.author.id)) {
    return { awaiting: false };
  }

  // 非運営発言の連投を遡る
  let since = latest;
  for (const m of judgeable) {
    if (isStaff(m.author.id)) break;
    since = m;
  }

  return {
    awaiting: true,
    latestMessage: latest,
    awaitingSinceMessage: since,
  };
}
