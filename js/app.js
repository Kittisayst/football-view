// ══════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════
const API = {
  espn: 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world',
  espnStandings: 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings',
};

const WC_START = '2026-06-11';
const WC_END   = '2026-07-19';

let currentTab = 'today';
const loaded = {};

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════
const toYMD = d => d.replace(/-/g, '');

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function clampDate(d) {
  if (d < WC_START) return WC_START;
  if (d > WC_END)   return WC_END;
  return d;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('lo-LA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit' });
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ══════════════════════════════════════════════════════
//  UI TEMPLATES
// ══════════════════════════════════════════════════════
function spinnerHTML(msg = 'ກຳລັງໂຫລດ...') {
  return `<div class="loading-wrap">
    <div class="spinner-border mb-3" role="status"><span class="visually-hidden">Loading</span></div>
    <p>${msg}</p>
  </div>`;
}

function errorHTML(msg) {
  return `<div class="error-box">
    <i class="fas fa-exclamation-circle fa-2x mb-3 d-block"></i>
    <p class="mb-3">${msg}</p>
    <button class="btn-gold" onclick="retry()"><i class="fas fa-redo me-1"></i>ລອງໃໝ່</button>
  </div>`;
}

function emptyHTML(msg = 'ບໍ່ມີຂໍ້ມູນ') {
  return `<div class="empty-state">
    <i class="fas fa-calendar-times fa-3x mb-3 d-block" style="color:var(--text-muted)"></i>
    <p>${msg}</p>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  MATCH CARD RENDERING
// ══════════════════════════════════════════════════════
function getStatusInfo(comp) {
  const s   = comp.status.type;
  const clk = comp.status.displayClock || '';
  const per = comp.status.period || 0;

  if (s.state === 'in') {
    let txt = 'LIVE';
    if (s.name === 'STATUS_HALFTIME') txt = 'ພັກຄlr';
    else if (per === 1) txt = `ຄlr.1 ${clk}`;
    else if (per === 2) txt = `ຄlr.2 ${clk}`;
    else txt = s.shortDetail || 'LIVE';
    return { cls: 'status-live', text: txt, state: 'live' };
  }
  if (s.state === 'post') {
    return { cls: 'status-final', text: s.shortDetail || 'FT', state: 'post' };
  }
  return { cls: 'status-upcoming', text: fmtTime(comp.startDate || ''), state: 'pre' };
}

function teamBlock(t, isWinner) {
  const logo = t.team.logo || '';
  const name = t.team.displayName || t.team.name;
  const abbr = t.team.abbreviation || '';
  const logoEl = logo
    ? `<img src="${logo}" class="team-logo" alt="${name}" onerror="this.parentNode.innerHTML='<span class=team-flag>⚽</span>'">`
    : `<span class="team-flag">⚽</span>`;
  return `<div class="team-col">
    ${logoEl}
    <div class="team-name ${isWinner ? 'text-warning' : ''}">${name}</div>
    <div class="team-abbr">${abbr}</div>
  </div>`;
}

function renderCard(ev) {
  const comp     = ev.competitions[0];
  const home     = comp.competitors.find(c => c.homeAway === 'home') || comp.competitors[0];
  const away     = comp.competitors.find(c => c.homeAway === 'away') || comp.competitors[1];
  const si       = getStatusInfo(comp);
  const isLive   = si.state === 'live';
  const showScore = isLive || si.state === 'post';

  const scoreEl = showScore
    ? `<div class="score-digits">
        <span>${home.score ?? 0}</span>
        <span class="score-sep">:</span>
        <span>${away.score ?? 0}</span>
       </div>`
    : `<div class="kickoff-time">${fmtTime(ev.date)}</div>`;

  const badgeEl = isLive
    ? `<span class="badge-status status-live"><span class="pulse-dot"></span>${si.text}</span>`
    : `<span class="badge-status ${si.cls}">${si.text}</span>`;

  const notes  = comp.notes?.[0]?.headline || ev.notes?.[0]?.headline || '';
  const venue  = comp.venue?.fullName || '';
  const groupEl = notes ? `<div class="match-meta"><i class="fas fa-layer-group me-1"></i>${notes}</div>` : '';
  const venueEl = venue ? `<div class="match-meta"><i class="fas fa-map-marker-alt me-1"></i>${venue}</div>` : '';

  return `<div class="match-card ${isLive ? 'is-live' : ''}">
    <div class="row align-items-center g-0">
      <div class="col-4">${teamBlock(home, home.winner)}</div>
      <div class="col-4 score-col">
        ${scoreEl}
        ${badgeEl}
        ${groupEl}
        ${venueEl}
      </div>
      <div class="col-4">${teamBlock(away, away.winner)}</div>
    </div>
  </div>`;
}

function groupByDate(events) {
  return events.reduce((acc, ev) => {
    const d = ev.date.split('T')[0];
    (acc[d] = acc[d] || []).push(ev);
    return acc;
  }, {});
}

function renderEventList(events) {
  if (!events.length) return emptyHTML('ບໍ່ມີການແຂ່ງຂັນໃນຊ່ວງນີ້');
  const byDate = groupByDate(events);
  return Object.keys(byDate).sort().map(d => `
    <div class="section-date">
      <span class="date-label">${fmtDate(d)}</span>
      <span class="badge ms-1" style="background:rgba(240,180,41,.15);color:var(--gold)">${byDate[d].length} ຄູ່</span>
      <hr />
    </div>
    ${byDate[d].map(renderCard).join('')}
  `).join('');
}

// ══════════════════════════════════════════════════════
//  DATA LOADERS
// ══════════════════════════════════════════════════════
async function loadDay(date) {
  const el = document.getElementById('body-today');
  el.innerHTML = spinnerHTML();
  try {
    const data = await fetchJSON(`${API.espn}/scoreboard?dates=${toYMD(date)}&limit=100`);
    const evs  = data.events || [];
    document.getElementById('todayCount').textContent = evs.length ? `${evs.length} ການແຂ່ງຂັນ` : '';
    el.innerHTML = renderEventList(evs);
  } catch (e) {
    el.innerHTML = errorHTML('ດຶງຂໍ້ມູນບໍ່ໄດ້: ' + e.message);
  }
}

function jumpToday() {
  const d = clampDate(todayStr());
  document.getElementById('pickerToday').value = d;
  loadDay(d);
}

async function loadSchedule() {
  const el   = document.getElementById('body-schedule');
  const from = document.getElementById('sFrom').value;
  const to   = document.getElementById('sTo').value;
  el.innerHTML = spinnerHTML();
  try {
    const data = await fetchJSON(`${API.espn}/scoreboard?dates=${toYMD(from)}-${toYMD(to)}&limit=200`);
    const evs  = (data.events || []).filter(e => e.competitions[0].status.type.state !== 'post');
    el.innerHTML = renderEventList(evs);
  } catch (e) {
    el.innerHTML = errorHTML('ດຶງຂໍ້ມູນບໍ່ໄດ້: ' + e.message);
  }
}

async function loadResults() {
  const el = document.getElementById('body-results');
  el.innerHTML = spinnerHTML();
  try {
    const today = todayStr();
    const end   = today < WC_END ? today : WC_END;
    const data  = await fetchJSON(`${API.espn}/scoreboard?dates=${toYMD(WC_START)}-${toYMD(end)}&limit=300`);
    const evs   = (data.events || [])
      .filter(e => e.competitions[0].status.type.state === 'post')
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    el.innerHTML = renderEventList(evs);
  } catch (e) {
    el.innerHTML = errorHTML('ດຶງຂໍ້ມູນບໍ່ໄດ້: ' + e.message);
  }
}

async function loadStandings() {
  const el = document.getElementById('body-standings');
  el.innerHTML = spinnerHTML();
  try {
    const data   = await fetchJSON(API.espnStandings);
    const groups = data.standings?.entries
      ? [data.standings]
      : (data.children || data.standings?.children || []);

    if (!groups.length) { el.innerHTML = emptyHTML('ຍັງບໍ່ມີຕາຕາລາງຄະແນນ'); return; }
    el.innerHTML = groups.map(renderGroupStandings).join('');
  } catch (e) {
    el.innerHTML = errorHTML('ດຶງຂໍ້ມູນບໍ່ໄດ້: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════
//  STANDINGS RENDERING
// ══════════════════════════════════════════════════════
function renderGroupStandings(group) {
  const name    = group.name || group.abbreviation || 'Group';
  const entries = group.standings?.entries || group.entries || [];
  if (!entries.length) return '';

  const rows = entries.map((ent, i) => {
    const st  = Object.fromEntries((ent.stats || []).map(s => [s.name, s.value]));
    const gp  = st.gamesPlayed   ?? 0;
    const w   = st.wins          ?? 0;
    const d   = st.ties ?? st.draws ?? 0;
    const l   = st.losses        ?? 0;
    const gf  = st.pointsFor     ?? st.goalsFor ?? 0;
    const ga  = st.pointsAgainst ?? st.goalsAgainst ?? 0;
    const gd  = st.pointDifferential ?? (gf - ga);
    const pts = st.points        ?? 0;
    const pos = st.rank          ?? i + 1;
    const logo  = ent.team?.logos?.[0]?.href ?? '';
    const tname = ent.team?.displayName ?? ent.team?.name ?? '—';
    const qualify = i < 2 ? 'qualify-border' : '';

    return `<tr class="${qualify}">
      <td><strong>${pos}</strong></td>
      <td>
        <div class="d-flex align-items-center gap-2">
          ${logo ? `<img src="${logo}" height="20" alt="${tname}" onerror="this.remove()">` : ''}
          <span>${tname}</span>
        </div>
      </td>
      <td>${gp}</td><td>${w}</td><td>${d}</td><td>${l}</td>
      <td>${gf}</td><td>${ga}</td>
      <td>${gd > 0 ? '+' : ''}${gd}</td>
      <td><strong style="color:var(--gold)">${pts}</strong></td>
    </tr>`;
  }).join('');

  return `<div class="group-block">
    <div class="group-title"><i class="fas fa-layer-group me-2"></i>${name}</div>
    <div class="standings-tbl">
      <table class="table table-borderless mb-0">
        <thead>
          <tr>
            <th>#</th><th>ທີມ</th><th>P</th>
            <th>W</th><th>D</th><th>L</th>
            <th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="mt-2" style="font-size:.72rem;color:var(--text-muted)">
      <span style="border-left:3px solid var(--green);padding-left:6px">ຜ່ານເຂົ້າຮອບຕໍ່ໄປ</span>
    </p>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  STATS BAR
// ══════════════════════════════════════════════════════
async function refreshStats() {
  try {
    const today = clampDate(todayStr());
    const data  = await fetchJSON(`${API.espn}/scoreboard?dates=${toYMD(today)}&limit=100`);
    const evs   = data.events || [];
    document.getElementById('s-total').textContent    = evs.length;
    document.getElementById('s-live').textContent     = evs.filter(e => e.competitions[0].status.type.state === 'in').length;
    document.getElementById('s-done').textContent     = evs.filter(e => e.competitions[0].status.type.state === 'post').length;
    document.getElementById('s-upcoming').textContent = evs.filter(e => e.competitions[0].status.type.state === 'pre').length;
  } catch (_) {}
}

// ══════════════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════════════
function showTab(tab) {
  ['today', 'schedule', 'results', 'standings'].forEach(t => {
    document.getElementById(`pane-${t}`).style.display = t === tab ? '' : 'none';
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  currentTab = tab;

  if (!loaded[tab]) {
    loaded[tab] = true;
    if (tab === 'schedule')  loadSchedule();
    if (tab === 'results')   loadResults();
    if (tab === 'standings') loadStandings();
  }
}

function retry() {
  if (currentTab === 'today')     jumpToday();
  if (currentTab === 'schedule')  loadSchedule();
  if (currentTab === 'results')   loadResults();
  if (currentTab === 'standings') loadStandings();
}

// ══════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════
(function init() {
  const d = clampDate(todayStr());
  document.getElementById('pickerToday').value = d;
  loadDay(d);
  refreshStats();

  setInterval(() => {
    if (currentTab === 'today') {
      const val = document.getElementById('pickerToday').value;
      if (val === todayStr()) loadDay(val);
    }
    refreshStats();
  }, 30_000);
})();
