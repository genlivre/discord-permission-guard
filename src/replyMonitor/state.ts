// src/replyMonitor/state.ts
//
// 未返信状態の KV 保存。
// KV キー: reply_state:{guildId} → Record<channelId, ChannelReplyState>

export interface ChannelReplyState {
  channelId: string;
  channelName: string;

  // 前回観測したチャンネルの last_message_id（差分検出用カーソル）
  lastObservedMessageId: string | null;

  // 未返信（最新の判定対象メッセージが非運営の発言）か
  awaitingReply: boolean;
  // 未返信の起点（非運営の連投の先頭メッセージ）
  awaitingSince?: string; // ISO8601
  awaitingSinceMessageId?: string;
  // 最新の判定対象メッセージ（✅ 確認とジャンプリンクの対象）
  latestMessageId?: string;
  latestMessageAt?: string; // ISO8601
  // 最新メッセージに運営の ✅ リアクションが付いているか（付いていればアラート対象外）
  hasStaffCheck: boolean;

  // 直近のポーリングエラー（403 = Bot に閲覧権限がない 等）
  lastError?: string;
  lastErrorAt?: string; // ISO8601

  // 判定時の設定（運営ロール・対応済み絵文字）のバージョン。
  // 設定変更後は last_message_id が動かなくても再判定させるために使う。
  configVersion?: string;

  updatedAt: string; // ISO8601
}

export type GuildReplyState = Record<string, ChannelReplyState>;

export interface StateKV {
  CONFIG_KV: KVNamespace;
}

function stateKey(guildId: string): string {
  return `reply_state:${guildId}`;
}

export async function loadGuildReplyState(
  env: StateKV,
  guildId: string
): Promise<GuildReplyState> {
  const stored = await env.CONFIG_KV.get(stateKey(guildId));
  if (!stored) return {};
  try {
    return JSON.parse(stored) as GuildReplyState;
  } catch (e) {
    console.error("Failed to parse reply state, resetting", guildId, e);
    return {};
  }
}

export async function saveGuildReplyState(
  env: StateKV,
  guildId: string,
  state: GuildReplyState
): Promise<void> {
  await env.CONFIG_KV.put(stateKey(guildId), JSON.stringify(state));
}

/**
 * アラート対象（実効未返信）かどうか。
 * 未返信かつ、最新メッセージに運営の ✅ が付いていないもの。
 */
export function isEffectivelyAwaiting(state: ChannelReplyState): boolean {
  return state.awaitingReply && !state.hasStaffCheck;
}
