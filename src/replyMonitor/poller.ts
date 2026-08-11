// src/replyMonitor/poller.ts
//
// アーティスト個別チャンネルの未返信状態を差分ポーリングで更新する。
//
// 呼び出し数がチャンネル総数に比例しないよう、
// /guilds/{id}/channels（1リクエスト）に含まれる last_message_id を
// 前回観測値と比較し、動きのあったチャンネルと未返信継続中のチャンネルだけ
// メッセージを取得する。
//
// 注意: Workers KV は結果整合のため、Cron と手動実行（/run-reply）が同時に走ると
// 同一キーへの書き込みが互いに上書きされ得る。状態は毎回 Discord の実データから
// 再計算されるため、最悪でも次回ポーリング（10分後）で自己修復する設計とし、
// Durable Object 等による直列化は現段階では行わない。

import type { Env } from "../discord";
import { resolveEmojisOf, type GuildConfig } from "../config";
import {
  fetchChannelMessages,
  fetchGuildChannels,
  fetchGuildMember,
  fetchReactionUsers,
} from "../discord";
import { filterJudgeable, judgeChannel, matchedResolveEmojis } from "./judge";
import type { DiscordMessage } from "../types";
import {
  loadGuildReplyState,
  saveGuildReplyState,
  type ChannelReplyState,
  type GuildReplyState,
  type StateKV,
} from "./state";

// 監視対象にするチャンネルタイプ
// 0: GUILD_TEXT, 5: GUILD_NEWS。
// フォーラム(15)はメッセージがスレッド側に付くため対象外（第1フェーズのスコープ外）。
const REPLY_TARGET_CHANNEL_TYPES = new Set<number>([0, 5]);

// 1回のメッセージ取得件数。この範囲に判定対象（人間の発言）が
// 見つからない場合は「履歴不完全」として前回状態を維持する。
const CHANNEL_FETCH_LIMIT = 50;

// メンバーのロールキャッシュ TTL（秒）
const MEMBER_ROLE_CACHE_TTL = 3600;

// 1ギルドあたりの Discord API 呼び出し上限（1回のポーリング実行内）。
// Cloudflare Workers のサブリクエスト上限を超えないための安全弁。
// 上限に達したチャンネルは前回状態のまま持ち越し、次回実行で処理される
// （カーソルを進めないため確実に再処理対象になる）。
// ギルドごとに独立させているのは、チャンネル数の多いギルドが上限を使い切って
// 後続ギルドが処理されない（スターブする）のを防ぐため。
// 既定値は Free プラン（50サブリクエスト/実行）でも安全な値。Paid プランでは
// 環境変数 REPLY_API_BUDGET_PER_GUILD で引き上げる（例: "250"）。
const DEFAULT_API_BUDGET_PER_GUILD = 40;

export type PollEnv = Env &
  StateKV & {
    // 1ギルドあたりの API バジェット上書き（wrangler.toml の [vars] で設定）
    REPLY_API_BUDGET_PER_GUILD?: string;
  };

function perGuildBudget(env: PollEnv): number {
  const n = Number(env.REPLY_API_BUDGET_PER_GUILD);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_API_BUDGET_PER_GUILD;
}

/** API バジェット超過を示す内部エラー（チャンネル持ち越しに使う） */
class BudgetExhaustedError extends Error {
  constructor() {
    super("Discord API budget exhausted for this run");
  }
}

/** 1実行あたりの Discord API 呼び出し数を制限するカウンター */
class ApiBudget {
  constructor(private remaining: number) {}

  consume(): void {
    if (this.remaining <= 0) throw new BudgetExhaustedError();
    this.remaining -= 1;
  }
}

/**
 * ユーザーが運営（staffRoleIds のいずれかを持つメンバー）かどうかの判定器。
 * 同一実行内はメモリ、実行を跨いでは KV（TTL 1時間）でキャッシュする。
 */
class StaffChecker {
  private memo = new Map<string, boolean>();

  constructor(
    private env: PollEnv,
    private guildId: string,
    private staffRoleIds: string[],
    private budget: ApiBudget
  ) {}

  private cacheKey(userId: string): string {
    return `member_roles:${this.guildId}:${userId}`;
  }

  async isStaff(userId: string): Promise<boolean> {
    const memoized = this.memo.get(userId);
    if (memoized !== undefined) return memoized;

    let roles: string[] | null = null;

    const cached = await this.env.CONFIG_KV.get(this.cacheKey(userId));
    if (cached !== null) {
      try {
        roles = JSON.parse(cached) as string[];
      } catch {
        // 壊れたキャッシュはミス扱いにして API から取り直す
        roles = null;
      }
    }

    if (roles === null) {
      this.budget.consume();
      const member = await fetchGuildMember(this.env, this.guildId, userId);
      roles = member?.roles ?? [];
      await this.env.CONFIG_KV.put(this.cacheKey(userId), JSON.stringify(roles), {
        expirationTtl: MEMBER_ROLE_CACHE_TTL,
      });
    }

    const staff = roles.some((r) => this.staffRoleIds.includes(r));
    this.memo.set(userId, staff);
    return staff;
  }
}

