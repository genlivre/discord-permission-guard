// src/replyMonitor/statusApi.ts
//
// 未返信状態のレポート組み立てと、管理画面（/admin/reply-status、
// Cloudflare Access 保護下）向けの読み取り API。
// Discord API は呼ばず、KV に保存済みの状態だけを返す（高速・レート制限に無関係）。

import type { GuildConfig } from "../config";
import { elapsedDays } from "./notifier";
import {
  hasValidManualCheck,
  isEffectivelyAwaiting,
  loadGuildReplyState,
  type ChannelReplyState,
  type StateKV,
} from "./state";

function jumpUrl(guildId: string, s: ChannelReplyState): string {
  const messageId = s.awaitingSinceMessageId ?? s.latestMessageId ?? "";
  return `https://discord.com/channels/${guildId}/${s.channelId}/${messageId}`;
}

function channelUrl(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
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
    channelUrl: string;
    // 管理画面で「対応済み」チェックが付いているか
    manualChecked: boolean;
  }>;
  staleChannels: Array<{
    channelId: string;
    channelName: string;
    lastHumanMessageAt: string;
    elapsedDays: number;
    jumpUrl: string;
    channelUrl: string;
  }>;
  errorChannels: Array<{
    channelId: string;
    channelName: string;
    lastError: string;
    lastErrorAt: string | null;
    channelUrl: string;
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

  // 「対応済み」チェックが付いたものも一覧には含め（フラグ付き）、
  // 画面側で絞り込み表示できるようにする。運営の ✅ 済みは従来どおり含めない
  const awaitingChannels = states
    .filter((s) => s.awaitingReply && !s.hasStaffCheck)
    .sort((a, b) => (a.awaitingSince ?? "").localeCompare(b.awaitingSince ?? ""))
    .map((s) => ({
      channelId: s.channelId,
      channelName: s.channelName,
      awaitingSince: s.awaitingSince ?? null,
      latestMessageAt: s.latestMessageAt ?? null,
      jumpUrl: jumpUrl(guildConfig.guildId, s),
      channelUrl: channelUrl(guildConfig.guildId, s.channelId),
      manualChecked: hasValidManualCheck(s),
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
            channelUrl: channelUrl(guildConfig.guildId, s.channelId),
          }))
      : [];

  const errorChannels = states
    .filter((s) => s.lastError)
    .map((s) => ({
      channelId: s.channelId,
      channelName: s.channelName,
      lastError: s.lastError!,
      lastErrorAt: s.lastErrorAt ?? null,
      channelUrl: channelUrl(guildConfig.guildId, s.channelId),
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
 * 全ギルド分の状態レポートを組み立てる（/admin/api/reply-status-all 用）。
 * 認可は呼び出し元（/admin 配下 = Cloudflare Access）に委ねる。
 */
export async function buildAllGuildStatusReports(
  env: StateKV,
  guilds: GuildConfig[]
): Promise<{ generatedAt: string; guilds: GuildStatusReport[] }> {
  const now = new Date();
  const reports: GuildStatusReport[] = [];
  for (const guildConfig of guilds) {
    if (!guildConfig.replyMonitor?.enabled) continue;
    const state = await loadGuildReplyState(env, guildConfig.guildId);
    reports.push(buildGuildStatusReport(guildConfig, state, now));
  }
  return { generatedAt: now.toISOString(), guilds: reports };
}
