#!/usr/bin/env node
// wrangler.toml の事故検知。`npm run deploy` の predeploy で自動実行される。
//
// 2026-09-20 に、cron が 1 本しか書かれていない toml から deploy され、
// 本番の朝サマリー・日中リマインドの cron と vars 2 件が消えて
// 未返信アラートが 2 日間止まった。同じ事故を deploy 前に止めるのが目的。
//
// cron の期待値は src/index.ts の CRON_* 定数から読む（二重管理にしない）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
const indexTs = readFileSync(join(root, "src/index.ts"), "utf8");

const errors = [];

// 1) Worker 名（本番正本であること）
const name = toml.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
if (name !== "discord-permission-guard") {
  errors.push(
    `Worker 名が "${name}" です。本番正本の wrangler.toml は "discord-permission-guard" である必要があります（別環境用は wrangler.toml.example から別ファイルを作ってください）。`
  );
}

// 2) cron: src/index.ts の CRON_* 定数と完全一致するか
const expectedCrons = [...indexTs.matchAll(/^const CRON_[A-Z_]+\s*=\s*"([^"]+)"/gm)].map(
  (m) => m[1]
);
const cronsBlock = toml.match(/crons\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
const actualCrons = [...cronsBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

if (expectedCrons.length === 0) {
  errors.push("src/index.ts から CRON_* 定数を読み取れませんでした（このスクリプトの想定が古い可能性があります）。");
}
for (const cron of expectedCrons) {
  if (!actualCrons.includes(cron)) {
    errors.push(
      `cron "${cron}" が wrangler.toml の [triggers].crons にありません。src/index.ts が期待する cron が登録されず、対応する処理が無言で実行されなくなります。`
    );
  }
}
for (const cron of actualCrons) {
  if (!expectedCrons.includes(cron)) {
    errors.push(
      `cron "${cron}" は src/index.ts の CRON_* 定数のどれにも一致しません（発火しても何も実行されません）。`
    );
  }
}

// 3) 運用上必須の vars
for (const key of ["REPLY_API_BUDGET_PER_GUILD", "REPLY_STATUS_PAGE_URL"]) {
  if (!new RegExp(`^\\s*${key}\\s*=`, "m").test(toml)) {
    errors.push(
      `[vars] の ${key} がありません。deploy すると本番から削除され、` +
        (key === "REPLY_API_BUDGET_PER_GUILD"
          ? "返信監視の API 予算が既定 40 に落ちます。"
          : "通知末尾のチェックページリンクが消えます。")
    );
  }
}

// 4) KV Namespace ID がプレースホルダのままでないか
const kvId = toml.match(/^\s*id\s*=\s*"([^"]+)"/m)?.[1] ?? "";
if (!/^[0-9a-f]{32}$/.test(kvId)) {
  errors.push(`CONFIG_KV の id が不正です（"${kvId}"）。本番の Namespace ID を指しているか確認してください。`);
}

// 5) 秘密情報の混入
const secretPatterns = [
  [/discord\.com\/api\/webhooks/i, "Discord Webhook URL"],
  [/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/, "Discord Bot Token らしき文字列"],
  [/^\s*(?:[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z_]*)\s*=/m, "トークン/シークレットらしき変数"],
];
for (const [re, label] of secretPatterns) {
  if (re.test(toml)) {
    errors.push(`${label} が wrangler.toml に含まれています。秘密情報は wrangler secret / .dev.vars で管理してください。`);
  }
}

if (errors.length > 0) {
  console.error("✗ wrangler.toml の検証に失敗しました:\n");
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\nデプロイを中止します。");
  process.exit(1);
}

console.log(`✓ wrangler.toml OK（cron ${actualCrons.length} 本 / vars 2 件 / 秘密情報なし）`);
