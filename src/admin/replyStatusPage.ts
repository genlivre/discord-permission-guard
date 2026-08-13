// src/admin/replyStatusPage.ts
//
// 未返信チャンネルの指差し確認ページ（毎朝の定例用）。
// /admin 配下に置くことで Cloudflare Access の保護を受ける。
// データは /admin/api/reply-status-all から取得する。

export function renderReplyStatusPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord未返信チェック</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1100px; margin: 0 auto; }
    .header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 8px; }
    h1 { color: #5865f2; font-size: 1.4em; }
    h2 { color: #fff; font-size: 1.1em; }
    h3 { font-size: 0.95em; margin-bottom: 8px; }
    .sub { color: #72767d; font-size: 12px; margin-bottom: 20px; }
    .chip {
      padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: bold;
      border: 1px solid transparent;
    }
    .chip.red { background: #4a1f28; color: #f38ba8; border-color: #7a2f3f; }
    .chip.green { background: #1f4a2e; color: #7ee2a8; border-color: #2f7a4a; }
    .chip.yellow { background: #4a3f1f; color: #f9e2af; border-color: #7a6a2f; }
    button, a.button {
      background: #5865f2; color: white; border: none; padding: 8px 16px;
      border-radius: 4px; cursor: pointer; font-size: 13px; text-decoration: none;
      display: inline-flex; align-items: center; gap: 6px;
    }
    button:hover, a.button:hover { background: #4752c4; }
    button.secondary, a.button.secondary { background: #4f545c; }
    button.secondary:hover, a.button.secondary:hover { background: #686d73; }
    button.danger { background: #7a2f3f; }
    button.danger:hover { background: #9a3a4f; }
    button:disabled { opacity: 0.5; cursor: wait; }
    .btn-sm { padding: 4px 10px !important; font-size: 12px !important; }
    .row-checked td { opacity: 0.55; }
    .row-checked .ch-name { text-decoration: line-through; }
    button.success { background: #3ba55c; }
    button.success:hover { background: #2d8049; }
    .replied-mark {
      display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px;
      background: #1f4a2e; color: #7ee2a8; border: 1px solid #2f7a4a;
    }
    .card { background: #2d2d44; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .card-header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; }
    .muted { color: #72767d; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: #99aab5; font-size: 11px; padding: 6px 8px; border-bottom: 1px solid #40444b; }
    td { padding: 8px; border-bottom: 1px solid #33334d; }
    tr:hover td { background: #33334d; }
    .ch-name { font-weight: bold; color: #fff; }
    .elapsed-warn { color: #f9e2af; font-weight: bold; }
    .elapsed-danger { color: #f38ba8; font-weight: bold; }
    .ok-line { color: #7ee2a8; font-size: 14px; padding: 6px 0; }
    .section { margin-top: 14px; }
    .section-title { color: #b9bbbe; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag {
      background: #40444b; padding: 4px 12px; border-radius: 12px; font-size: 12px;
      color: #dcddde; text-decoration: none; display: inline-flex; gap: 6px; align-items: center;
    }
    .tag:hover { background: #4f545c; }
    .tag .days { color: #72767d; }
    .error-list { font-size: 12px; color: #b9bbbe; line-height: 1.7; }
    .warn-banner {
      background: #4a3f1f; color: #f9e2af; border: 1px solid #7a6a2f;
      border-radius: 6px; padding: 8px 12px; font-size: 12px; margin-top: 10px;
    }
    .loading { text-align: center; padding: 40px; color: #72767d; }
    details.help {
      background: #23233a; border: 1px solid #40444b; border-radius: 6px;
      padding: 10px 14px; margin-bottom: 16px; font-size: 13px;
    }
    details.help summary { cursor: pointer; color: #99aab5; user-select: none; }
    details.help summary:hover { color: #fff; }
    .stale-accordion summary { cursor: pointer; user-select: none; }
    .stale-accordion summary:hover { color: #fff; }
    .help-table { margin-top: 10px; }
    .help-table th {
      white-space: nowrap; vertical-align: top; color: #dcddde;
      font-size: 13px; padding: 8px 14px 8px 0; border-bottom: 1px solid #33334d;
    }
    .help-table td { color: #b9bbbe; line-height: 1.7; }
    .status.error { background: #4a2d2d; color: #ed4245; padding: 10px; border-radius: 4px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Discord未返信チェック</h1>
      <span id="total-chip"></span>
      <span style="margin-left: auto; display: inline-flex; gap: 8px;">
        <button id="repoll-btn" onclick="repollAndReload()">最新化（ポーリング実行）</button>
        <a class="button secondary" href="/admin">設定へ</a>
      </span>
    </div>
    <p class="sub">
      「最新の発言が運営以外のまま」のチャンネル一覧です。
      <span id="generated-at"></span>
    </p>

    <details class="help">
      <summary>各ボタンの説明（クリックで開閉）</summary>
      <table class="help-table">
        <tr>
          <th>返事をした</th>
          <td><b>Discord で返信した</b>ときに押します（返信すると10分以内に自動で消えますが、その場で消したいときに）。
              一覧には「返事済み」として残り（「未対応のみ表示」で非表示）、通知対象からも外れます。
              <b>新しいメッセージが来ると自動で未対応に戻り</b>再び通知されます。押し間違えたら「取り消す」で戻せます。</td>
        </tr>
        <tr>
          <th>不問にする</th>
          <td><b>返信不要のまま置いておいてOK</b>な会話に使います（古い自然終了の会話、退職した元担当者で終わっている会話など）。
              一覧と通知から完全に外れ、下の「🔕 不問中のチャンネル」に移動します。
              <b>新しいメッセージが来ると自動で通知対象に復活</b>します。誤操作は「解除」で戻せます。</td>
        </tr>
        <tr>
          <th>対象外にする</th>
          <td><b>このチャンネルの監視自体をやめます</b>（アーティスト個別ではないチャンネル向け。雑談・Botログなど）。
              <b>新しいメッセージが来ても通知されません。</b>
              戻すには <a href="/admin" style="color:#7289da;">設定画面</a> の「監視除外チャンネル」から削除してください。</td>
        </tr>
        <tr>
          <th>✅（Discord側）</th>
          <td>運営ロールを持つメンバーが Discord 上で最終メッセージに対応済みリアクション（✅ 🙇 等、設定で変更可）を
              付けた場合も、「返事をした」と同様に通知対象から外れます。</td>
        </tr>
        <tr>
          <th>使い分けの目安</th>
          <td>返信した → <b>返事をした</b> ／ 返信不要だが監視は続けたい → <b>不問にする</b> ／ そもそも監視不要 → <b>対象外にする</b></td>
        </tr>
      </table>
    </details>
    <div style="margin-bottom: 14px;">
      <label style="font-size: 13px; color: #b9bbbe; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
        <input type="checkbox" id="filter-unchecked" checked onchange="renderAll()">
        未対応のみ表示（「返事をした」を押したものを隠す）
      </label>
    </div>
    <div id="status"></div>
    <div id="content"><div class="loading">読み込み中...</div></div>
  </div>

  <script>
    function esc(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    const DAY = 86400000;

    function fmtJst(iso) {
      if (!iso) return '-';
      return new Date(iso).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      });
    }

    function fmtElapsed(iso, now) {
      if (!iso) return '-';
      const ms = Math.max(0, now - new Date(iso).getTime());
      const d = Math.floor(ms / DAY);
      if (d >= 1) return d + '日';
      const h = Math.floor(ms / 3600000);
      if (h >= 1) return h + '時間';
      return Math.floor(ms / 60000) + '分';
    }

    function elapsedClass(iso, now) {
      if (!iso) return '';
      const ms = now - new Date(iso).getTime();
      if (ms >= DAY) return 'elapsed-danger';
      if (ms >= 6 * 3600000) return 'elapsed-warn';
      return '';
    }

    function renderGuild(g, now, onlyUnchecked) {
      const visible = onlyUnchecked
        ? g.awaitingChannels.filter(ch => !ch.manualChecked)
        : g.awaitingChannels;
      const uncheckedCount = g.awaitingChannels.filter(ch => !ch.manualChecked).length;

      const awaitingRows = visible.map(ch => \`
        <tr class="\${ch.manualChecked ? 'row-checked' : ''}">
          <td class="ch-name">#\${esc(ch.channelName)}</td>
          <td>\${fmtJst(ch.awaitingSince)}</td>
          <td class="\${elapsedClass(ch.awaitingSince, now)}">\${fmtElapsed(ch.awaitingSince, now)}</td>
          <td style="white-space: nowrap;">
            \${ch.manualChecked
              ? \`<span class="replied-mark">返事済み</span>
                 <button class="secondary btn-sm" onclick="setReplied('\${g.guildId}', '\${ch.channelId}', false)">取り消す</button>\`
              : \`<button class="success btn-sm" onclick="setReplied('\${g.guildId}', '\${ch.channelId}', true)">返事をした</button>\`}
            <a class="button secondary btn-sm" href="\${esc(ch.jumpUrl)}" target="_blank" rel="noopener noreferrer">メッセージ ↗</a>
            <a class="button secondary btn-sm" href="\${esc(ch.channelUrl)}" target="_blank" rel="noopener noreferrer">チャンネル ↗</a>
            <button class="secondary btn-sm" onclick="dismissChannel('\${g.guildId}', '\${ch.channelId}', '\${esc(ch.channelName)}')">不問にする</button>
            <button class="danger btn-sm" onclick="excludeChannel('\${g.guildId}', '\${ch.channelId}', '\${esc(ch.channelName)}')">対象外にする</button>
          </td>
        </tr>
      \`).join('');

      const awaitingHtml = g.awaitingChannels.length === 0
        ? '<p class="ok-line">✅ 未返信のチャンネルはありません</p>'
        : visible.length === 0
          ? '<p class="ok-line">✅ 未対応の返信待ちはありません（返事済み ' + g.awaitingChannels.length + ' 件）</p>'
          : \`<table>
               <thead><tr><th>チャンネル</th><th>最初の未返信 (JST)</th><th>経過</th><th></th></tr></thead>
               <tbody>\${awaitingRows}</tbody>
             </table>\`;

      const staleHtml = (g.staleNotifyDays && g.staleChannels.length > 0) ? \`
        <details class="section stale-accordion">
          <summary class="section-title">💤 しばらくやり取りのないチャンネル（\${g.staleNotifyDays}日以上・\${g.staleChannels.length}件）</summary>
          <div class="tag-list" style="margin-top: 8px;">
            \${g.staleChannels.map(ch => \`
              <a class="tag" href="\${esc(ch.jumpUrl)}" target="_blank" rel="noopener noreferrer">
                #\${esc(ch.channelName)} <span class="days">\${ch.elapsedDays}日</span>
              </a>
            \`).join('')}
          </div>
        </details>
      \` : '';

      const errorHtml = g.errorChannels.length > 0 ? \`
        <div class="section">
          <h3 class="section-title" style="color: #f9e2af;">⚠️ 取得できないチャンネル（\${g.errorChannels.length}件・Bot の閲覧権限または監視除外設定を確認）</h3>
          <div class="error-list">
            \${g.errorChannels.map(ch => \`
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span>#\${esc(ch.channelName)} — \${esc(ch.lastError)}</span>
                <a class="button secondary btn-sm" href="\${esc(ch.channelUrl)}" target="_blank" rel="noopener noreferrer">チャンネル ↗</a>
                <button class="danger btn-sm" onclick="excludeChannel('\${g.guildId}', '\${ch.channelId}', '\${esc(ch.channelName)}')">対象外にする</button>
              </div>
            \`).join('')}
          </div>
        </div>
      \` : '';

      const dismissedHtml = g.dismissedChannels.length > 0 ? \`
        <div class="section">
          <h3 class="section-title">🔕 不問中のチャンネル（\${g.dismissedChannels.length}件・新しいメッセージが来たら自動で通知対象に戻ります）</h3>
          <div class="tag-list">
            \${g.dismissedChannels.map(ch => \`
              <span class="tag">
                #\${esc(ch.channelName)}
                <a href="\${esc(ch.channelUrl)}" target="_blank" rel="noopener noreferrer" style="color: #7289da; text-decoration: none;">↗</a>
                <span style="color: #ed4245; cursor: pointer;" onclick="undismissChannel('\${g.guildId}', '\${ch.channelId}')">解除</span>
              </span>
            \`).join('')}
          </div>
        </div>
      \` : '';

      const pendingHtml = g.pendingRescanCount > 0
        ? \`<div class="warn-banner">⏳ データ取得中のチャンネルが \${g.pendingRescanCount} 件あります（一覧は不完全です。数十分後に再確認してください）</div>\`
        : '';

      const checkedCount = g.awaitingChannels.length - uncheckedCount;
      return \`
        <div class="card">
          <div class="card-header">
            <h2>\${esc(g.guildName)}</h2>
            <span class="muted">監視 \${g.totalWatchedChannels} チャンネル</span>
            \${uncheckedCount > 0
              ? \`<span class="chip red">返信待ち \${uncheckedCount} 件</span>\`
              : '<span class="chip green">返信待ちなし</span>'}
            \${checkedCount > 0 ? \`<span class="chip yellow">返事済み \${checkedCount} 件</span>\` : ''}
            \${g.baselineAt ? \`<span class="muted" style="margin-left: auto;">\${fmtJst(g.baselineAt)} より前は不問</span>\` : ''}
          </div>
          \${awaitingHtml}
          \${dismissedHtml}
          \${staleHtml}
          \${errorHtml}
          \${pendingHtml}
        </div>
      \`;
    }

    let currentData = null;

    function renderAll() {
      if (!currentData) return;
      const content = document.getElementById('content');
      const now = Date.now();
      const onlyUnchecked = document.getElementById('filter-unchecked').checked;

      const total = currentData.guilds.reduce(
        (sum, g) => sum + g.awaitingChannels.filter(ch => !ch.manualChecked).length, 0);
      const chip = document.getElementById('total-chip');
      chip.className = total > 0 ? 'chip red' : 'chip green';
      chip.textContent = total > 0 ? '返信待ち 合計 ' + total + ' 件' : 'すべて対応済み';
      document.getElementById('generated-at').textContent = '最終更新: ' + fmtJst(currentData.generatedAt);

      content.innerHTML = currentData.guilds.map(g => renderGuild(g, now, onlyUnchecked)).join('')
        || '<div class="card"><p class="muted">返信監視が有効なサーバーがありません。/admin から設定してください。</p></div>';
    }

    async function load() {
      const content = document.getElementById('content');
      try {
        const res = await fetch('/admin/api/reply-status-all');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        currentData = await res.json();
        renderAll();
      } catch (e) {
        content.innerHTML = '';
        document.getElementById('status').innerHTML =
          '<div class="status error">読み込みに失敗しました: ' + esc(e.message) + '</div>';
      }
    }

    async function setReplied(guildId, channelId, replied) {
      try {
        const res = await fetch('/admin/api/reply-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId, channelId, checked: replied })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        // ローカル状態を更新して再描画（再取得なしで軽快に）
        const guild = currentData.guilds.find(g => g.guildId === guildId);
        const ch = guild && guild.awaitingChannels.find(c => c.channelId === channelId);
        if (ch) ch.manualChecked = replied;
        renderAll();
      } catch (e) {
        document.getElementById('status').innerHTML =
          '<div class="status error">「返事をした」の更新に失敗しました: ' + esc(e.message) + '</div>';
      }
    }

    async function dismissChannel(guildId, channelId, channelName) {
      if (!confirm('#' + channelName + ' を不問にしますか？\\n' +
                   '（一覧と通知から外れます。新しいメッセージが来たら自動で通知対象に戻ります）')) return;
      try {
        const res = await fetch('/admin/api/reply-dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId, channelId, dismissed: true })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const guild = currentData.guilds.find(g => g.guildId === guildId);
        if (guild) {
          const ch = guild.awaitingChannels.find(c => c.channelId === channelId);
          guild.awaitingChannels = guild.awaitingChannels.filter(c => c.channelId !== channelId);
          guild.dismissedChannels.push({
            channelId,
            channelName: ch ? ch.channelName : channelName,
            channelUrl: ch ? ch.channelUrl : ''
          });
        }
        renderAll();
      } catch (e) {
        document.getElementById('status').innerHTML =
          '<div class="status error">不問への変更に失敗しました: ' + esc(e.message) + '</div>';
      }
    }

    async function undismissChannel(guildId, channelId) {
      try {
        const res = await fetch('/admin/api/reply-dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId, channelId, dismissed: false })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        // 解除後は未返信一覧へ戻る可能性があるためサーバーから再取得
        await load();
      } catch (e) {
        document.getElementById('status').innerHTML =
          '<div class="status error">不問の解除に失敗しました: ' + esc(e.message) + '</div>';
      }
    }

    async function excludeChannel(guildId, channelId, channelName) {
      if (!confirm('#' + channelName + ' を監視対象外にしますか？\\n（/admin の「監視除外チャンネル」からいつでも戻せます）')) return;
      try {
        const res = await fetch('/admin/api/reply-exclude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId, channelId })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const guild = currentData.guilds.find(g => g.guildId === guildId);
        if (guild) {
          guild.awaitingChannels = guild.awaitingChannels.filter(c => c.channelId !== channelId);
          guild.staleChannels = guild.staleChannels.filter(c => c.channelId !== channelId);
          guild.errorChannels = guild.errorChannels.filter(c => c.channelId !== channelId);
          guild.dismissedChannels = guild.dismissedChannels.filter(c => c.channelId !== channelId);
          guild.totalWatchedChannels -= 1;
        }
        renderAll();
      } catch (e) {
        document.getElementById('status').innerHTML =
          '<div class="status error">対象外への変更に失敗しました: ' + esc(e.message) + '</div>';
      }
    }

    async function repollAndReload() {
      const btn = document.getElementById('repoll-btn');
      btn.disabled = true;
      btn.textContent = 'ポーリング実行中...';
      try {
        const res = await fetch('/run-reply');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        await load();
      } catch (e) {
        document.getElementById('status').innerHTML =
          '<div class="status error">ポーリングに失敗しました: ' + esc(e.message) + '</div>';
      } finally {
        btn.disabled = false;
        btn.textContent = '最新化（ポーリング実行）';
      }
    }

    load();
  </script>
</body>
</html>`;
}