/**
 * 最新メッセージに「運営が付けた対応済みリアクション（✅ 等）」があるかを確認する。
 * reactions フィールドに対象絵文字が無ければ API を呼ばずに false。
 */
async function hasStaffCheckReaction(
  env: PollEnv,
  channelId: string,
  message: DiscordMessage,
  resolveEmojis: string[],
  staffChecker: StaffChecker,
  budget: ApiBudget
): Promise<boolean> {
  for (const emoji of matchedResolveEmojis(message, resolveEmojis)) {
    budget.consume();
    const users = await fetchReactionUsers(env, channelId, message.id, emoji);
    for (const user of users) {
      if (user.bot) continue;
      if (await staffChecker.isStaff(user.id)) return true;
    }
  }
  return false;
}

export interface GuildPollResult {
  guildConfig: GuildConfig;
  state: GuildReplyState;
  // ギルド単位でポーリング自体が失敗した場合のエラー（通知側で必ず可視化する）
  error?: string;
}

/** 判定設定のバージョン文字列（設定変更後の強制再判定に使う） */
function configVersionOf(
  staffRoleIds: string[],
  resolveEmojis: string[],
  staleNotifyDays: number | undefined
): string {
  return JSON.stringify({
    // v はロジック変更時にインクリメントする（全チャンネルの再判定を促す）
    v: 2,
    staff: [...staffRoleIds].sort(),
    emojis: [...resolveEmojis].sort(),
    // stale 検知の有効化時に lastHumanMessageAt を全チャンネルで採取し直すため含める
    staleEnabled: (staleNotifyDays ?? 0) > 0,
  });
}

/** 前回状態をそのまま持ち越す（カーソルは進めないので次回再処理される） */
function carryOver(
  prev: ChannelReplyState | undefined,
  channelId: string,
  channelName: string
): ChannelReplyState {
  return {
    ...(prev ?? {
      channelId,
      channelName,
      lastObservedMessageId: null,
      awaitingReply: false,
      hasStaffCheck: false,
      updatedAt: new Date().toISOString(),
    }),
    channelName,
  };
}

/**
 * 1ギルド分の未返信状態を更新して返す。
 */
