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

  // 最後に観測した「人間の発言」（運営・アーティスト問わず）の時刻。
  // 疎遠アーティスト検知（staleNotifyDays）に使う
  lastHumanMessageAt?: string; // ISO8601
  // 最新メッセージに運営の ✅ リアクションが付いているか（付いていればアラート対象外）
  hasStaffCheck: boolean;

  // 管理画面（/admin/reply-status）で「対応済み」チェックを付けた時点の
  // 最新メッセージID。latestMessageId と一致している間だけ有効で、
  // 新しいメッセージが来る（IDが変わる）と自動的に未対応へ戻る
  manualCheckMessageId?: string;

  // 直近のポーリングエラー（403 = Bot に閲覧権限がない 等）
  lastError?: string;
  lastErrorAt?: string; // ISO8601

  // 判定時の設定（運営ロール・対応済み絵文字）のバージョン。
  // 設定変更後は last_message_id が動かなくても再判定させるために使う。
  configVersion?: string;

  // API バジェット超過で今回の再判定（設定変更後の再取得含む）が持ち越された。
  // 疎遠一覧の完全性が保証できないことを通知側で可視化するために使う
  pendingRescan?: boolean;

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
 * 管理画面の「対応済み」チェックが現在も有効か
 * （チェック後に新しいメッセージが来ていないか）。
 */
export function hasValidManualCheck(state: ChannelReplyState): boolean {
  return (
    state.manualCheckMessageId !== undefined &&
    state.manualCheckMessageId === state.latestMessageId
  );
}

/**
 * アラート対象（実効未返信）かどうか。
 * 未返信かつ、運営の ✅ も管理画面の「対応済み」チェックも付いておらず、
 * 基準日時（baselineAt）より後にメッセージがあるもの。
 * 基準日時より前に終わっている会話は「不問」扱い（新着が来れば自動復活）。
 */
export function isEffectivelyAwaiting(
  state: ChannelReplyState,
  baselineAt?: string
): boolean {
  if (!state.awaitingReply || state.hasStaffCheck || hasValidManualCheck(state)) {
    return false;
  }
  if (baselineAt && state.latestMessageAt) {
    const baseline = Date.parse(baselineAt);
    const latest = Date.parse(state.latestMessageAt);
    if (!Number.isNaN(baseline) && !Number.isNaN(latest) && latest < baseline) {
      return false;
    }
  }
  return true;
}
