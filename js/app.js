// ══════════════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════════════
const API = {
  espn:          'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world',
  espnStandings: 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings',
};

const WC_START = '2026-06-11';
const WC_END   = '2026-07-19';

let currentTab      = 'today';
let currentModalTab = 'timeline';
let bsModal         = null;
let modalData       = null;   // cached summary data for tab switching
const loaded        = {};

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
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)   return 'ຫາກໍ່ຜ່ານ';
  if (diff < 3600) return `${Math.floor(diff/60)} ນາທີ`;
  if (diff < 86400)return `${Math.floor(diff/3600)} ຊົ່ວໂມງ`;
  return `${Math.floor(diff/86400)} ວັນ`;
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
    let txt = s.name === 'STATUS_HALFTIME' ? 'ພັກ' : per === 1 ? `ຄ.1 ${clk}` : per === 2 ? `ຄ.2 ${clk}` : s.shortDetail || 'LIVE';
    return { cls: 'status-live', text: txt, state: 'live' };
  }
  if (s.state === 'post') return { cls: 'status-final', text: s.shortDetail || 'FT', state: 'post' };
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

function oddsStripHTML(odds) {
  if (!odds || !odds.length) return '';
  const o = odds[0];
  const home = o.homeTeamOdds?.moneyLine;
  const draw = o.drawOdds?.moneyLine;
  const away = o.awayTeamOdds?.moneyLine;
  if (!home && !draw && !away) return '';
  const fmt = v => v == null ? '—' : (v > 0 ? '+' + v : v);
  return `<div class="card-odds">
    <div class="card-odds-chip"><span class="ok-label">ເຈົ້າບ້ານ</span><span class="ok-val">${fmt(home)}</span></div>
    <div class="card-odds-chip"><span class="ok-label">ເສ</span><span class="ok-val">${fmt(draw)}</span></div>
    <div class="card-odds-chip"><span class="ok-label">ແຂກ</span><span class="ok-val">${fmt(away)}</span></div>
  </div>`;
}

