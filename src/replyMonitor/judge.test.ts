// src/replyMonitor/judge.test.ts
import { describe, expect, it } from "vitest";
import type { DiscordMessage } from "../types";
import { filterJudgeable, hasCheckReaction, judgeChannel } from "./judge";

const STAFF_ID = "staff-1";
const ARTIST_ID = "artist-1";

let seq = 1000;
function msg(overrides: Partial<DiscordMessage> & { authorId: string }): DiscordMessage {
  const { authorId, ...rest } = overrides;
  seq += 1;
  return {
    id: String(seq),
    type: 0,
    author: { id: authorId },
    timestamp: `2026-08-11T0${String(seq).slice(-1)}:00:00.000Z`,
    ...rest,
  };
}

const isStaff = (id: string) => id === STAFF_ID;

describe("filterJudgeable", () => {
  it("Bot・システムメッセージを除外する", () => {
    const messages: DiscordMessage[] = [
      msg({ authorId: "bot-1", author: { id: "bot-1", bot: true } }),
      msg({ authorId: ARTIST_ID, type: 7 }), // 7 = GUILD_MEMBER_JOIN
      msg({ authorId: ARTIST_ID, type: 19 }), // REPLY は対象
      msg({ authorId: ARTIST_ID, type: 0 }),
    ];
    expect(filterJudgeable(messages)).toHaveLength(2);
  });
});

describe("judgeChannel", () => {
  it("最新が運営の発言なら返信済み", () => {
    const result = judgeChannel(
      [msg({ authorId: STAFF_ID }), msg({ authorId: ARTIST_ID })],
      isStaff
    );
    expect(result.awaiting).toBe(false);
  });

  it("最新が非運営の発言なら未返信", () => {
    const artistMsg = msg({ authorId: ARTIST_ID });
    const result = judgeChannel(
      [artistMsg, msg({ authorId: STAFF_ID })],
      isStaff
    );
    expect(result.awaiting).toBe(true);
    expect(result.latestMessage?.id).toBe(artistMsg.id);
    expect(result.awaitingSinceMessage?.id).toBe(artistMsg.id);
  });

  it("非運営の連投は先頭メッセージが経過時間の起点になる", () => {
    const first = msg({ authorId: ARTIST_ID });
    const second = msg({ authorId: ARTIST_ID });
    const latest = msg({ authorId: ARTIST_ID });
    // messages は新しい順で渡される
    const result = judgeChannel(
      [latest, second, first, msg({ authorId: STAFF_ID })],
      isStaff
    );
    expect(result.awaiting).toBe(true);
    expect(result.latestMessage?.id).toBe(latest.id);
    expect(result.awaitingSinceMessage?.id).toBe(first.id);
  });

  it("連投の遡りは運営の発言で止まる（それより古い非運営発言まで遡らない）", () => {
    const oldArtist = msg({ authorId: ARTIST_ID });
    const staffReply = msg({ authorId: STAFF_ID });
    const newArtist = msg({ authorId: ARTIST_ID });
    const result = judgeChannel([newArtist, staffReply, oldArtist], isStaff);
    expect(result.awaitingSinceMessage?.id).toBe(newArtist.id);
  });

  it("最新の間に Bot 発言が挟まっても判定は人間の最新メッセージで行う", () => {
    const artistMsg = msg({ authorId: ARTIST_ID });
    const botMsg = msg({ authorId: "bot-1", author: { id: "bot-1", bot: true } });
    const result = judgeChannel([botMsg, artistMsg], isStaff);
    expect(result.awaiting).toBe(true);
    expect(result.latestMessage?.id).toBe(artistMsg.id);
  });

  it("判定対象メッセージが無ければ未返信にしない", () => {
    const botMsg = msg({ authorId: "bot-1", author: { id: "bot-1", bot: true } });
    expect(judgeChannel([botMsg], isStaff).awaiting).toBe(false);
    expect(judgeChannel([], isStaff).awaiting).toBe(false);
  });
});

describe("hasCheckReaction", () => {
  it("✅ リアクションを検出する", () => {
    const m = msg({
      authorId: ARTIST_ID,
      reactions: [{ count: 1, emoji: { id: null, name: "✅" } }],
    });
    expect(hasCheckReaction(m)).toBe(true);
  });

  it("✅ 以外のリアクション（🙇 等）やカスタム絵文字は返信扱いにしない", () => {
    const bowing = msg({
      authorId: ARTIST_ID,
      reactions: [{ count: 3, emoji: { id: null, name: "🙇" } }],
    });
    const custom = msg({
      authorId: ARTIST_ID,
      reactions: [{ count: 1, emoji: { id: "123456", name: "✅" } }],
    });
    const none = msg({ authorId: ARTIST_ID });
    expect(hasCheckReaction(bowing)).toBe(false);
    expect(hasCheckReaction(custom)).toBe(false);
    expect(hasCheckReaction(none)).toBe(false);
  });
});
