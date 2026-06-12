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
const STATUS_LAO = {
  'FT':                  'ຈົບ',
  'Full Time':           'ຈົບ',
  'Final':               'ຈົບ',
  'AET':                 'ຈົບ (ຕໍ່ເວລາ)',
  'After Extra Time':    'ຈົບ (ຕໍ່ເວລາ)',
  'Pen':                 'ຈົບ (ລູກໂທດ)',
  'Penalties':           'ຈົບ (ລູກໂທດ)',
  'Postponed':           'ເລື່ອນ',
  'Canceled':            'ຍົກເລີກ',
  'Suspended':           'ລໍຖ້າ',
  'HT':                  'ພັກ',
  'Half Time':           'ພັກ',
};

function laoStatus(raw) {
  if (!raw) return 'ຈົບ';
  return STATUS_LAO[raw] || STATUS_LAO[raw.trim()] || raw;
}

const LAO_DAYS   = ['ອາທິດ','ຈັນ','ອັງຄານ','ພຸດ','ພະຫັດ','ສຸກ','ເສົາ'];
const LAO_MONTHS = ['','ມັງກອນ','ກຸມພາ','ມີນາ','ເມສາ','ພຶດສະພາ','ມິຖຸນາ','ກໍລະກົດ','ສິງຫາ','ກັນຍາ','ຕຸລາ','ພະຈິກ','ທັນວາ'];