function renderCard(ev, odds = null) {
  const comp      = ev.competitions[0];
  const home      = comp.competitors.find(c => c.homeAway === 'home') || comp.competitors[0];
  const away      = comp.competitors.find(c => c.homeAway === 'away') || comp.competitors[1];
  const si        = getStatusInfo(comp);
  const isLive    = si.state === 'live';
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

  const notes   = comp.notes?.[0]?.headline || ev.notes?.[0]?.headline || '';
  const venue   = comp.venue?.fullName || '';
  const groupEl = notes ? `<div class="match-meta"><i class="fas fa-layer-group me-1"></i>${notes}</div>` : '';
  const venueEl = venue ? `<div class="match-meta"><i class="fas fa-map-marker-alt me-1"></i>${venue}</div>` : '';
  const oddsEl  = odds ? oddsStripHTML(odds) : '';

  return `<div class="match-card ${isLive ? 'is-live' : ''}" onclick="openMatchDetail('${ev.id}')">
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
    ${oddsEl}
    <div class="card-click-hint"><i class="fas fa-info-circle me-1"></i>ກົດເພື່ອລາຍລະອຽດ</div>
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
    ${byDate[d].map(ev => renderCard(ev)).join('')}
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
    const groups = data.standings?.entries ? [data.standings] : (data.children || data.standings?.children || []);
    if (!groups.length) { el.innerHTML = emptyHTML('ຍັງບໍ່ມີຕາຕາລາງຄະແນນ'); return; }
    el.innerHTML = groups.map(renderGroupStandings).join('');
  } catch (e) {
    el.innerHTML = errorHTML('ດຶງຂໍ້ມູນບໍ່ໄດ້: ' + e.message);
  }
}

async function loadNews() {
  const el = document.getElementById('body-news');
  el.innerHTML = spinnerHTML('ກຳລັງໂຫລດຂ່າວ...');
  try {
    const data     = await fetchJSON(`${API.espn}/news?limit=24`);
    const articles = data.articles || [];
    if (!articles.length) { el.innerHTML = emptyHTML('ບໍ່ມີຂ່າວ'); return; }
    el.innerHTML = `<div class="news-grid">${articles.map(renderNewsCard).join('')}</div>`;
  } catch (e) {
    el.innerHTML = errorHTML('ດຶງຂ່າວບໍ່ໄດ້: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════
//  NEWS CARD
// ══════════════════════════════════════════════════════
function renderNewsCard(a) {
  const img     = a.images?.find(i => i.type === 'header') || a.images?.[0];
  const imgEl   = img
    ? `<img src="${img.url}" class="news-img" alt="${a.headline}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=news-img-placeholder>📰</div>'">`
    : `<div class="news-img-placeholder">📰</div>`;
  const link    = a.links?.web?.href || a.links?.mobile?.href || '#';
  const isExt   = link !== '#';
  const dateStr = a.published ? timeAgo(a.published) + ' ທີ່ຜ່ານມາ' : '';

  return `<div class="news-card" ${isExt ? `onclick="window.open('${link}','_blank')" style="cursor:pointer"` : ''}>
    ${imgEl}
    <div class="news-body">
      <div class="news-headline">${a.headline || ''}</div>
      ${a.description ? `<div class="news-desc">${a.description}</div>` : ''}
      <div class="news-meta">
        ${dateStr}
        ${isExt ? '<span class="ms-2"><i class="fas fa-external-link-alt" style="font-size:.6rem"></i> ESPN</span>' : ''}
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  STANDINGS RENDERING
// ══════════════════════════════════════════════════════
function renderGroupStandings(group) {
  const name    = group.name || group.abbreviation || 'Group';
  const entries = group.standings?.entries || group.entries || [];
  if (!entries.length) return '';

  const rows = entries.map((ent, i) => {
    const st    = Object.fromEntries((ent.stats || []).map(s => [s.name, s.value]));
    const gp    = st.gamesPlayed   ?? 0;
    const w     = st.wins          ?? 0;
    const d     = st.ties ?? st.draws ?? 0;
    const l     = st.losses        ?? 0;
    const gf    = st.pointsFor     ?? st.goalsFor ?? 0;
    const ga    = st.pointsAgainst ?? st.goalsAgainst ?? 0;
    const gd    = st.pointDifferential ?? (gf - ga);
    const pts   = st.points        ?? 0;
    const pos   = st.rank          ?? i + 1;
    const logo  = ent.team?.logos?.[0]?.href ?? '';
    const tname = ent.team?.displayName ?? ent.team?.name ?? '—';
    return `<tr class="${i < 2 ? 'qualify-border' : ''}">
      <td><strong>${pos}</strong></td>
      <td><div class="d-flex align-items-center gap-2">
        ${logo ? `<img src="${logo}" height="20" alt="" onerror="this.remove()">` : ''}
        <span>${tname}</span>
      </div></td>
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
        <thead><tr>
          <th>#</th><th>ທີມ</th><th>P</th><th>W</th><th>D</th><th>L</th>
          <th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="mt-2" style="font-size:.72rem;color:var(--text-muted)">
      <span style="border-left:3px solid var(--green);padding-left:6px">ຜ່ານເຂົ້າຮອບຕໍ່ໄປ</span>
    </p>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  MATCH DETAIL MODAL
// ══════════════════════════════════════════════════════
async function openMatchDetail(eventId) {
  // Init Bootstrap modal once
  if (!bsModal) bsModal = new bootstrap.Modal(document.getElementById('matchModal'));

  // Reset modal state
  document.getElementById('modal-match-header').innerHTML = '';
  document.getElementById('modal-match-body').innerHTML   = spinnerHTML();
  document.getElementById('modal-tab-bar').style.display  = 'none';
  bsModal.show();

  try {
    const data = await fetchJSON(`${API.espn}/summary?event=${eventId}`);
    modalData  = data;
    renderModalContent(data);
  } catch (e) {
    document.getElementById('modal-match-body').innerHTML = errorHTML('ໂຫລດລາຍລະອຽດບໍ່ໄດ້: ' + e.message);
  }
}

function renderModalContent(data) {
  const comp = data.header?.competitions?.[0];
  if (!comp) return;

  const state   = comp.status.type.state;
  const home    = comp.competitors?.find(c => c.homeAway === 'home') || comp.competitors?.[0] || {};
  const away    = comp.competitors?.find(c => c.homeAway === 'away') || comp.competitors?.[1] || {};
  const isLive  = state === 'in';
  const isDone  = state === 'post';

  // ── Header ──────────────────────────────────────────
  const showScore = isLive || isDone;
  const homeLogo  = home.team?.logo || '';
  const awayLogo  = away.team?.logo || '';

  let statusBadge = '';
  if (isLive) statusBadge = `<span class="modal-status-badge status-live"><span class="pulse-dot"></span>${comp.status.type.shortDetail || 'LIVE'}</span>`;
  else if (isDone) statusBadge = `<span class="modal-status-badge status-final">${comp.status.type.shortDetail || 'FT'}</span>`;
  else statusBadge = `<span class="modal-status-badge status-upcoming">${fmtTime(comp.date || '')}</span>`;

  document.getElementById('modal-match-header').innerHTML = `
    <div class="modal-teams-row">
      <div class="modal-team">
        <img src="${homeLogo}" alt="${home.team?.displayName || ''}" onerror="this.style.display='none'">
        <div class="name">${home.team?.displayName || '—'}</div>
        <div class="abbr">${home.team?.abbreviation || ''}</div>
      </div>
      <div class="modal-score-block">
        ${showScore
          ? `<div class="modal-score-digits">
               <span class="${home.winner ? 'text-warning' : ''}">${home.score ?? 0}</span>
               <span class="modal-score-sep">:</span>
               <span class="${away.winner ? 'text-warning' : ''}">${away.score ?? 0}</span>
             </div>`
          : `<div class="modal-kickoff-time">${fmtTime(comp.date || '')}</div>`
        }
        ${statusBadge}
      </div>
      <div class="modal-team">
        <img src="${awayLogo}" alt="${away.team?.displayName || ''}" onerror="this.style.display='none'">
        <div class="name">${away.team?.displayName || '—'}</div>
        <div class="abbr">${away.team?.abbreviation || ''}</div>
      </div>
    </div>`;

  // ── Body ─────────────────────────────────────────────
  if (isLive || isDone) {
    // Show tab bar
    document.getElementById('modal-tab-bar').style.display = 'flex';
    currentModalTab = 'timeline';
    updateModalTabBtns('timeline');
    document.getElementById('modal-match-body').innerHTML = buildModalTabContent(data, 'timeline');
  } else {
    // Pre-match: no tabs, show form + odds + info
    document.getElementById('modal-tab-bar').style.display = 'none';
    document.getElementById('modal-match-body').innerHTML  = buildPreMatchBody(data);
  }
}

function switchModalTab(tab) {
  if (!modalData) return;
  currentModalTab = tab;
  updateModalTabBtns(tab);
  document.getElementById('modal-match-body').innerHTML = buildModalTabContent(modalData, tab);
}

function updateModalTabBtns(active) {
  ['timeline', 'stats', 'lineup'].forEach(t => {
    document.getElementById(`mtab-${t}`)?.classList.toggle('active', t === active);
  });
}

function buildModalTabContent(data, tab) {
  const infoRow  = buildMatchInfoRow(data);
  const oddsHtml = buildOddsHTML(data.odds);
  let   body     = '';

  if (tab === 'timeline') body = buildTimeline(data.keyEvents || []);
  if (tab === 'stats')    body = buildStats(data.boxscore?.teams || []);
  if (tab === 'lineup')   body = buildLineup(data.rosters || []);

  return body + oddsHtml + infoRow;
}

function buildPreMatchBody(data) {
  const formHtml = buildRecentForm(data.boxscore?.form || []);
  const oddsHtml = buildOddsHTML(data.odds);
  const infoRow  = buildMatchInfoRow(data);
  return formHtml + oddsHtml + infoRow;
}

// ── Timeline ────────────────────────────────────────
const TL_ICONS = {
  goal:         '⚽',
  'yellow card':'🟨',
  'red card':   '🟥',
  substitution: '🔄',
  halftime:     '⏸',
  kickoff:      '▶️',
  'end regular':'🏁',
  penalty:      '🎯',
  var:          '📺',
};

function tlIcon(type) {
  const t = (type || '').toLowerCase();
  for (const [key, icon] of Object.entries(TL_ICONS)) {
    if (t.includes(key)) return icon;
  }
  return null;
}

function buildTimeline(keyEvents) {
  // Filter to meaningful events only
  const skip = ['start delay', 'end delay', 'start 2nd half', 'start 3rd'];
  const evs  = keyEvents.filter(e => {
    const t = (e.type?.text || '').toLowerCase();
    return !skip.some(s => t.includes(s));
  });

  if (!evs.length) return emptyHTML('ຍັງບໍ່ມີເຫດການ');

  const rows = evs.map(e => {
    const type  = e.type?.text || '';
    const icon  = tlIcon(type);
    if (!icon) return '';    // skip unknown minor events
    const clock = e.clock?.displayValue ? e.clock.displayValue + '\'' : '';
    const text  = e.text || type;
    const team  = e.team?.displayName || '';
    const t     = type.toLowerCase();
    const cls   = t.includes('goal') ? 'tl-goal' : (t.includes('kickoff') || t.includes('halftime') || t.includes('end regular') ? 'tl-section' : '');
    return `<div class="tl-item ${cls}">
      <div class="tl-icon">${icon}</div>
      <div class="tl-clock">${clock}</div>
      <div class="tl-body">
        <div class="tl-text">${text}</div>
        ${team ? `<div class="tl-team">${team}</div>` : ''}
      </div>
    </div>`;
  }).filter(Boolean).join('');

  return rows ? `<div class="timeline">${rows}</div>` : emptyHTML('ຍັງບໍ່ມີເຫດການ');
}

// ── Stats ────────────────────────────────────────────
const STATS_DEF = [
  ['possessionPct',  'ຄອງລູກ',   v => v.toFixed(1) + '%',       true ],
  ['totalShots',     'ຍິງທັງໝົດ', v => v,                        false],
  ['shotsOnTarget',  'ຍິງໃສ່ເປົ້າ',v => v,                       false],
  ['wonCorners',     'ເຕະມຸມ',    v => v,                        false],
  ['foulsCommitted', 'ຟາວ',       v => v,                        false],
  ['yellowCards',    'ໃບເຫຼືອງ',  v => v,                        false],
  ['redCards',       'ໃບແດງ',     v => v,                        false],
  ['saves',          'ຊ່ວຍ GK',   v => v,                        false],
  ['passPct',        'ສົ່ງ%',      v => Math.round(v * 100) + '%', true ],
  ['totalClearance', 'ຄລຽ',       v => v,                        false],
];

function buildStats(teams) {
  if (!teams || teams.length < 2) return emptyHTML('ຍັງບໍ່ມີ Stats');

  const home = Object.fromEntries((teams[0].statistics || []).map(s => [s.name, s.value]));
  const away = Object.fromEntries((teams[1].statistics || []).map(s => [s.name, s.value]));
  const homeName = teams[0].team?.abbreviation || 'Home';
  const awayName = teams[1].team?.abbreviation || 'Away';

  // Team colour legend
  const legend = `<div class="d-flex justify-content-between mb-3" style="font-size:.75rem;font-weight:600">
    <span style="color:var(--gold)">■ ${homeName}</span>
    <span style="color:var(--blue)">■ ${awayName}</span>
  </div>`;

  const rows = STATS_DEF.map(([key, label, fmt, isPct]) => {
    const hv = home[key] ?? null;
    const av = away[key] ?? null;
    if (hv === null && av === null) return '';

    const h = parseFloat(hv) || 0;
    const a = parseFloat(av) || 0;

    let hPct, aPct;
    if (isPct && key === 'possessionPct') {
      hPct = h; aPct = a;
    } else {
      const total = h + a || 1;
      hPct = (h / total) * 100;
      aPct = (a / total) * 100;
    }

    return `<div class="stat-item">
      <div class="stat-vals">
        <div class="stat-home-v">${fmt(h)}</div>
        <div class="stat-lbl">${label}</div>
        <div class="stat-away-v">${fmt(a)}</div>
      </div>
      <div class="stat-bar-shared">
        <div class="stat-bar-h" style="width:${hPct}%"></div>
        <div class="stat-bar-a" style="width:${aPct}%"></div>
      </div>
    </div>`;
  }).filter(Boolean).join('');

  return `<div class="stats-grid">${legend}${rows}</div>`;
}

// ── Lineup ───────────────────────────────────────────
function buildLineup(rosters) {
  if (!rosters || !rosters.length) return emptyHTML('ຍັງບໍ່ມີ Lineup');
  const hasPlayers = rosters.some(r => r.roster?.length);
  if (!hasPlayers) return emptyHTML('ຍັງບໍ່ມີ Lineup');

  const cols = rosters.slice(0, 2).map(r => {
    const all      = r.roster || [];
    const starters = all.filter(p => p.starter);
    const bench    = all.filter(p => !p.starter);
    const logo     = r.team?.logo || '';
    const name     = r.team?.displayName || '';

    const playerRow = (p, isBench) => {
      const a   = p.athlete || {};
      const pos = p.position?.abbreviation || '';
      return `<div class="player-row" style="${isBench ? 'opacity:.65' : ''}">
        <div class="p-jersey">${p.jersey || '?'}</div>
        <div class="p-name">${a.displayName || '?'}</div>
        <div class="p-pos">${pos}</div>
      </div>`;
    };

    return `<div class="lineup-col">
      <div class="lineup-team-hdr">
        ${logo ? `<img src="${logo}" alt="">` : ''}
        ${name}
      </div>
      ${starters.map(p => playerRow(p, false)).join('')}
      ${bench.length ? `<div class="bench-sep"><i class="fas fa-chair me-1"></i>ສຳຮອງ</div>${bench.map(p => playerRow(p, true)).join('')}` : ''}
    </div>`;
  }).join('');

  return `<div class="lineup-wrap">${cols}</div>`;
}

// ── Odds ─────────────────────────────────────────────
function buildOddsHTML(odds) {
  if (!odds || !odds.length) return '';
  const o    = odds[0];
  const home = o.homeTeamOdds?.moneyLine;
  const draw = o.drawOdds?.moneyLine;
  const away = o.awayTeamOdds?.moneyLine;
  if (!home && !draw && !away) return '';
  const fmt  = v => v == null ? '—' : (v > 0 ? '+' + v : String(v));
  const prov = o.provider?.name || '';

  return `<div class="odds-block">
    <div class="odds-title"><i class="fas fa-coins me-1"></i>Odds</div>
    <div class="odds-chips">
      <div class="odds-chip"><span class="oc-label">ເຈົ້າບ້ານ</span><span class="oc-val">${fmt(home)}</span></div>
      <div class="odds-chip"><span class="oc-label">ເສ</span><span class="oc-val">${fmt(draw)}</span></div>
      <div class="odds-chip"><span class="oc-label">ແຂກ</span><span class="oc-val">${fmt(away)}</span></div>
    </div>
    ${prov ? `<div class="odds-provider">${prov}</div>` : ''}
  </div>`;
}

// ── Recent Form ──────────────────────────────────────
function buildRecentForm(formArr) {
  if (!formArr || !formArr.length) return '';

  const rows = formArr.slice(0, 2).map(f => {
    const evs    = (f.events || []).slice(0, 5);
    const badges = evs.map(e => `<div class="form-badge form-${e.gameResult || 'D'}" title="${e.score || ''}">${e.gameResult || 'D'}</div>`).join('');
    return `<div class="form-row">
      <div class="form-team-name">${f.team?.abbreviation || ''}</div>
      <div class="form-badges">${badges}</div>
    </div>`;
  }).join('');

  return `<div class="form-block">
    <div class="form-title"><i class="fas fa-history me-1"></i>ຟອມຫລ້າສຸດ</div>
    ${rows}
  </div>`;
}

// ── Match Info Footer ────────────────────────────────
function buildMatchInfoRow(data) {
  const gi  = data.gameInfo || {};
  const venue    = gi.venue?.fullName || '';
  const city     = gi.venue?.address?.city || '';
  const ref      = (gi.officials || []).find(o => o.position?.name?.toLowerCase().includes('referee'));
  const refName  = ref?.fullName || '';

  if (!venue && !refName) return '';
  return `<div class="match-info-row">
    ${venue ? `<span><i class="fas fa-map-marker-alt"></i>${venue}${city ? ', ' + city : ''}</span>` : ''}
    ${refName ? `<span><i class="fas fa-whistle"></i>${refName}</span>` : ''}
  </div>`;
}

// ══════════════════════════════════════════════════════
//  STATS BAR (hero)
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
  ['today', 'schedule', 'results', 'standings', 'news'].forEach(t => {
    document.getElementById(`pane-${t}`).style.display = t === tab ? '' : 'none';
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
  currentTab = tab;

  if (!loaded[tab]) {
    loaded[tab] = true;
    if (tab === 'schedule')  loadSchedule();
    if (tab === 'results')   loadResults();
    if (tab === 'standings') loadStandings();
    if (tab === 'news')      loadNews();
  }
}

function retry() {
  if (currentTab === 'today')     jumpToday();
  if (currentTab === 'schedule')  loadSchedule();
  if (currentTab === 'results')   loadResults();
  if (currentTab === 'standings') loadStandings();
  if (currentTab === 'news')      loadNews();
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
  }, 120_000);
})();
