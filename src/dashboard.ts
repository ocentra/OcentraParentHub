export function dashboardHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ocentra Ledger</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f8;
      --surface: #ffffff;
      --surface-2: #f1f5f4;
      --text: #17201c;
      --muted: #64716c;
      --line: #dbe3df;
      --accent: #087f68;
      --accent-2: #b45f06;
      --danger: #b42318;
      --shadow: 0 16px 45px rgba(18, 31, 27, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    button, input { font: inherit; }
    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      background: rgba(255, 255, 255, 0.92);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(14px);
    }
    .topbar {
      max-width: 1480px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 220px;
    }
    .mark {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: linear-gradient(135deg, #087f68, #1f9d8a 55%, #f0b429);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.5);
    }
    h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.15;
      font-weight: 750;
    }
    .subtle {
      margin-top: 2px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.3;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .token {
      width: min(280px, 42vw);
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
    }
    .btn {
      height: 36px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
    }
    .btn.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: white;
      font-weight: 650;
    }
    .btn:hover { border-color: var(--accent); }
    main {
      width: 100%;
      max-width: 1480px;
      margin: 0 auto;
      padding: 20px 24px 28px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(8, minmax(112px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .metric {
      min-height: 74px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .metric .value {
      font-size: 24px;
      line-height: 1;
      font-weight: 760;
    }
    .metric .label {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.2;
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(320px, 1.1fr) minmax(320px, 0.9fr) minmax(320px, 0.95fr);
      gap: 14px;
      align-items: start;
    }
    section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .section-head {
      padding: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border-bottom: 1px solid var(--line);
      background: var(--surface-2);
    }
    h2 {
      margin: 0;
      font-size: 14px;
      font-weight: 760;
      line-height: 1.2;
    }
    .count {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .list {
      display: grid;
      gap: 0;
    }
    .row {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      display: grid;
      gap: 7px;
    }
    .row:last-child { border-bottom: 0; }
    .row-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .title {
      min-width: 0;
      font-size: 13px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .body {
      color: var(--text);
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .meta {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .status {
      display: inline-flex;
      align-items: center;
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: #fff;
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .status.good { color: var(--accent); border-color: rgba(8,127,104,0.35); background: #eefaf6; }
    .status.warn { color: var(--accent-2); border-color: rgba(180,95,6,0.35); background: #fff7ed; }
    .status.bad { color: var(--danger); border-color: rgba(180,35,24,0.35); background: #fff3f1; }
    .empty {
      padding: 26px 14px;
      color: var(--muted);
      font-size: 13px;
      text-align: center;
    }
    .mini-btn {
      height: 28px;
      padding: 0 9px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      color: var(--text);
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
    }
    .mini-btn:hover { border-color: var(--accent); color: var(--accent); }
    .streams {
      max-height: 280px;
      overflow: auto;
    }
    .error {
      display: none;
      margin-bottom: 14px;
      padding: 12px 14px;
      border: 1px solid rgba(180,35,24,0.35);
      border-radius: 8px;
      background: #fff3f1;
      color: var(--danger);
      font-size: 13px;
    }
    .error.visible { display: block; }
    @media (max-width: 1180px) {
      .metrics { grid-template-columns: repeat(4, minmax(112px, 1fr)); }
      .grid { grid-template-columns: 1fr 1fr; }
      .grid section:first-child { grid-column: 1 / -1; }
    }
    @media (max-width: 760px) {
      .topbar { align-items: flex-start; flex-direction: column; padding: 14px; }
      main { padding: 14px; }
      .toolbar { width: 100%; justify-content: stretch; }
      .token { width: 100%; flex: 1 1 100%; }
      .btn { flex: 1 1 auto; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="topbar">
        <div class="brand">
          <div class="mark" aria-hidden="true"></div>
          <div>
            <h1>Ocentra Ledger</h1>
            <div class="subtle" id="health">Checking daemon health</div>
          </div>
        </div>
        <div class="toolbar">
          <input class="token" id="token" type="password" autocomplete="off" placeholder="Bearer token if required">
          <button class="btn" id="save-token" type="button">Save Token</button>
          <button class="btn primary" id="refresh" type="button">Refresh</button>
        </div>
      </div>
    </header>
    <main>
      <div class="error" id="error"></div>
      <div class="metrics" id="metrics"></div>
      <div class="grid">
        <section>
          <div class="section-head">
            <h2>Inbox</h2>
            <span class="count" id="inbox-count">0 unread</span>
          </div>
          <div class="list" id="inbox"></div>
        </section>
        <section>
          <div class="section-head">
            <h2>Workers</h2>
            <span class="count" id="worker-count">0 workers</span>
          </div>
          <div class="list" id="workers"></div>
        </section>
        <section>
          <div class="section-head">
            <h2>Active Tasks</h2>
            <span class="count" id="task-count">0 active</span>
          </div>
          <div class="list" id="tasks"></div>
        </section>
        <section>
          <div class="section-head">
            <h2>Ownership</h2>
            <span class="count" id="claim-count">0 claims</span>
          </div>
          <div class="list" id="ownership"></div>
        </section>
        <section>
          <div class="section-head">
            <h2>Lanes</h2>
            <span class="count" id="lane-count">0 lanes</span>
          </div>
          <div class="list" id="lanes"></div>
        </section>
        <section>
          <div class="section-head">
            <h2>Streams</h2>
            <span class="count" id="stream-count">0 streams</span>
          </div>
          <div class="list streams" id="streams"></div>
        </section>
      </div>
    </main>
  </div>
  <script>
    var tokenInput = document.getElementById('token');
    var savedToken = localStorage.getItem('ledgerToken') || '';
    tokenInput.value = savedToken;
    document.getElementById('save-token').addEventListener('click', function () {
      localStorage.setItem('ledgerToken', tokenInput.value);
      refresh();
    });
    document.getElementById('refresh').addEventListener('click', refresh);
    refresh();
    setInterval(refresh, 10000);

    async function api(path, options) {
      var token = tokenInput.value.trim();
      var headers = Object.assign({}, options && options.headers ? options.headers : {});
      if (token.length > 0) headers.authorization = 'Bearer ' + token;
      var response = await fetch(path, Object.assign({}, options || {}, { headers: headers }));
      if (!response.ok) throw new Error(path + ' returned ' + response.status + ': ' + await response.text());
      return await response.json();
    }

    async function refresh() {
      var error = document.getElementById('error');
      try {
        error.className = 'error';
        var health = await fetch('/health').then(function (response) { return response.json(); });
        document.getElementById('health').textContent = health.ok ? 'Daemon online' : 'Daemon health unknown';
        var state = await api('/state');
        renderMetrics(state.dashboard);
        renderInbox(state.lanes);
        renderWorkers(state.workers);
        renderTasks(state.activeTasks);
        renderOwnership(state.ownership);
        renderLanes(state.lanes);
        renderStreams(await api('/streams'));
      } catch (err) {
        error.textContent = err instanceof Error ? err.message : String(err);
        error.className = 'error visible';
      }
    }

    function renderMetrics(dashboard) {
      var items = [
        ['Events', dashboard.eventCount],
        ['Duplicates', dashboard.duplicateCount],
        ['Lanes', dashboard.laneCount],
        ['Inbox', dashboard.inboxCount],
        ['Stale heartbeats', dashboard.staleHeartbeatCount],
        ['Workers', dashboard.workerCount],
        ['Free workers', dashboard.freeWorkerCount],
        ['Active tasks', dashboard.activeTaskCount]
      ];
      document.getElementById('metrics').innerHTML = items.map(function (item) {
        return '<div class="metric"><div class="value">' + escapeHtml(String(item[1])) + '</div><div class="label">' + escapeHtml(item[0]) + '</div></div>';
      }).join('');
    }

    function renderInbox(lanes) {
      var items = Object.keys(lanes).flatMap(function (laneName) {
        return lanes[laneName].inbox
          .filter(function (item) { return item.ackedBy.length === 0; })
          .map(function (item) { return Object.assign({ laneName: laneName }, item); });
      }).sort(function (a, b) { return b.ts.localeCompare(a.ts); });
      document.getElementById('inbox-count').textContent = items.length + ' unread';
      document.getElementById('inbox').innerHTML = items.length === 0 ? empty('No unread mail') : items.map(function (item) {
        return '<div class="row"><div class="row-top"><div class="title">' + escapeHtml(item.laneName) + '</div><button class="mini-btn" type="button" data-ack="' + escapeHtml(item.id) + '">Ack</button></div><div class="body">' + escapeHtml(item.body || '') + '</div><div class="meta">from ' + escapeHtml(item.from) + ' &middot; ' + escapeHtml(item.ts) + ' &middot; ' + escapeHtml(item.id) + '</div></div>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('[data-ack]'), function (button) {
        button.addEventListener('click', function () { ack(button.getAttribute('data-ack')); });
      });
    }

    async function ack(eventId) {
      if (!eventId) return;
      await api('/commands/ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId: eventId })
      });
      await refresh();
    }

    function renderWorkers(workers) {
      var items = Object.keys(workers).map(function (key) { return workers[key]; })
        .sort(function (a, b) { return a.lane.localeCompare(b.lane); });
      document.getElementById('worker-count').textContent = items.length + ' workers';
      document.getElementById('workers').innerHTML = items.length === 0 ? empty('No worker events yet') : items.map(function (worker) {
        var status = worker.free ? 'good' : worker.state === 'blocked' || worker.state === 'offline' ? 'bad' : 'warn';
        return '<div class="row"><div class="row-top"><div class="title">' + escapeHtml(worker.lane) + '</div><span class="status ' + status + '">' + escapeHtml(worker.state) + '</span></div><div class="body">' + escapeHtml(worker.summary || 'No summary') + '</div><div class="meta">' + escapeHtml(worker.writer) + ' &middot; last seen ' + escapeHtml(worker.lastSeenAt) + '</div></div>';
      }).join('');
    }

    function renderTasks(tasks) {
      document.getElementById('task-count').textContent = tasks.length + ' active';
      document.getElementById('tasks').innerHTML = tasks.length === 0 ? empty('No active tasks') : tasks.map(function (task) {
        return '<div class="row"><div class="row-top"><div class="title">' + escapeHtml(task.taskId) + '</div><span class="status warn">' + escapeHtml(task.state) + '</span></div><div class="body">' + escapeHtml(task.summary) + '</div><div class="meta">' + escapeHtml(task.lane) + ' &middot; ' + escapeHtml(task.updatedAt) + optionalLink(task.prUrl) + '</div></div>';
      }).join('');
    }

    function renderOwnership(ownership) {
      var claims = ownership.activeClaims || [];
      var conflicts = ownership.conflicts || [];
      document.getElementById('claim-count').textContent = claims.length + ' claims / ' + conflicts.length + ' conflicts';
      var conflictRows = conflicts.map(function (conflict) {
        return '<div class="row"><div class="row-top"><div class="title">Conflict</div><span class="status bad">blocked</span></div><div class="body">' + escapeHtml(conflict.paths.join(', ')) + '</div><div class="meta">' + escapeHtml(conflict.lanes.join(' <-> ')) + '</div></div>';
      });
      var claimRows = claims.map(function (claim) {
        return '<div class="row"><div class="row-top"><div class="title">' + escapeHtml(claim.lane) + '</div><span class="status warn">claimed</span></div><div class="body">' + escapeHtml(claim.paths.join(', ')) + '</div><div class="meta">' + escapeHtml(claim.writer) + '</div></div>';
      });
      document.getElementById('ownership').innerHTML = conflictRows.concat(claimRows).join('') || empty('No active claims');
    }

    function renderLanes(lanes) {
      var items = Object.keys(lanes).sort().map(function (laneName) { return lanes[laneName]; });
      document.getElementById('lane-count').textContent = items.length + ' lanes';
      document.getElementById('lanes').innerHTML = items.length === 0 ? empty('No lanes registered') : items.map(function (lane) {
        var heartbeat = lane.heartbeat;
        var state = heartbeat ? heartbeat.state : lane.status ? lane.status.state : 'unknown';
        var stale = heartbeat && heartbeat.stale;
        return '<div class="row"><div class="row-top"><div class="title">' + escapeHtml(lane.lane) + '</div><span class="status ' + (stale ? 'bad' : 'good') + '">' + escapeHtml(state) + '</span></div><div class="body">' + escapeHtml((heartbeat && heartbeat.summary) || (lane.status && lane.status.summary) || 'No status') + '</div><div class="meta">' + lane.inbox.length + ' mail / ' + lane.registeredWriters.length + ' writers</div></div>';
      }).join('');
    }

    function renderStreams(payload) {
      var streams = payload.streams || [];
      document.getElementById('stream-count').textContent = streams.length + ' streams';
      document.getElementById('streams').innerHTML = streams.length === 0 ? empty('No streams written yet') : streams.map(function (stream) {
        return '<div class="row"><div class="title">' + escapeHtml(stream) + '</div></div>';
      }).join('');
    }

    function empty(text) {
      return '<div class="empty">' + escapeHtml(text) + '</div>';
    }

    function optionalLink(url) {
      return url ? ' &middot; <a href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer">PR</a>' : '';
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function (char) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
      });
    }
  </script>
</body>
</html>`;
}
