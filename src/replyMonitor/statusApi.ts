// src/replyMonitor/statusApi.ts
//
// 未返信状態を外部（v-tamp の admin_menu バックエンド）へ提供する読み取り専用 API。
// Discord API は呼ばず、KV に保存済みの状態だけを返す（高速・レート制限に無関係）。
//
// 認証: Authorization: Bearer <REPLY_STATUS_API_TOKEN>（Worker Secret）。
// このエンドポイントはブラウザから直接叩く想定ではなく、サーバー間通信専用。
// トークン未設定時はエンドポイント自体を無効（404 相当）にする。

import type { GuildConfig } from "../config";
import { elapsedDays } from "./notifier";
import {
  isEffectivelyAwaiting,
  loadGuildReplyState,
  type ChannelReplyState,
  type StateKV,
} from "./state";

export interface StatusApiEnv extends StateKV {
  REPLY_STATUS_API_TOKEN?: string;
}

/** タイミングセーフな文字列比較（トークン照合用） */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function jumpUrl(guildId: string, s: ChannelReplyState): string {
  const messageId = s.awaitingSinceMessageId ?? s.latestMessageId ?? "";
  return `https://discord.com/channels/${guildId}/${s.channelId}/${messageId}`;
}

export interface GuildStatusReport {
  guildId: string;
  guildName: string;
  totalWatchedChannels: number;
  pendingRescanCount: number;
  staleNotifyDays: number | null;
  awaitingChannels: Array<{
    channelId: string;
    channelName: string;
    awaitingSince: string | null;
    latestMessageAt: string | null;
    jumpUrl: string;
  }>;
  staleChannels: Array<{
    channelId: string;
    channelName: string;
    lastHumanMessageAt: string;
    elapsedDays: number;
    jumpUrl: string;
  }>;
  errorChannels: Array<{
    channelId: string;
    channelName: string;
    lastError: string;
    lastErrorAt: string | null;
  }>;
}

/**
 * 1ギルド分の状態レポートを組み立てる（通知と同じ判定基準）。
 */
export function buildGuildStatusReport(
  guildConfig: GuildConfig,
  state: Record<string, ChannelReplyState>,
  now: Date
): GuildStatusReport {
  const states = Object.values(state);
  const staleDays = guildConfig.replyMonitor?.staleNotifyDays ?? 0;

  const awaitingChannels = states
    .filter(isEffectivelyAwaiting)
    .sort((a, b) => (a.awaitingSince ?? "").localeCompare(b.awaitingSince ?? ""))
    .map((s) => ({
      channelId: s.channelId,
      channelName: s.channelName,
      awaitingSince: s.awaitingSince ?? null,
      latestMessageAt: s.latestMessageAt ?? null,
      jumpUrl: jumpUrl(guildConfig.guildId, s),
    }));

  // 疎遠一覧は通知と同じ除外基準（エラー中・持ち越し中・未返信は含めない）
  const staleChannels =
    staleDays > 0
      ? states
          .filter(
            (s) =>
              !s.lastError &&
              !s.pendingRescan &&
              !isEffectivelyAwaiting(s) &&
              s.lastHumanMessageAt !== undefined &&
              elapsedDays(s.lastHumanMessageAt, now) >= staleDays
          )
          .sort((a, b) =>
            (a.lastHumanMessageAt ?? "").localeCompare(b.lastHumanMessageAt ?? "")
          )
          .map((s) => ({
            channelId: s.channelId,
            channelName: s.channelName,
            lastHumanMessageAt: s.lastHumanMessageAt!,
            elapsedDays: elapsedDays(s.lastHumanMessageAt!, now),
            jumpUrl: jumpUrl(guildConfig.guildId, s),
          }))
      : [];

  const errorChannels = states
    .filter((s) => s.lastError)
    .map((s) => ({
      channelId: s.channelId,
      channelName: s.channelName,
      lastError: s.lastError!,
      lastErrorAt: s.lastErrorAt ?? null,
    }));

  return {
    guildId: guildConfig.guildId,
    guildName: guildConfig.guildName,
    totalWatchedChannels: states.length,
    pendingRescanCount: states.filter((s) => s.pendingRescan).length,
    staleNotifyDays: staleDays > 0 ? staleDays : null,
    awaitingChannels,
    staleChannels,
    errorChannels,
  };
}

/**
 * GET /api/reply-status のハンドラー。
 */
export async function handleReplyStatusRequest(
  request: Request,
  env: StatusApiEnv,
  guilds: GuildConfig[]
): Promise<Response> {
  const token = env.REPLY_STATUS_API_TOKEN;
  // トークン未設定 = 機能無効。存在を悟らせないため 404 を返す
  if (!token) {
    return new Response("Not Found", { status: 404 });
  }

  const auth = request.headers.get("Authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEqual(provided, token)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const reports: GuildStatusReport[] = [];
  for (const guildConfig of guilds) {
    if (!guildConfig.replyMonitor?.enabled) continue;
    const state = await loadGuildReplyState(env, guildConfig.guildId);
    reports.push(buildGuildStatusReport(guildConfig, state, now));
  }

  return Response.json(
    { generatedAt: now.toISOString(), guilds: reports },
    // 管理データのためキャッシュさせない
    { headers: { "Cache-Control": "no-store" } }
  );
}
