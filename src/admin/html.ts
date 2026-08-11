// src/admin/html.ts

export function renderAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord Permission Guard - Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      padding: 20px;
    }
    h1 { color: #5865f2; margin-bottom: 20px; }
    h2 { color: #99aab5; margin: 20px 0 10px; font-size: 1.1em; }
    .container { max-width: 1200px; margin: 0 auto; }
    .card {
      background: #2d2d44;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .guild-name { font-size: 1.2em; font-weight: bold; color: #fff; }
    .guild-id { font-size: 0.8em; color: #72767d; }
    button {
      background: #5865f2;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    button:hover { background: #4752c4; }
    button.danger { background: #ed4245; }
    button.danger:hover { background: #c73e41; }
    button.secondary { background: #4f545c; }
    button.secondary:hover { background: #686d73; }
    button.success { background: #3ba55c; }
    button.success:hover { background: #2d8049; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 5px; margin: 5px 0; }
    .tag {
      background: #40444b;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .tag .remove { cursor: pointer; color: #ed4245; font-weight: bold; }
    .section { margin: 15px 0; padding: 10px; background: #23233a; border-radius: 6px; }
    .section-title { font-size: 0.9em; color: #b9bbbe; margin-bottom: 8px; }
    select, input {
      background: #40444b;
      color: #dcddde;
      border: 1px solid #202225;
      padding: 8px 12px;
      border-radius: 4px;
      width: 100%;
      margin-bottom: 8px;
    }
    .row { display: flex; gap: 10px; align-items: center; }
    .loading { text-align: center; padding: 40px; color: #72767d; }
    .toggle-section { cursor: pointer; user-select: none; }
    .toggle-section:hover { color: #fff; }
    .hidden { display: none; }
    .status { padding: 10px; border-radius: 4px; margin: 10px 0; }
    .status.success { background: #2d4a3e; color: #3ba55c; }
    .status.error { background: #4a2d2d; color: #ed4245; }
    .modal-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7); display: flex;
      align-items: center; justify-content: center; z-index: 100;
    }
    .modal {
      background: #2d2d44; padding: 20px; border-radius: 8px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    }
    .modal h3 { margin-bottom: 15px; }
    .checkbox-list { max-height: 300px; overflow-y: auto; }
    .checkbox-item { padding: 8px; display: flex; align-items: center; gap: 8px; }
    .checkbox-item:hover { background: #40444b; border-radius: 4px; }
    .checkbox-item input { width: auto; margin: 0; }
    .category-name { color: #7289da; font-weight: bold; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Discord Permission Guard - Admin</h1>
    <div id="status"></div>

    <div class="row" style="margin-bottom: 20px;">
      <button onclick="addGuild()" class="success">+ サーバーを追加</button>
      <button onclick="saveAllConfig()" style="margin-left: auto;">設定を保存</button>
    </div>

    <div id="guilds-container">
      <div class="loading">読み込み中...</div>
    </div>
  </div>

  <div id="modal-container"></div>

  <script>
    let config = [];
    let availableGuilds = [];
    // チャンネル名のキャッシュ { guildId: { channels: {id: name} } }
    let nameCache = {};

    async function init() {
      try {
        const [configRes, guildsRes] = await Promise.all([
          fetch('/admin/api/config'),
          fetch('/admin/api/guilds')
        ]);
        config = await configRes.json();
        availableGuilds = await guildsRes.json();

        // 各ギルドのチャンネル名をキャッシュ
        await Promise.all(config.map(guild => loadGuildCache(guild.guildId)));

        renderGuilds();
      } catch (e) {
        showStatus('読み込みに失敗しました: ' + e.message, 'error');
      }
    }

    async function loadGuildCache(guildId) {
      if (nameCache[guildId]) return;

      try {
        const [channelsRes, rolesRes] = await Promise.all([
          fetch(\`/admin/api/guilds/\${guildId}/channels\`),
          fetch(\`/admin/api/guilds/\${guildId}/roles\`)
        ]);
        const channelsData = await channelsRes.json();
        const rolesData = await rolesRes.json();

        const channels = {};
        // カテゴリ内のチャンネル
        channelsData.categories.forEach(cat => {
          cat.channels.forEach(ch => {
            channels[ch.id] = ch.name;
          });
        });
        // カテゴリなしのチャンネル
        channelsData.uncategorized.forEach(ch => {
          channels[ch.id] = ch.name;
        });

        const roles = {};
        rolesData.forEach(r => {
          roles[r.id] = r.name;
        });

        nameCache[guildId] = { channels, roles };
      } catch (e) {
        console.error('Failed to load cache for guild', guildId, e);
        nameCache[guildId] = { channels: {}, roles: {} };
      }
    }

    function getChannelName(guildId, channelId) {
      const cache = nameCache[guildId];
      if (cache && cache.channels[channelId]) {
        return \`#\${cache.channels[channelId]} (\${channelId})\`;
      }
      return \`#\${channelId}\`;
    }

    function getRoleName(guildId, roleId) {
      const cache = nameCache[guildId];
      if (cache && cache.roles && cache.roles[roleId]) {
        return \`@\${cache.roles[roleId]} (\${roleId})\`;
      }
      return \`@\${roleId}\`;
    }

    // 返信監視設定が未初期化のギルドにデフォルト値を入れる
    function ensureReplyMonitor(guild) {
      if (!guild.replyMonitor) {
        guild.replyMonitor = { enabled: false, staffRoleIds: [], excludedChannelIds: [], resolveReactionEmojis: ['✅'] };
      }
      if (!guild.replyMonitor.resolveReactionEmojis) {
        guild.replyMonitor.resolveReactionEmojis = ['✅'];
      }
      return guild.replyMonitor;
    }

    // 'rm.' プレフィックス付きフィールドは replyMonitor 配下のリストを指す
    function getList(guild, field) {
      if (field.startsWith('rm.')) {
        return ensureReplyMonitor(guild)[field.slice(3)];
      }
      return guild[field];
    }

    function setList(guild, field, ids) {
      if (field.startsWith('rm.')) {
        ensureReplyMonitor(guild)[field.slice(3)] = ids;
      } else {
        guild[field] = ids;
      }
    }

    function renderGuilds() {
      const container = document.getElementById('guilds-container');
      if (config.length === 0) {
        container.innerHTML = '<div class="card"><p>サーバーが登録されていません。「サーバーを追加」をクリックしてください。</p></div>';
        return;
      }

      container.innerHTML = config.map((guild, idx) => {
        const rm = ensureReplyMonitor(guild);
        return \`
        <div class="card" data-index="\${idx}">
          <div class="card-header">
            <div>
              <span class="guild-name">\${escapeHtml(guild.guildName)}</span>
              <span class="guild-id">\${guild.guildId}</span>
            </div>
            <button class="danger" onclick="removeGuild(\${idx})">削除</button>
          </div>

          <div class="section">
            <div class="section-title">Webhook URL（権限エラー通知先）</div>
            <input type="text" value="\${escapeHtml(guild.alertWebhookUrl)}"
                   onchange="updateField(\${idx}, 'alertWebhookUrl', this.value)">
          </div>

          <div class="section">
            <div class="section-title">
              <span class="toggle-section" onclick="toggleSection(this)">▼ ホワイトリストチャンネル (\${guild.whitelistChannelIds.length}件)</span>
            </div>
            <div class="collapsible">
              <div class="tag-list" id="whitelist-\${idx}">
                \${guild.whitelistChannelIds.map(id => \`<span class="tag">\${escapeHtml(getChannelName(guild.guildId, id))}<span class="remove" onclick="removeFromList(\${idx}, 'whitelistChannelIds', '\${id}')">&times;</span></span>\`).join('')}
              </div>
              <button class="secondary" onclick="openChannelSelector(\${idx}, 'whitelistChannelIds')">チャンネルを追加</button>
            </div>
          </div>

          <div class="section">
            <div class="section-title">
              <span class="toggle-section" onclick="toggleSection(this)">▼ 返信忘れ監視\${rm.enabled ? '（有効）' : '（無効）'}</span>
            </div>
            <div class="collapsible">
              <label class="checkbox-item" style="padding-left: 0;">
                <input type="checkbox" \${rm.enabled ? 'checked' : ''}
                       onchange="updateReplyMonitorEnabled(\${idx}, this.checked)">
                未返信チャンネルの監視・通知を有効にする
              </label>

              <div class="section-title" style="margin-top: 8px;">運営ロール（このロールを持つメンバーの発言を「返信」とみなす）</div>
              <div class="tag-list">
                \${rm.staffRoleIds.map(id => \`<span class="tag">\${escapeHtml(getRoleName(guild.guildId, id))}<span class="remove" onclick="removeFromList(\${idx}, 'rm.staffRoleIds', '\${id}')">&times;</span></span>\`).join('')}
              </div>
              <button class="secondary" onclick="openRoleSelector(\${idx})">ロールを選択</button>

              <div class="section-title" style="margin-top: 12px;">対応済みリアクション（運営がこれを最終メッセージに付けるとアラート対象外。カンマ区切り、カスタム絵文字は 名前:ID）</div>
              <input type="text" value="\${escapeHtml(rm.resolveReactionEmojis.join(', '))}"
                     placeholder="✅, 🙆, party_parrot:123456789012345678"
                     onchange="updateResolveEmojis(\${idx}, this.value)">

              <div class="section-title" style="margin-top: 12px;">監視除外チャンネル（運営内部チャンネルなど） (\${rm.excludedChannelIds.length}件)</div>
              <div class="tag-list">
                \${rm.excludedChannelIds.map(id => \`<span class="tag">\${escapeHtml(getChannelName(guild.guildId, id))}<span class="remove" onclick="removeFromList(\${idx}, 'rm.excludedChannelIds', '\${id}')">&times;</span></span>\`).join('')}
              </div>
              <button class="secondary" onclick="openChannelSelector(\${idx}, 'rm.excludedChannelIds')">チャンネルを追加</button>

              <div style="margin-top: 12px;">
                <button class="secondary" onclick="showReplyStatus(\${idx})">未返信状況を表示</button>
              </div>
            </div>
          </div>
        </div>
      \`;}).join('');
    }

    function updateReplyMonitorEnabled(idx, enabled) {
      ensureReplyMonitor(config[idx]).enabled = enabled;
      renderGuilds();
    }

    function updateResolveEmojis(idx, value) {
      const emojis = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
      ensureReplyMonitor(config[idx]).resolveReactionEmojis = emojis.length > 0 ? emojis : ['✅'];
      renderGuilds();
    }

    async function openRoleSelector(idx) {
      const guild = config[idx];
      const rm = ensureReplyMonitor(guild);
      const modal = document.getElementById('modal-container');
      modal.innerHTML = '<div class="modal-overlay"><div class="modal"><div class="loading">ロールを読み込み中...</div></div></div>';

      try {
        const res = await fetch(\`/admin/api/guilds/\${guild.guildId}/roles\`);
        const roles = await res.json();

        modal.innerHTML = \`
          <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()">
              <h3>運営ロールを選択</h3>
              <div class="checkbox-list">
                \${roles.map(r => \`
                  <label class="checkbox-item">
                    <input type="checkbox" value="\${r.id}" \${rm.staffRoleIds.includes(r.id) ? 'checked' : ''}>
                    @\${escapeHtml(r.name)} <span style="color:#72767d;font-size:11px">(\${r.id})</span>
                  </label>
                \`).join('')}
              </div>
              <div class="row" style="margin-top: 15px;">
                <button onclick="confirmRoleSelection(\${idx})">適用</button>
                <button class="secondary" onclick="closeModal()">キャンセル</button>
              </div>
            </div>
          </div>
        \`;
      } catch (e) {
        modal.innerHTML = '';
        showStatus('ロールの取得に失敗しました: ' + e.message, 'error');
      }
    }

    async function showReplyStatus(idx) {
      const guild = config[idx];
      const modal = document.getElementById('modal-container');
      modal.innerHTML = '<div class="modal-overlay"><div class="modal"><div class="loading">未返信状況を読み込み中...</div></div></div>';

      try {
        const res = await fetch(\`/admin/api/guilds/\${guild.guildId}/reply-status\`);
        const state = await res.json();

        const entries = Object.values(state);
        const awaiting = entries.filter(s => s.awaitingReply && !s.hasStaffCheck)
          .sort((a, b) => (a.awaitingSince || '').localeCompare(b.awaitingSince || ''));
        const errors = entries.filter(s => s.lastError);

        const awaitingHtml = awaiting.length === 0
          ? '<p>未返信のチャンネルはありません。</p>'
          : awaiting.map(s => \`
              <div class="checkbox-item">
                <a href="https://discord.com/channels/\${guild.guildId}/\${s.channelId}/\${s.awaitingSinceMessageId || ''}"
                   target="_blank" rel="noopener" style="color:#7289da;">#\${escapeHtml(s.channelName)}</a>
                <span style="color:#72767d;font-size:12px;">\${s.awaitingSince ? new Date(s.awaitingSince).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + ' から' : ''}</span>
              </div>
            \`).join('');

        const errorHtml = errors.length === 0 ? '' : \`
          <div class="category-name" style="color:#ed4245;">取得できないチャンネル（権限を確認してください）</div>
          \${errors.map(s => \`<div class="checkbox-item">#\${escapeHtml(s.channelName)} <span style="color:#72767d;font-size:11px;">\${escapeHtml(s.lastError || '')}</span></div>\`).join('')}
        \`;

        modal.innerHTML = \`
          <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()">
              <h3>未返信状況 — \${escapeHtml(guild.guildName)}（\${awaiting.length}件）</h3>
              <div class="checkbox-list">\${awaitingHtml}\${errorHtml}</div>
              <div class="row" style="margin-top: 15px;">
                <button class="secondary" onclick="closeModal()">閉じる</button>
              </div>
            </div>
          </div>
        \`;
      } catch (e) {
        modal.innerHTML = '';
        showStatus('未返信状況の取得に失敗しました: ' + e.message, 'error');
      }
    }

    function confirmRoleSelection(idx) {
      const checkboxes = document.querySelectorAll('.checkbox-list input[type="checkbox"]:checked');
      const ids = Array.from(checkboxes).map(cb => cb.value);
      ensureReplyMonitor(config[idx]).staffRoleIds = ids;
      closeModal();
      renderGuilds();
    }

    function toggleSection(el) {
      const content = el.parentElement.nextElementSibling;
      content.classList.toggle('hidden');
      el.textContent = el.textContent.startsWith('▼')
        ? el.textContent.replace('▼', '▶')
        : el.textContent.replace('▶', '▼');
    }

    function updateField(idx, field, value) {
      config[idx][field] = value;
    }

    function removeFromList(idx, field, value) {
      const current = getList(config[idx], field);
      setList(config[idx], field, current.filter(v => v !== value));
      renderGuilds();
    }

    function removeGuild(idx) {
      if (confirm('このサーバーを削除しますか？')) {
        config.splice(idx, 1);
        renderGuilds();
      }
    }

    async function addGuild() {
      const unregistered = availableGuilds.filter(g => !config.find(c => c.guildId === g.id));
      if (unregistered.length === 0) {
        showStatus('全てのサーバーが登録済みです', 'error');
        return;
      }

      const modal = document.getElementById('modal-container');
      modal.innerHTML = \`
        <div class="modal-overlay" onclick="closeModal(event)">
          <div class="modal" onclick="event.stopPropagation()">
            <h3>サーバーを追加</h3>
            <select id="guild-select">
              \${unregistered.map(g => \`<option value="\${g.id}">\${escapeHtml(g.name)}</option>\`).join('')}
            </select>
            <div class="section-title" style="margin-top: 10px;">Webhook URL（権限エラー通知先）</div>
            <input type="text" id="webhook-input" placeholder="https://discord.com/api/webhooks/...">
            <div class="row" style="margin-top: 15px;">
              <button onclick="confirmAddGuild()">追加</button>
              <button class="secondary" onclick="closeModal()">キャンセル</button>
            </div>
          </div>
        </div>
      \`;
    }

    async function confirmAddGuild() {
      const guildId = document.getElementById('guild-select').value;
      const webhookUrl = document.getElementById('webhook-input').value;
      const guild = availableGuilds.find(g => g.id === guildId);

      config.push({
        guildId: guildId,
        guildName: guild.name,
        alertWebhookUrl: webhookUrl,
        whitelistChannelIds: [],
        replyMonitor: { enabled: false, staffRoleIds: [], excludedChannelIds: [], resolveReactionEmojis: ['✅'] }
      });
      closeModal();
      // 新しいギルドのキャッシュをロード
      await loadGuildCache(guildId);
      renderGuilds();
    }

    async function openChannelSelector(idx, field) {
      const guild = config[idx];
      const modal = document.getElementById('modal-container');
      modal.innerHTML = '<div class="modal-overlay"><div class="modal"><div class="loading">チャンネルを読み込み中...</div></div></div>';

      try {
        const res = await fetch(\`/admin/api/guilds/\${guild.guildId}/channels\`);
        const data = await res.json();

        const currentIds = getList(guild, field);

        modal.innerHTML = \`
          <div class="modal-overlay" onclick="closeModal(event)">
            <div class="modal" onclick="event.stopPropagation()">
              <h3>チャンネルを選択</h3>
              <div class="checkbox-list">
                \${data.categories.map(cat => \`
                  <div class="category-name">\${escapeHtml(cat.name)}</div>
                  \${cat.channels.map(ch => \`
                    <label class="checkbox-item">
                      <input type="checkbox" value="\${ch.id}" \${currentIds.includes(ch.id) ? 'checked' : ''}>
                      #\${escapeHtml(ch.name)} <span style="color:#72767d;font-size:11px">(\${ch.id})</span>
                    </label>
                  \`).join('')}
                \`).join('')}
                \${data.uncategorized.length ? \`
                  <div class="category-name">カテゴリなし</div>
                  \${data.uncategorized.map(ch => \`
                    <label class="checkbox-item">
                      <input type="checkbox" value="\${ch.id}" \${currentIds.includes(ch.id) ? 'checked' : ''}>
                      #\${escapeHtml(ch.name)} <span style="color:#72767d;font-size:11px">(\${ch.id})</span>
                    </label>
                  \`).join('')}
                \` : ''}
              </div>
              <div class="row" style="margin-top: 15px;">
                <button onclick="confirmChannelSelection(\${idx}, '\${field}')">適用</button>
                <button class="secondary" onclick="closeModal()">キャンセル</button>
              </div>
            </div>
          </div>
        \`;
      } catch (e) {
        modal.innerHTML = '';
        showStatus('チャンネルの取得に失敗しました: ' + e.message, 'error');
      }
    }

    function confirmChannelSelection(idx, field) {
      const checkboxes = document.querySelectorAll('.checkbox-list input[type="checkbox"]:checked');
      const ids = Array.from(checkboxes).map(cb => cb.value);
      setList(config[idx], field, ids);
      closeModal();
      renderGuilds();
    }

    function closeModal(event) {
      if (!event || event.target.classList.contains('modal-overlay')) {
        document.getElementById('modal-container').innerHTML = '';
      }
    }

    async function saveAllConfig() {
      try {
        const res = await fetch('/admin/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });
        if (res.ok) {
          showStatus('設定を保存しました', 'success');
        } else {
          throw new Error('保存に失敗しました');
        }
      } catch (e) {
        showStatus('保存に失敗しました: ' + e.message, 'error');
      }
    }

    function showStatus(message, type) {
      const el = document.getElementById('status');
      el.className = 'status ' + type;
      el.textContent = message;
      setTimeout(() => el.textContent = '', 5000);
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    init();
  </script>
</body>
</html>`;
}