function fmtDate(iso) {
  const d   = new Date(iso);
  const day = LAO_DAYS[d.getDay()];
  const dd  = d.getDate();
  const m   = d.getMonth() + 1;
  const mon = LAO_MONTHS[m];
  const y   = d.getFullYear();
  return `${day}, ${dd} ${mon}(${m}) ${y}`;
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('lo-LA', { hour: '2-digit', minute: '2-digit', hour12: false });
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
    const min = clk.replace(/'/g, '');   // strip all apostrophes first
    let txt;
    if (s.name === 'STATUS_HALFTIME')    txt = 'ພັກຄlr';
    else if (per === 1 && min)           txt = `ຄlr.1 · ${min}'`;
    else if (per === 2 && min)           txt = `ຄlr.2 · ${min}'`;
    else if (per === 3 && min)           txt = `ຕໍ່ເວລາ · ${min}'`;
    else                                 txt = s.shortDetail || 'LIVE';
    return { cls: 'status-live', text: txt, state: 'live', period: per, rawClock: min };
  }
  if (s.state === 'post') return { cls: 'status-final', text: laoStatus(s.shortDetail), state: 'post' };
  return { cls: 'status-upcoming', text: 'ກຳລັງຈະ', state: 'pre' };
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

function buildProgressBar(period, rawClock) {
  let min = 0;
  if (rawClock && rawClock.includes('+')) {
    const [base, extra] = rawClock.split('+').map(n => parseInt(n) || 0);
    min = base + extra;
  } else {
    min = parseInt(rawClock) || 0;
  }

  let pct = 0;
  if (period === 1)      pct = Math.min((min / 45) * 100, 100);
  else if (period === 2) pct = Math.min(((45 + Math.min(min, 45)) / 90) * 100, 100);
  else                   pct = 100;

  const isExtraTime = period === 2 && min > 45;
  const label = isExtraTime ? `+${min - 45}'` : `${min}'`;

  return `<div class="match-progress-wrap">
    <span class="mp-label-left">${period === 1 ? '0\'' : '45\''}</span>
    <div class="match-progress-bar">
      <div class="match-progress-fill ${isExtraTime ? 'extra-time' : ''}" style="width:${pct}%"></div>
    </div>
    <span class="mp-label-right">${period === 1 ? '45\'' : '90\''}</span>
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
    ? `<div class="score-digits ${isLive ? 'score-live' : ''}">
        <span>${home.score ?? 0}</span>
        <span class="score-sep">:</span>
        <span>${away.score ?? 0}</span>
       </div>`
    : `<div class="kickoff-time">${fmtTime(ev.date)}</div>`;

  const progressEl = isLive ? buildProgressBar(si.period, si.rawClock) : '';

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
        ${progressEl}
        ${badgeEl}
        ${groupEl}
        ${venueEl}
      </div>
      <div class="col-4">${teamBlock(away, away.winner)}</div>
    </div>
    ${oddsEl}
  </div>`;
}

function groupByDate(events) {
  return events.reduce((acc, ev) => {
    const d = localDateStr(ev.date);
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
    // Fetch prev + selected day because UTC→local timezone can shift match dates
    const prev = shiftDate(date, -1);
    const data = await fetchJSON(
      `${API.espn}/scoreboard?dates=${toYMD(prev)}-${toYMD(date)}&limit=200`
    );

    // Filter by LOCAL date to match what the user actually experiences
    const evs = (data.events || []).filter(e => localDateStr(e.date) === date);

    document.getElementById('todayCount').textContent = evs.length ? `${evs.length} ການແຂ່ງຂັນ` : '';
    el.innerHTML = renderEventList(evs);
  } catch (e) {
    el.innerHTML = errorHTML('ດຶງຂໍ້ມູນບໍ່ໄດ້: ' + e.message);
  }
}

// Local date as 'YYYY-MM-DD' (sv locale = ISO format)
function localDateStr(iso) {
  return new Date(iso).toLocaleDateString('sv');
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
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
  const comp    = data.header?.competitions?.[0];
  const homeCmp = comp?.competitors?.find(c => c.homeAway === 'home') || comp?.competitors?.[0] || {};
  const awayCmp = comp?.competitors?.find(c => c.homeAway === 'away') || comp?.competitors?.[1] || {};
  const homeId  = String(homeCmp.team?.id || homeCmp.id || '');
  const awayId  = String(awayCmp.team?.id || awayCmp.id || '');

  const infoRow  = buildMatchInfoRow(data);
  const oddsHtml = buildOddsHTML(data.odds);
  let   body     = '';

  if (tab === 'timeline') body = buildTimeline(data.keyEvents || [], homeId, awayId);
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
  goal:          '⚽',
  'own goal':    '🔴',
  'yellow card': '🟨',
  'red card':    '🟥',
  substitution:  '🔄',
  halftime:      '⏸',
  kickoff:       '▶️',
  'end regular': '🏁',
  'end period':  '🏁',
  penalty:       '🎯',
  var:           '📺',
};

function tlIcon(type) {
  const t = (type || '').toLowerCase();
  for (const [key, icon] of Object.entries(TL_ICONS)) {
    if (t.includes(key)) return icon;
  }
  return null;
}

function buildTimeline(keyEvents, homeId, awayId) {
  const skip = ['start delay', 'end delay', 'start 2nd half', 'start 3rd'];
  const evs  = keyEvents.filter(e => {
    const t = (e.type?.text || '').toLowerCase();
    return !skip.some(s => t.includes(s));
  });

  if (!evs.length) return emptyHTML('ຍັງບໍ່ມີເຫດການ');

  const rows = evs.map(e => {
    const type = e.type?.text || '';
    const icon = tlIcon(type);
    if (!icon) return '';

    const clock     = e.clock?.displayValue ? e.clock.displayValue + '\'' : '';
    const text      = e.text || type;
    const t         = type.toLowerCase();
    const isSection = ['kickoff', 'halftime', 'end regular', 'end period', 'final'].some(x => t.includes(x));

    if (isSection) {
      const label = t.includes('halftime') ? 'ພັກ' : t.includes('kickoff') ? 'ເລີ່ມ' : 'ຈົບ';
      return `<div class="tl-section-divider">
        <div class="tl-divider-line"></div>
        <div class="tl-divider-chip">${icon} ${label} ${clock}</div>
        <div class="tl-divider-line"></div>
      </div>`;
    }

    const isGoal = t.includes('goal') || (t.includes('penalty') && !t.includes('miss'));
    const teamId = e.team?.id ? String(e.team.id) : '';
    const side   = teamId === homeId ? 'home' : teamId === awayId ? 'away' : 'home';

    const pill = `<div class="tl-event-pill${isGoal ? ' tl-goal-pill' : ''}">
      <span class="tl-pill-icon">${icon}</span>
      <span class="tl-pill-text">${text}</span>
    </div>`;

    return `<div class="tl-split-row">
      <div class="tl-col-home">${side === 'home' ? pill : ''}</div>
      <div class="tl-col-time">${clock}</div>
      <div class="tl-col-away">${side === 'away' ? pill : ''}</div>
    </div>`;
  }).filter(Boolean).join('');

  return rows ? `<div class="timeline-container">${rows}</div>` : emptyHTML('ຍັງບໍ່ມີເຫດການ');
}

// ── Stats ────────────────────────────────────────────
// Predefined priority stats (key, English label, format fn)
const STATS_DEF = [
  ['totalShots',     'Shots',          v => Math.round(v)],
  ['shotsOnTarget',  'Shots on target',v => Math.round(v)],
  ['possessionPct',  'Possession',     v => Math.round(v) + '%'],
  ['totalPasses',    'Passes',         v => Math.round(v)],
  ['passPct',        'Pass accuracy',  v => { const n = parseFloat(v)||0; return (n<=1?Math.round(n*100):Math.round(n))+'%'; }],
  ['foulsCommitted', 'Fouls',          v => Math.round(v)],
  ['yellowCards',    'Yellow cards',   v => Math.round(v)],
  ['redCards',       'Red cards',      v => Math.round(v)],
  ['offsides',       'Offsides',       v => Math.round(v)],
  ['wonCorners',     'Corners',        v => Math.round(v)],
];

function buildStats(teams) {
  if (!teams || teams.length < 2) return emptyHTML('ຍັງບໍ່ມີ Stats');

  const hStats = teams[0].statistics || [];
  const aStats = teams[1].statistics || [];
  if (!hStats.length && !aStats.length) return emptyHTML('ຍັງບໍ່ມີ Stats');

  // ESPN returns objects with {name, value, displayValue, label}
  const hMap  = Object.fromEntries(hStats.map(s => [s.name, s]));
  const aMap  = Object.fromEntries(aStats.map(s => [s.name, s]));
  const hLogo = teams[0].team?.logo || '';
  const aLogo = teams[1].team?.logo || '';
  const hName = teams[0].team?.abbreviation || 'Home';
  const aName = teams[1].team?.abbreviation || 'Away';

  const hdr = `<div class="stats-team-hdr">
    <div class="stats-th-side">
      ${hLogo ? `<img src="${hLogo}" alt="">` : ''}
      <span>${hName}</span>
    </div>
    <div class="stats-th-title">TEAM STATS</div>
    <div class="stats-th-side stats-th-right">
      <span>${aName}</span>
      ${aLogo ? `<img src="${aLogo}" alt="">` : ''}
    </div>
  </div>`;

  // Get numeric value from ESPN stat entry (value → displayValue fallback)
  const getNum = entry => {
    if (!entry) return null;
    const v = entry.value ?? entry.displayValue;
    if (v == null) return null;
    return parseFloat(String(v).replace('%','')) || 0;
  };
  const getDisplay = (entry, fmtFn) => {
    if (!entry) return '—';
    const v = entry.value ?? entry.displayValue;
    if (v == null) return '—';
    try { return fmtFn ? String(fmtFn(parseFloat(String(v).replace('%',''))||0)) : String(v); }
    catch { return String(v); }
  };

  const makeBarRow = (label, hDisp, aDisp, h, a, isPoss) => {
    if (h === null && a === null) return '';
    const hv = h ?? 0, av = a ?? 0;
    let hPct = 50, aPct = 50;
    if (isPoss) { hPct = hv; aPct = av; }
    else { const tot = hv + av || 1; hPct = (hv/tot)*100; aPct = (av/tot)*100; }
    return `<div class="stat-row">
      <div class="stat-val-h${hv > av ? ' stat-win' : ''}">${hDisp}</div>
      <div class="stat-label">${label}</div>
      <div class="stat-val-a${av > hv ? ' stat-win' : ''}">${aDisp}</div>
    </div>
    <div class="stat-bar-shared">
      <div class="stat-bar-h" style="width:${hPct}%"></div>
      <div class="stat-bar-a" style="width:${aPct}%"></div>
    </div>`;
  };

  // 1) Try predefined keys
  let rows = STATS_DEF.map(([key, label, fmt]) => {
    const he = hMap[key], ae = aMap[key];
    const h  = getNum(he), a = getNum(ae);
    if (h === null && a === null) return '';
    const isPoss = key === 'possessionPct';
    return makeBarRow(label, getDisplay(he, fmt), getDisplay(ae, fmt), h, a, isPoss);
  }).filter(Boolean);

  // 2) If fewer than 3 matched, auto-detect ALL stats ESPN returned
  if (rows.length < 3) {
    const allNames = [...new Set([...hStats.map(s => s.name), ...aStats.map(s => s.name)])];
    rows = allNames.map(name => {
      const he    = hMap[name] || null;
      const ae    = aMap[name] || null;
      const ref   = he || ae;
      const label = ref?.label || ref?.shortDisplayName || name.replace(/([A-Z])/g, ' $1').trim();
      const h     = getNum(he);
      const a     = getNum(ae);
      const hDisp = he ? (he.displayValue ?? String(he.value ?? '—')) : '—';
      const aDisp = ae ? (ae.displayValue ?? String(ae.value ?? '—')) : '—';
      const isPoss = /pct|percent|possession/i.test(name);
      return makeBarRow(label, hDisp, aDisp, h, a, isPoss);
    }).filter(Boolean);
  }

  const body = rows.join('') || '<p style="text-align:center;color:var(--text-muted);padding:20px">ຍັງບໍ່ມີ Stats</p>';
  return `<div class="stats-wrap">${hdr}<div class="stats-rows">${body}</div></div>`;
}

// ── Lineup ───────────────────────────────────────────
function shortName(n) {
  const parts = (n || '').trim().split(/\s+/);
  if (parts.length <= 1) return n || '?';
  const last = parts[parts.length - 1];
  return last.length > 10 ? last.slice(0, 9) + '…' : last;
}

function posType(p) {
  const abbr = (p.position?.abbreviation || '').toUpperCase().trim();
  const name  = (p.position?.name || '').toLowerCase();
  // Single-letter ESPN codes
  if (abbr === 'G'  || abbr === 'GK') return 'GK';
  if (abbr === 'D'  || abbr === 'DF' || /^(CB|LB|RB|LWB|RWB|SW|DC|DEF|WB)$/.test(abbr)) return 'DEF';
  if (abbr === 'M'  || abbr === 'MF' || /^(CM|DM|CDM|CAM|AM|LM|RM|ATM)$/.test(abbr))   return 'MID';
  if (abbr === 'F'  || abbr === 'FW' || /^(ST|CF|LW|RW|WF|SS|ATT|FWD)$/.test(abbr))    return 'FWD';
  // Name fallback
  if (name.includes('keeper') || name.includes('goalkeeper')) return 'GK';
  if (name.includes('back')   || name.includes('defender'))   return 'DEF';
  if (name.includes('midfielder'))                             return 'MID';
  if (name.includes('forward') || name.includes('striker') || name.includes('winger')) return 'FWD';
  return 'MID';
}

// Split starters into rows using formation string e.g. "3-4-2-1"
// ESPN returns starters in formation order, so this gives correct rows
function splitByFormation(starters, formation) {
  const nums  = formation.split('-').map(n => parseInt(n) || 0).filter(n => n > 0);
  const sizes = [1, ...nums]; // prepend GK row
  const rows  = [];
  let i = 0;
  for (const s of sizes) {
    const row = starters.slice(i, i + s);
    if (row.length) rows.push(row);
    i += s;
  }
  if (i < starters.length) rows.push(starters.slice(i)); // overflow
  return rows;
}

function groupByPosition(starters) {
  const buckets = { GK: [], DEF: [], MID: [], FWD: [] };
  starters.forEach(p => buckets[posType(p)].push(p));
  return ['GK', 'DEF', 'MID', 'FWD'].filter(k => buckets[k].length).map(k => buckets[k]);
}

function buildLineup(rosters) {
  if (!rosters || !rosters.length) return emptyHTML('ຍັງບໍ່ມີ Lineup');
  const hasPlayers = rosters.some(r => r.roster?.length);
  if (!hasPlayers) return emptyHTML('ຍັງບໍ່ມີ Lineup');

  const cols = rosters.slice(0, 2).map((r, idx) => {
    const all       = r.roster || [];
    const starters  = all.filter(p => p.starter);
    const bench     = all.filter(p => !p.starter);
    const logo      = r.team?.logo || '';
    const name      = r.team?.displayName || '';
    const formation = r.formation || '';

    // Prefer formation-based split (ESPN returns players in formation order)
    const rows = (formation && starters.length)
      ? splitByFormation(starters, formation)
      : groupByPosition(starters);
    if (idx === 0) rows.reverse(); // home: FWD→GK top-to-bottom (attack faces center)

    const pitchHtml = rows.map(row => `<div class="pitch-player-row">
      ${row.map(p => `<div class="pitch-player-dot">
        <div class="pitch-jersey-circle">${p.jersey || '?'}</div>
        <div class="pitch-player-name">${shortName(p.athlete?.displayName || '?')}</div>
      </div>`).join('')}
    </div>`).join('');

    const benchHtml = bench.length
      ? `<div class="bench-sep-bar"><i class="fas fa-chair me-1"></i>ສຳຮອງ</div>
         ${bench.map(p => `<div class="player-row" style="opacity:.65">
           <div class="p-jersey">${p.jersey || '?'}</div>
           <div class="p-name">${p.athlete?.displayName || '?'}</div>
           <div class="p-pos">${p.position?.abbreviation || ''}</div>
         </div>`).join('')}`
      : '';

    return `<div class="lineup-pitch-col">
      <div class="lineup-pitch-header">
        ${logo ? `<img src="${logo}" alt="">` : ''}
        <span class="lineup-team-nm">${name}</span>
        ${formation ? `<span class="formation-badge">${formation}</span>` : ''}
      </div>
      <div class="pitch-field">${pitchHtml}</div>
      ${benchHtml}
    </div>`;
  }).join('');

  return `<div class="lineup-pitches">${cols}</div>`;
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
    const prev  = shiftDate(today, -1);
    const data  = await fetchJSON(`${API.espn}/scoreboard?dates=${toYMD(prev)}-${toYMD(today)}&limit=200`);
    const evs   = (data.events || []).filter(e => localDateStr(e.date) === today);
    const live  = evs.filter(e => e.competitions[0].status.type.state === 'in').length;
    const done  = evs.filter(e => e.competitions[0].status.type.state === 'post').length;
    const upcoming = evs.filter(e => e.competitions[0].status.type.state === 'pre').length;
    document.getElementById('s-total').textContent    = evs.length;
    document.getElementById('s-live').textContent     = live;
    document.getElementById('s-done').textContent     = done;
    document.getElementById('s-upcoming').textContent = upcoming;
  } catch (_) {}
}

// ══════════════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════════════
function showTab(tab) {
  ['today', 'schedule', 'results', 'standings', 'news', 'tv'].forEach(t => {
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