async function pollGuild(
  env: PollEnv,
  guildConfig: GuildConfig,
  budget: ApiBudget
): Promise<GuildPollResult> {
  const { guildId } = guildConfig;
  const monitor = guildConfig.replyMonitor!;
  const resolveEmojis = resolveEmojisOf(monitor);
  const configVersion = configVersionOf(
    monitor.staffRoleIds,
    resolveEmojis,
    monitor.staleNotifyDays
  );
  const staffChecker = new StaffChecker(env, guildId, monitor.staffRoleIds, budget);

  budget.consume();
  const channels = await fetchGuildChannels(env, guildId);
  const targets = channels.filter(
    (ch) =>
      REPLY_TARGET_CHANNEL_TYPES.has(ch.type) &&
      !monitor.excludedChannelIds.includes(ch.id)
  );

  const prevState = await loadGuildReplyState(env, guildId);
  const nextState: GuildReplyState = {};
  const now = new Date().toISOString();

  for (const ch of targets) {
    const prev: ChannelReplyState | undefined = prevState[ch.id];
    const observedLastMessageId = ch.last_message_id ?? null;

    // 差分判定: 最新メッセージIDが動いていない・未返信でもない・エラーも無い・
    // 判定設定も変わっていない → 再取得不要
    const unchanged =
      prev !== undefined &&
      prev.lastObservedMessageId === observedLastMessageId &&
      prev.configVersion === configVersion &&
      !prev.awaitingReply &&
      !prev.lastError;

    if (unchanged) {
      nextState[ch.id] = { ...prev, channelName: ch.name };
      continue;
    }

    try {
      budget.consume();
      const messages = await fetchChannelMessages(env, ch.id, CHANNEL_FETCH_LIMIT);
      const judgeable = filterJudgeable(messages);
      const historyComplete = messages.length < CHANNEL_FETCH_LIMIT;

      // 疎遠検知用: 最後に観測した人間の発言時刻。
      // 見つからなければ前回値を維持し、前回値より古い方向へは巻き戻さない
      const fetchedHumanAt = judgeable[0]?.timestamp;
      const lastHumanMessageAt =
        fetchedHumanAt &&
        (!prev?.lastHumanMessageAt || fetchedHumanAt > prev.lastHumanMessageAt)
          ? fetchedHumanAt
          : prev?.lastHumanMessageAt;

      // 取得範囲に判定対象（人間の発言）が1件も無く、かつ履歴を遡り切れていない場合、
      // 「返信済み」とは確定できない。前回状態を維持し、未返信の見逃しを防ぐ。
      // （Bot/Webhook の投稿が大量に続いたケース。カーソルは進めない）
      if (judgeable.length === 0 && !historyComplete) {
        nextState[ch.id] = {
          ...carryOver(prev, ch.id, ch.name),
          lastError:
            "直近の履歴に判定対象メッセージが見つかりません（Bot投稿が多い可能性）",
          lastErrorAt: now,
          updatedAt: now,
        };
        continue;
      }

      // 発言者のロールを新しい順に「最初の運営発言に当たるまで」だけ解決する。
      // judgeChannel の遡りはそこで止まるため、これで判定に必要な情報が揃う。
      const staffMap = new Map<string, boolean>();
      for (const m of judgeable) {
        if (!staffMap.has(m.author.id)) {
          staffMap.set(m.author.id, await staffChecker.isStaff(m.author.id));
        }
        if (staffMap.get(m.author.id)) break;
      }

      const result = judgeChannel(messages, (id) => staffMap.get(id) ?? false);

      if (result.awaiting && result.latestMessage && result.awaitingSinceMessage) {
        const staffCheck = await hasStaffCheckReaction(
          env,
          ch.id,
          result.latestMessage,
          resolveEmojis,
          staffChecker,
          budget
        );

        // 取得範囲を跨いで未返信が継続している場合、経過時間の起点は
        // 前回記録した（より古い）起点を優先して引き継ぐ
        let awaitingSince = result.awaitingSinceMessage.timestamp;
        let awaitingSinceMessageId = result.awaitingSinceMessage.id;
        if (
          prev?.awaitingReply &&
          prev.awaitingSince &&
          prev.awaitingSince < awaitingSince
        ) {
          awaitingSince = prev.awaitingSince;
          awaitingSinceMessageId = prev.awaitingSinceMessageId ?? awaitingSinceMessageId;
        }

        nextState[ch.id] = {
          channelId: ch.id,
          channelName: ch.name,
          lastObservedMessageId: observedLastMessageId,
          awaitingReply: true,
          awaitingSince,
          awaitingSinceMessageId,
          latestMessageId: result.latestMessage.id,
          latestMessageAt: result.latestMessage.timestamp,
          lastHumanMessageAt,
          hasStaffCheck: staffCheck,
          // 「対応済み」チェックは引き継ぐ（latestMessageId が変われば自動失効する）
          manualCheckMessageId: prev?.manualCheckMessageId,
          configVersion,
          updatedAt: now,
        };
      } else {
        nextState[ch.id] = {
          channelId: ch.id,
          channelName: ch.name,
          lastObservedMessageId: observedLastMessageId,
          awaitingReply: false,
          lastHumanMessageAt,
          hasStaffCheck: false,
          configVersion,
          updatedAt: now,
        };
      }
    } catch (e) {
      if (e instanceof BudgetExhaustedError) {
        // API バジェット超過: エラーではなく持ち越し。次回実行で処理される。
        // 持ち越し中は疎遠一覧の完全性が保証できないためフラグで可視化する
        console.warn(`API budget exhausted, deferring channel ${ch.id} (${ch.name})`);
        nextState[ch.id] = {
          ...carryOver(prev, ch.id, ch.name),
          pendingRescan: true,
        };
        continue;
      }

      // 403（閲覧権限なし）等でもチャンネル単位で失敗を記録して続行。
      // サイレントな監視漏れが最悪の事故なので、エラーは通知側で可視化する。
      console.error(`Reply poll failed for channel ${ch.id} (${ch.name})`, e);
      nextState[ch.id] = {
        ...carryOver(prev, ch.id, ch.name),
        lastError: String(e),
        lastErrorAt: now,
        updatedAt: now,
      };
    }
  }

  // 削除・除外されたチャンネルの状態は持ち越さない（nextState に含めない）

  await saveGuildReplyState(env, guildId, nextState);
  return { guildConfig, state: nextState };
}

/**
 * 返信監視が有効な全ギルドをポーリングし、更新後の状態を返す。
 * ギルド単位の失敗も結果に含めて返す（通知側で障害として可視化するため、
 * ここで握りつぶさない）。
 */
export async function runReplyPoll(
  env: PollEnv,
  guilds: GuildConfig[]
): Promise<GuildPollResult[]> {
  const results: GuildPollResult[] = [];

  for (const guildConfig of guilds) {
    if (!guildConfig.replyMonitor?.enabled) continue;

    try {
      // バジェットはギルドごとに独立（大規模ギルドによるスターブ防止）
      const budget = new ApiBudget(perGuildBudget(env));
      results.push(await pollGuild(env, guildConfig, budget));
    } catch (e) {
      console.error(
        `Reply poll failed for guild ${guildConfig.guildName} (${guildConfig.guildId})`,
        e
      );
      results.push({ guildConfig, state: {}, error: String(e) });
    }
  }

  return results;
}
