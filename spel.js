'use strict';
/* Flygbygget. Multiplayer via PeerJS (WebRTC): värden kör spellogiken,
   övriga skickar sin position och sina knapptryck och får tillbaka läget. */

const PREFIX = 'flygbygget-v1-';
const COLORS = ['#e4572e', '#2e86de', '#f2b134', '#8e44ad'];
const WW = 1200, WH = 800, CX = 600, CY = 400;
const DOOR = { x: CX - 95, y: CY + 52 };
const PLANE_ALT = 600, PLANE_SPEED = 45, PLANE_START = -1100, PLANE_END = 1100;
const SPEED = 230, HEAVY_SPEED = 115, REACH = 62;
const HARD_ALT = 100, HARD_PENALTY = 20;

const TYPES = {
  kropp: { name: 'flygkroppen', label: 'Flygkropp', heavy: 1, fs: .38 },
  vinge: { name: 'en vinge', label: 'Vinge', fs: .42 },
  stjart: { name: 'stjärtpartiet', label: 'Stjärtparti', fs: .55 },
  hjul: { name: 'landningsstället', label: 'Landningsställ', fs: .8 },
  motor: { name: 'motorn', label: 'Motor', heavy: 1, fs: .85 },
  propeller: { name: 'propellern', label: 'Propeller', fs: .55 },
  bransle: { name: 'en dunk bränsle', label: 'Bränsle', fs: .9 },
  nyckel: { label: 'Nyckel', fs: 1.1 },
  badkar: { label: 'Badkar', heavy: 1, fs: .8, junk: 'Ett badkar? Mysigt, men det flyger inte.' },
  anka: { label: 'Gummianka', fs: 1, junk: 'Ankan vägrar. Den är en badanka, inte en flyganka.' },
  piano: { label: 'Piano', heavy: 1, fs: .7, junk: 'Ett piano på planet. Vad kan gå fel? Allt.' },
  kyl: { label: 'Kylskåp', heavy: 1, fs: .8, junk: 'Kylskåpet håller maten kall, men inte planet i luften.' },
  cykel: { label: 'Cykel', fs: .75, junk: 'Fin cykel! Fel sorts fordon dock.' },
};
const SLOTS = [
  { k: 'kropp', type: 'kropp', need: [], at: [-20, 0], label: 'Kropp' },
  { k: 'vinge1', type: 'vinge', need: ['kropp'], at: [10, -107], label: 'Vinge' },
  { k: 'vinge2', type: 'vinge', need: ['kropp'], at: [10, 107], flip: 1, label: 'Vinge' },
  { k: 'stjart', type: 'stjart', need: ['kropp'], at: [-135, 0], label: 'Stjärt' },
  { k: 'hjul', type: 'hjul', need: ['kropp'], at: [60, 0], label: 'Hjul' },
  { k: 'motor', type: 'motor', need: ['kropp'], at: [130, 0], label: 'Motor' },
  { k: 'propeller', type: 'propeller', need: ['motor'], at: [160, 0], label: 'Propeller' },
  { k: 'bransle1', type: 'bransle', need: ['motor'], at: [-78, 0], label: 'Bränsle' },
  { k: 'bransle2', type: 'bransle', need: ['motor'], at: [-46, 0], label: 'Bränsle' },
];
const SLOT = Object.fromEntries(SLOTS.map(s => [s.k, s]));
const DRAW_ORDER = ['hjul', 'vinge1', 'vinge2', 'kropp', 'stjart', 'motor', 'propeller', 'bransle1', 'bransle2'];
const NEED_MSG = {
  kropp: 'Den måste sitta fast i något. Börja med flygkroppen!',
  motor: 'Det behövs en motor först.',
};

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = n => n.toFixed(1).replace('.', ',');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const KEY = isTouch ? 'Tryck på knappen' : 'Mellanslag';

function rng(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

/* ---------------- Nätverk ---------------- */

let peer = null, isHost = false, myId = null, hostConn = null, joined = false, code = '';
const conns = {};
let S = null; // spelläget (värden äger det, övriga får kopior)

function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

function getName() {
  const n = $('name').value.trim().slice(0, 12);
  if (!n) { menuErr('Skriv ditt namn först.'); $('name').focus(); return null; }
  store('fb-name', n);
  return n;
}
function menuErr(t) { $('menuerr').textContent = t; }
function makeCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = ''; for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)];
  return c;
}

function send(msg) {
  if (isHost) hostHandle(myId, msg);
  else if (hostConn && hostConn.open) hostConn.send(msg);
}

function createGame() {
  const name = getName(); if (!name) return;
  menuErr('Skapar spel...');
  isHost = true; code = makeCode();
  peer = new Peer(PREFIX + code);
  peer.on('open', id => {
    myId = id; S = newState(); addPlayer(id, name);
    history.replaceState(null, '', '?kod=' + code);
    setInterval(broadcast, 66);
    setInterval(hostSlowTick, 1000);
    syncUI();
  });
  peer.on('error', e => {
    if (e.type === 'unavailable-id' && !myId) { peer.destroy(); createGame(); }
    else if (!myId) menuErr('Kunde inte skapa spelet (' + e.type + '). Försök igen.');
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { } });
  peer.on('connection', conn => {
    conn.on('data', m => {
      if (m.t === 'hello') {
        if (Object.keys(S.players).length >= 4) { conn.send({ t: 'full' }); return; }
        if (S.phase === 'takeoff' || S.phase === 'flight') { conn.send({ t: 'busy' }); return; }
        conns[conn.peer] = conn;
        addPlayer(conn.peer, String(m.name || 'Spelare').slice(0, 12));
        conn.send({ t: 'welcome' });
        toastAll(S.players[conn.peer].name + ' anslöt');
      } else if (conns[conn.peer]) hostHandle(conn.peer, m);
    });
    conn.on('close', () => removePlayer(conn.peer));
    conn.on('error', () => removePlayer(conn.peer));
  });
}

function joinGame() {
  const name = getName(); if (!name) return;
  code = $('code').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { menuErr('Koden är fyra bokstäver.'); return; }
  menuErr('Ansluter...');
  if (peer) peer.destroy();
  peer = new Peer();
  let timer = null;
  peer.on('open', id => {
    myId = id;
    hostConn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
    timer = setTimeout(() => { if (!joined) menuErr('Hittade inget spel med koden ' + code + '.'); }, 12000);
    hostConn.on('open', () => hostConn.send({ t: 'hello', name }));
    hostConn.on('data', m => {
      if (m.t === 'welcome') { joined = true; clearTimeout(timer); history.replaceState(null, '', '?kod=' + code); }
      else if (m.t === 'full') menuErr('Spelet är fullt (max fyra spelare).');
      else if (m.t === 'busy') menuErr('De andra flyger just nu. Försök igen om en stund.');
      else if (m.t === 'state') { S = m.s; syncUI(); }
      else if (m.t === 'toast') showToast(m.text);
    });
    hostConn.on('close', () => { if (joined) showGone('Värden lämnade spelet.'); });
  });
  peer.on('error', e => {
    if (e.type === 'peer-unavailable') menuErr('Hittade inget spel med koden ' + code + '.');
    else if (!joined) menuErr('Anslutningsfel (' + e.type + ').');
  });
}

function showGone(t) { $('gonetxt').textContent = t; $('gone').classList.remove('hidden'); }

/* ---------------- Värdens spellogik ---------------- */

function newState() {
  return { phase: 'lobby', round: 0, players: {}, crates: [], items: [], attached: {}, engine: 0,
    buildStart: 0, buildTime: 0, flight: null, results: null, nextId: 1, code };
}
function spawnPos(i) { return { x: CX - 90 + i * 60, y: WH - 70 }; }
function addPlayer(id, name) {
  const used = Object.values(S.players).map(p => p.color);
  const sp = spawnPos(Object.keys(S.players).length);
  S.players[id] = { name, color: COLORS.find(c => !used.includes(c)), x: sp.x, y: sp.y,
    carrying: null, inPlane: false, jumped: false, fall: null, result: null };
}
function removePlayer(id) {
  const p = S && S.players[id]; if (!p) return;
  if (p.carrying != null) { const it = itemById(p.carrying); if (it) { it.holder = null; it.x = p.x; it.y = p.y; } }
  delete S.players[id]; delete conns[id];
  toastAll(p.name + ' lämnade spelet');
  checkLanded();
}

function toast(pid, text) {
  if (pid === myId) showToast(text);
  else if (conns[pid] && conns[pid].open) conns[pid].send({ t: 'toast', text });
}
function toastAll(text) {
  showToast(text);
  for (const c of Object.values(conns)) if (c.open) c.send({ t: 'toast', text });
}
function broadcast() {
  if (!S) return;
  const m = { t: 'state', s: S };
  for (const c of Object.values(conns)) if (c.open) c.send(m);
}

function newRound() {
  const r = rng(Date.now() % 1e9);
  S.round++; S.phase = 'build'; S.items = []; S.attached = {}; S.engine = 0;
  S.buildStart = Date.now(); S.buildTime = 0; S.flight = null; S.results = null;
  const spots = [];
  for (let x = 80; x <= WW - 80; x += 105) for (let y = 85; y <= WH - 80; y += 105) {
    if (Math.abs(x - CX) < 290 && Math.abs(y - CY) < 245) continue; // ritningen
    if (Math.abs(x - CX) < 180 && y > WH - 170) continue;          // startplatsen
    if (x > WW - 150 && Math.abs(y - CY) < 180) continue;           // portarna
    spots.push({ x: x + (r() - .5) * 34, y: y + (r() - .5) * 34 });
  }
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  const contents = ['kropp', 'vinge', 'vinge', 'stjart', 'hjul', 'motor', 'propeller', 'bransle', 'bransle',
    'nyckel', 'badkar', 'anka', 'piano', 'kyl', 'cykel'];
  S.crates = contents.map((c, i) => ({ id: i, x: Math.round(spots[i].x), y: Math.round(spots[i].y),
    open: false, locked: c === 'propeller', content: c }));
  Object.keys(S.players).forEach((id, i) => {
    const sp = spawnPos(i);
    Object.assign(S.players[id], { x: sp.x, y: sp.y, carrying: null, inPlane: false, jumped: false, fall: null, result: null });
  });
}

function itemById(id) { return S.items.find(i => i.id === id); }
function nearestItem(p) {
  let best = null, bd = REACH;
  for (const it of S.items) { if (it.holder || it.attached) continue; const d = d2(p, it); if (d < bd) { bd = d; best = it; } }
  return best;
}
function nearestCrate(p, f) {
  let best = null, bd = REACH;
  for (const c of S.crates) { if (c.open || (f && !f(c))) continue; const d = d2(p, c); if (d < bd) { bd = d; best = c; } }
  return best;
}
const allAttached = () => SLOTS.every(s => S.attached[s.k] != null);
const playerList = () => Object.values(S.players);
const allInPlane = () => playerList().length > 0 && playerList().every(p => p.inPlane);
const nearPlane = p => Math.abs(p.x - CX) < 205 && Math.abs(p.y - CY) < 205;

// Vad händer om spelaren trycker nu? Används både av värden och för tipsraden.
function planAction(p) {
  if (!S || S.phase !== 'build' || !p) return null;
  if (p.inPlane) return allInPlane() ? { k: 'crank' } : { k: 'wait' };
  if (p.carrying != null) {
    const it = itemById(p.carrying); if (!it) return null;
    if (it.type === 'nyckel') { const c = nearestCrate(p, c => c.locked); if (c) return { k: 'unlock', c, it }; }
    if (nearPlane(p)) return { k: 'attach', it };
    return { k: 'drop', it };
  }
  if (allAttached() && d2(p, DOOR) < 80) return { k: 'board' };
  const it = nearestItem(p); if (it) return { k: 'pick', it };
  const c = nearestCrate(p); if (c) return { k: c.locked ? 'locked' : 'open', c };
  return null;
}

function act(pid) {
  const p = S.players[pid]; const a = planAction(p); if (!a) return;
  switch (a.k) {
    case 'crank':
      S.engine = Math.min(100, S.engine + 8);
      if (S.engine >= 100) startTakeoff();
      break;
    case 'wait': toast(pid, 'Alla måste vara ombord innan motorn kan startas.'); break;
    case 'unlock':
      a.c.locked = false; openCrate(a.c);
      S.items = S.items.filter(i => i !== a.it); p.carrying = null;
      toastAll(p.name + ' låste upp den låsta lådan!');
      break;
    case 'attach': attach(pid, p, a.it); break;
    case 'drop': a.it.holder = null; a.it.x = p.x; a.it.y = p.y + 22; p.carrying = null; break;
    case 'board': p.inPlane = true; toastAll(p.name + ' klev ombord'); break;
    case 'pick': a.it.holder = pid; p.carrying = a.it.id; break;
    case 'open': openCrate(a.c); break;
    case 'locked': toast(pid, 'Lådan är låst. Nyckeln ligger i någon annan låda.'); break;
  }
}
function openCrate(c) {
  c.open = true;
  S.items.push({ id: S.nextId++, type: c.content, x: c.x, y: c.y + 6, holder: null, attached: null });
}
function attach(pid, p, it) {
  const T = TYPES[it.type];
  const bounce = () => {
    const a = Math.atan2(p.y - CY, p.x - CX);
    it.holder = null; p.carrying = null;
    it.x = clamp(CX + Math.cos(a) * 300, 40, WW - 40); it.y = clamp(CY + Math.sin(a) * 300, 40, WH - 40);
  };
  if (T.junk) { toast(pid, T.junk); bounce(); return; }
  if (it.type === 'nyckel') { toast(pid, 'Nyckeln hör inte till planet. Någon låda är låst...'); return; }
  const slot = SLOTS.find(s => s.type === it.type && S.attached[s.k] == null);
  if (!slot) { toast(pid, 'Den delen sitter redan på plats.'); bounce(); return; }
  const miss = slot.need.find(n => S.attached[n] == null);
  if (miss) { toast(pid, NEED_MSG[miss]); return; }
  S.attached[slot.k] = it.id; it.attached = slot.k; it.holder = null; p.carrying = null;
  toastAll(p.name + ' monterade ' + T.name + '!');
  if (allAttached()) { S.buildTime = Date.now() - S.buildStart; toastAll('Planet är klart! Alla in genom dörren.'); }
}

function startTakeoff() {
  if (S.phase !== 'build') return;
  S.phase = 'takeoff'; S.takeoffId = Date.now();
  setTimeout(startFlight, 4300);
}
function startFlight() {
  const a = Math.random() * Math.PI * 2, ws = 3 + Math.random() * 4.5;
  S.flight = { id: Date.now(), wind: { x: Math.cos(a) * ws, y: Math.sin(a) * ws }, yoff: Math.round((Math.random() - .5) * 300) };
  S.phase = 'flight';
  for (const p of playerList()) Object.assign(p, { jumped: false, fall: null, result: null });
}
function checkLanded() {
  if (S.phase === 'flight' && playerList().every(p => p.result)) finalizeFlight();
}
function finalizeFlight() {
  if (S.phase !== 'flight') return;
  const score = r => r.status === 'ok' ? r.dist : r.status === 'hard' ? r.dist + HARD_PENALTY : 1e9;
  const list = playerList().map(p => ({ name: p.name, color: p.color, ...(p.result || { status: 'borta' }) }));
  list.sort((a, b) => score(a) - score(b));
  S.results = { list, buildTime: S.buildTime };
  S.phase = 'results';
}
function hostSlowTick() {
  if (S && S.phase === 'flight' && Date.now() - S.flight.id > 120000) finalizeFlight();
}
function hostTick(dt) {
  if (S.phase === 'build' && allInPlane() && S.engine > 0) S.engine = Math.max(0, S.engine - 12 * dt);
}

function hostHandle(pid, m) {
  const p = S.players[pid]; if (!p) return;
  switch (m.t) {
    case 'pos':
      if (S.phase === 'build' && !p.inPlane) { p.x = clamp(+m.x || 0, 0, WW); p.y = clamp(+m.y || 0, 0, WH); }
      break;
    case 'act': act(pid); break;
    case 'start': if (pid === myId && (S.phase === 'lobby' || S.phase === 'results')) newRound(); break;
    case 'jump': if (S.phase === 'flight') p.jumped = true; break;
    case 'fall':
      if (S.phase === 'flight' && !p.result) p.fall = { x: +m.x, y: +m.y, alt: +m.alt, mode: m.mode };
      break;
    case 'land':
      if (S.phase !== 'flight' || p.result) break;
      p.jumped = true;
      p.result = { dist: +m.dist, status: ['ok', 'hard', 'krasch'].includes(m.status) ? m.status : 'ok', x: +m.x, y: +m.y };
      p.fall = { x: +m.x, y: +m.y, alt: 0, mode: 'land' };
      checkLanded();
      break;
  }
}

/* ---------------- Lokal spelare ---------------- */

const me = { x: CX, y: WH - 70, face: -Math.PI / 2 };
const ui = { phase: null, round: -1, flightId: null, lobbyKey: '', resKey: '' };
let takeoffT0 = 0, flightT0 = 0, fall = null, jumped = false, landed = false;
let lastPosSend = 0, lastFallSend = 0;
const cam = { x: 0, y: 0, vw: 1400 };
const shown = {}; // utjämnade positioner för andra spelare

function syncUI() {
  if (!S) return;
  const p = S.players[myId];
  if (S.round !== ui.round) { ui.round = S.round; if (p) { me.x = p.x; me.y = p.y; } }
  if (S.phase === 'takeoff' && ui.phase !== 'takeoff') takeoffT0 = performance.now();
  if (S.phase === 'flight' && S.flight && S.flight.id !== ui.flightId) {
    ui.flightId = S.flight.id; flightT0 = performance.now();
    fall = null; jumped = false; landed = false;
    cam.x = PLANE_START; cam.y = S.flight.yoff; cam.vw = 1400;
  }
  if (S.phase !== ui.phase) {
    ui.phase = S.phase;
    $('menu').classList.add('hidden');
    $('lobby').classList.toggle('hidden', S.phase !== 'lobby');
    $('results').classList.toggle('hidden', S.phase !== 'results');
    $('touch').classList.toggle('hidden', !isTouch || S.phase === 'lobby' || S.phase === 'results');
    $('hint').classList.toggle('touch', isTouch);
  }
  if (S.phase === 'lobby') renderLobby();
  if (S.phase === 'results') renderResults();
}

function shareLink() { return location.origin + location.pathname + '?kod=' + (S.code || code); }

function renderLobby() {
  const list = Object.entries(S.players);
  const key = JSON.stringify(list.map(([id, p]) => [id, p.name, p.color])) + isHost;
  if (key === ui.lobbyKey) return; ui.lobbyKey = key;
  $('lcode').textContent = S.code || code;
  $('llink').textContent = shareLink();
  $('lplayers').innerHTML = list.map(([id, p]) =>
    `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${id === myId ? ' <span class="muted">(du)</span>' : ''}</li>`).join('') +
    (list.length < 4 ? `<li class="muted" style="font-weight:400">${4 - list.length} platser kvar</li>` : '');
  $('start').classList.toggle('hidden', !isHost);
  $('lwait').textContent = isHost ? 'Skicka länken eller koden till upp till tre vänner. Starta när alla är med.' : 'Väntar på att värden startar spelet...';
}

function renderResults() {
  const R = S.results; if (!R) return;
  const key = JSON.stringify(R) + isHost;
  if (key === ui.resKey) return; ui.resKey = key;
  const bt = Math.round(R.buildTime / 1000);
  $('rinfo').textContent = bt ? `Ni byggde planet på ${Math.floor(bt / 60)}:${String(bt % 60).padStart(2, '0')}.` : '';
  const medal = ['1', '2', '3', '4'];
  $('rlist').innerHTML = R.list.map((r, i) => {
    let st;
    if (r.status === 'ok') st = fmt(r.dist) + ' m från mitten';
    else if (r.status === 'hard') st = `${fmt(r.dist)} m + ${HARD_PENALTY} m straff för hård landning`;
    else if (r.status === 'krasch') st = 'Pannkaka! Drog aldrig fallskärmen.';
    else st = 'Kom aldrig ner.';
    const valid = r.status === 'ok' || r.status === 'hard';
    return `<li><span class="pos">${valid ? medal[i] : '-'}</span><span class="dot" style="background:${r.color}"></span>
      <span><span class="nm">${esc(r.name)}</span><br><span class="st">${st}</span></span></li>`;
  }).join('');
  $('again').classList.toggle('hidden', !isHost);
  $('rwait').textContent = isHost ? '' : 'Väntar på att värden startar en ny runda...';
  drawResultMap(R.list);
}

function drawResultMap(list) {
  const c = $('map'), g = c.getContext('2d'), s = c.width;
  const pts = list.filter(r => r.x != null);
  const valid = pts.filter(r => r.status === 'ok' || r.status === 'hard');
  const R = clamp(Math.max(45, ...valid.map(r => Math.hypot(r.x, r.y) * 1.2)), 45, 600);
  const k = (s / 2) / R;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#8cbf6f'; g.fillRect(0, 0, s, s);
  g.translate(s / 2, s / 2); g.scale(k, k);
  drawTarget(g);
  for (const r of pts) {
    g.beginPath(); g.arc(r.x, r.y, 10 / k, 0, 7); g.fillStyle = r.color; g.fill();
    g.lineWidth = 3 / k; g.strokeStyle = '#fff'; g.stroke();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = 'rgba(0,0,0,.6)'; g.font = '600 20px system-ui'; g.textAlign = 'center';
  g.fillText(`radie ${Math.round(R)} m`, s / 2, s - 30);
}

function doAction() {
  if (!S) return;
  if (S.phase === 'build') {
    if (!isHost) send({ t: 'pos', x: me.x, y: me.y });
    send({ t: 'act' });
  } else if (S.phase === 'flight') {
    if (!jumped) doJump();
    else if (fall && fall.mode === 'free' && !landed) { fall.mode = 'canopy'; fall.openAlt = fall.alt; }
  }
}

function planePos() {
  const t = (performance.now() - flightT0) / 1000;
  return { x: PLANE_START + PLANE_SPEED * t, y: S.flight.yoff };
}
function doJump() {
  if (jumped) return;
  jumped = true;
  const pp = planePos();
  fall = { x: pp.x, y: pp.y, vx: PLANE_SPEED, vy: 0, alt: PLANE_ALT, mode: 'free', openAlt: null };
  send({ t: 'jump' });
  showToast('Hoppa! Dra fallskärmen i tid.');
}
function land() {
  landed = true;
  const dist = Math.hypot(fall.x, fall.y);
  const status = fall.mode === 'free' ? 'krasch' : fall.openAlt < HARD_ALT ? 'hard' : 'ok';
  fall.alt = 0;
  send({ t: 'land', x: fall.x, y: fall.y, dist, status });
  showToast(status === 'krasch' ? 'Aj! Du glömde fallskärmen.' :
    `${status === 'hard' ? 'Hård landning! ' : 'Snygg landning! '}${fmt(dist)} m från mitten.`);
}

function update(dt, now) {
  const inp = getInput();
  if (S.phase === 'build') {
    const p = S.players[myId]; if (!p || p.inPlane) return;
    const it = p.carrying != null && itemById(p.carrying);
    const sp = it && TYPES[it.type].heavy ? HEAVY_SPEED : SPEED;
    me.x = clamp(me.x + inp.x * sp * dt, 22, WW - 22);
    me.y = clamp(me.y + inp.y * sp * dt, 22, WH - 22);
    if (inp.x || inp.y) me.face = Math.atan2(inp.y, inp.x);
    if (isHost) { p.x = me.x; p.y = me.y; }
    else if (now - lastPosSend > 50) { lastPosSend = now; send({ t: 'pos', x: me.x, y: me.y }); }
  } else if (S.phase === 'flight' && S.flight) {
    if (!jumped) { if (planePos().x > PLANE_END) doJump(); return; }
    if (!fall || landed) return;
    const w = S.flight.wind, free = fall.mode === 'free';
    const steer = free ? 3 : 4.5, k = free ? .7 : 1.4;
    fall.vx += (w.x + inp.x * steer - fall.vx) * Math.min(1, k * dt);
    fall.vy += (w.y + inp.y * steer - fall.vy) * Math.min(1, k * dt);
    fall.x += fall.vx * dt; fall.y += fall.vy * dt;
    fall.alt -= (free ? 50 : 9) * dt;
    if (fall.alt <= 0) land();
    if (now - lastFallSend > 100 && !landed) {
      lastFallSend = now;
      send({ t: 'fall', x: fall.x, y: fall.y, alt: fall.alt, mode: fall.mode });
    }
  }
}

/* ---------------- Indata ---------------- */

const keys = {};
const stick = { on: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter') (e.target.id === 'code' ? joinGame : createGame)(); return; }
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if ((e.code === 'Space' || e.code === 'KeyE') && !e.repeat) doAction();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

function getInput() {
  let x = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  let y = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0);
  if (stick.on) { x += stick.x; y += stick.y; }
  const l = Math.hypot(x, y);
  if (l > 1) { x /= l; y /= l; }
  return { x, y };
}

const touchEl = $('touch');
touchEl.addEventListener('pointerdown', e => {
  if (e.target.id === 'actbtn') return;
  stick.on = true; stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.x = stick.y = 0;
  const s = $('stick'); s.style.display = 'block'; s.style.left = (e.clientX - 60) + 'px'; s.style.top = (e.clientY - 60) + 'px';
  $('knob').style.transform = '';
});
touchEl.addEventListener('pointermove', e => {
  if (!stick.on || e.pointerId !== stick.id) return;
  let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy; const l = Math.hypot(dx, dy);
  if (l > 50) { dx *= 50 / l; dy *= 50 / l; }
  stick.x = dx / 50; stick.y = dy / 50;
  $('knob').style.transform = `translate(${dx}px,${dy}px)`;
});
const endStick = e => { if (e.pointerId !== stick.id) return; stick.on = false; stick.x = stick.y = 0; $('stick').style.display = 'none'; };
touchEl.addEventListener('pointerup', endStick);
touchEl.addEventListener('pointercancel', endStick);
$('actbtn').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); doAction(); });

/* ---------------- Ritning ---------------- */

const cv = $('c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
}
addEventListener('resize', resize); resize();

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

// Delar ritas uppifrån med nosen åt höger. mode: 'fill' eller 'ghost' (streckad kontur på ritningen).
function drawShape(g, type, mode, spin) {
  const ghost = mode === 'ghost';
  const paint = (fill, stroke = '#4a4a4a') => {
    if (ghost) { g.fillStyle = 'rgba(255,255,255,.07)'; g.fill(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.5; g.setLineDash([7, 6]); g.stroke(); g.setLineDash([]); }
    else { g.fillStyle = fill; g.fill(); g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
  };
  switch (type) {
    case 'kropp':
      rr(g, -130, -22, 260, 44, 22); paint('#f4f1ea');
      if (!ghost) {
        g.fillStyle = '#d64545'; g.fillRect(-118, -4, 220, 8);
        g.beginPath(); g.ellipse(88, 0, 17, 12, 0, 0, 7); g.fillStyle = '#6ec1e4'; g.fill(); g.stroke();
      }
      break;
    case 'vinge':
      g.beginPath(); g.moveTo(-30, 85); g.lineTo(30, 85); g.lineTo(18, -85); g.lineTo(-12, -85); g.closePath(); paint('#e9e4d8');
      if (!ghost) { g.fillStyle = '#d64545'; g.fillRect(-12, -85, 30, 14); g.strokeStyle = '#aaa'; g.beginPath(); g.moveTo(-18, 40); g.lineTo(-8, -60); g.stroke(); }
      break;
    case 'stjart':
      g.beginPath(); g.moveTo(-15, -65); g.lineTo(15, -48); g.lineTo(15, 48); g.lineTo(-15, 65); g.closePath(); paint('#e9e4d8');
      if (!ghost) { g.fillStyle = '#d64545'; g.fillRect(-22, -5, 40, 10); }
      break;
    case 'hjul':
      if (ghost) { rr(g, -12, -40, 24, 80, 8); paint(); break; }
      g.strokeStyle = '#333'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, -32); g.lineTo(0, 32); g.stroke();
      for (const s of [-1, 1]) { g.beginPath(); g.ellipse(0, s * 34, 13, 7, 0, 0, 7); g.fillStyle = '#222'; g.fill(); }
      break;
    case 'motor':
      rr(g, -20, -20, 40, 40, 6); paint('#5a5f66', '#2f3236');
      if (!ghost) { g.strokeStyle = '#8a9099'; g.lineWidth = 2; for (let i = -12; i <= 12; i += 6) { g.beginPath(); g.moveTo(-14, i); g.lineTo(14, i); g.stroke(); } }
      break;
    case 'propeller': {
      if (ghost) { rr(g, -5, -55, 10, 110, 5); paint(); break; }
      const s = spin == null ? 1 : Math.cos(spin);
      if (spin != null) { g.beginPath(); g.ellipse(0, 0, 4, 56, 0, 0, 7); g.fillStyle = 'rgba(60,50,45,.18)'; g.fill(); }
      rr(g, -4, -55 * Math.abs(s), 8, 110 * Math.abs(s) + .1, 4); paint('#3b2f2a', '#20180f');
      g.beginPath(); g.arc(0, 0, 8, 0, 7); g.fillStyle = '#d64545'; g.fill();
      break;
    }
    case 'bransle':
      rr(g, -12, -16, 24, 32, 4); paint('#d64545', '#7d1f1f');
      if (!ghost) { g.fillStyle = '#333'; g.fillRect(-6, -20, 12, 5); }
      break;
    case 'nyckel':
      g.strokeStyle = '#7a5a00'; g.lineWidth = 7; g.beginPath(); g.arc(-12, 0, 8, 0, 7); g.moveTo(-4, 0); g.lineTo(20, 0); g.moveTo(14, 0); g.lineTo(14, 8); g.moveTo(19, 0); g.lineTo(19, 7); g.stroke();
      g.strokeStyle = '#f2c230'; g.lineWidth = 4; g.stroke();
      break;
    case 'badkar':
      g.beginPath(); g.ellipse(0, 0, 46, 25, 0, 0, 7); paint('#fafafa', '#999');
      g.beginPath(); g.ellipse(0, 0, 38, 18, 0, 0, 7); g.fillStyle = '#9fd3f0'; g.fill();
      g.beginPath(); g.arc(-30, 0, 4, 0, 7); g.fillStyle = '#bbb'; g.fill();
      break;
    case 'anka':
      g.beginPath(); g.ellipse(0, 4, 18, 14, 0, 0, 7); paint('#ffd23f', '#c99a00');
      g.beginPath(); g.arc(12, -9, 10, 0, 7); paint('#ffd23f', '#c99a00');
      g.beginPath(); g.moveTo(20, -10); g.lineTo(30, -7); g.lineTo(20, -4); g.fillStyle = '#f08a24'; g.fill();
      g.beginPath(); g.arc(14, -12, 2, 0, 7); g.fillStyle = '#222'; g.fill();
      break;
    case 'piano':
      rr(g, -50, -32, 100, 64, 4); paint('#1d1d1d', '#000');
      g.fillStyle = '#fff'; g.fillRect(-46, 12, 92, 16); g.fillStyle = '#1d1d1d';
      for (let x = -42; x < 44; x += 8) g.fillRect(x, 12, 3, 9);
      break;
    case 'kyl':
      rr(g, -28, -40, 56, 80, 6); paint('#f2f2f2', '#888');
      g.strokeStyle = '#888'; g.beginPath(); g.moveTo(-28, -10); g.lineTo(28, -10); g.stroke();
      g.fillStyle = '#888'; g.fillRect(18, -32, 4, 16); g.fillRect(18, -2, 4, 22);
      break;
    case 'cykel':
      g.strokeStyle = '#2e86de'; g.lineWidth = 4;
      g.beginPath(); g.arc(-24, 6, 15, 0, 7); g.moveTo(39, 6); g.arc(24, 6, 15, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(-24, 6); g.lineTo(-4, -14); g.lineTo(16, -14); g.lineTo(24, 6); g.moveTo(-4, -14); g.lineTo(2, 6); g.lineTo(-24, 6); g.moveTo(16, -14); g.lineTo(14, -22); g.stroke();
      break;
  }
}

function drawPlane(g, attached, ghost, spin) {
  for (const k of DRAW_ORDER) {
    const s = SLOT[k], has = attached[k] != null;
    if (!has && !ghost) continue;
    g.save(); g.translate(s.at[0], s.at[1]); if (s.flip) g.scale(1, -1);
    drawShape(g, s.type, has ? 'fill' : 'ghost', k === 'propeller' ? spin : undefined);
    g.restore();
  }
}

function drawItem(g, type, x, y, scale, label) {
  g.save(); g.translate(x, y); g.scale(scale, scale); drawShape(g, type, 'fill'); g.restore();
  if (label) {
    g.font = '600 12px system-ui'; g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillText(TYPES[type].label, x, y + 30);
  }
}

function drawCrate(g, c) {
  g.save(); g.translate(c.x, c.y);
  if (c.open) {
    rr(g, -24, -24, 48, 48, 4); g.fillStyle = '#5b3b1d'; g.fill(); g.strokeStyle = '#a9743f'; g.lineWidth = 5; g.stroke();
  } else {
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(-21, -18, 48, 48);
    rr(g, -24, -24, 48, 48, 4); g.fillStyle = '#b07a43'; g.fill(); g.strokeStyle = '#6d4520'; g.lineWidth = 3; g.stroke();
    g.beginPath(); g.moveTo(-24, -24); g.lineTo(24, 24); g.moveTo(24, -24); g.lineTo(-24, 24); g.lineWidth = 4; g.stroke();
    if (c.locked) {
      g.fillStyle = '#f2c230'; rr(g, -10, -4, 20, 16, 3); g.fill(); g.strokeStyle = '#7a5a00'; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.arc(0, -4, 6, Math.PI, 0); g.lineWidth = 3; g.stroke();
    } else {
      g.fillStyle = '#fff'; g.font = '700 18px Fredoka, system-ui'; g.textAlign = 'center'; g.fillText('?', 0, 7);
    }
  }
  g.restore();
}

function drawAvatar(g, x, y, color, name, face, sc = 1) {
  g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(x + 3, y + 6, 17 * sc, 12 * sc, 0, 0, 7); g.fill();
  g.beginPath(); g.arc(x, y, 17 * sc, 0, 7); g.fillStyle = color; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3 * sc; g.stroke();
  for (const s of [-1, 1]) {
    const ex = x + Math.cos(face + s * .5) * 9 * sc, ey = y + Math.sin(face + s * .5) * 9 * sc;
    g.beginPath(); g.arc(ex, ey, 3.5 * sc, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.arc(ex + Math.cos(face) * 1.4, ey + Math.sin(face) * 1.4, 1.8 * sc, 0, 7); g.fillStyle = '#111'; g.fill();
  }
  if (name) {
    g.font = '700 13px system-ui'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.5)';
    g.strokeText(name, x, y - 24 * sc); g.fillStyle = '#fff'; g.fillText(name, x, y - 24 * sc);
  }
}

function drawBuild(now, dt) {
  const minSc = .55;
  let sc = Math.min(W / WW, H / WH) * .97, follow = false;
  if (sc < minSc) { sc = Math.max(sc, Math.min(.75, H / WH * .85)); follow = true; }
  const p = S.players[myId];
  let camX = CX, camY = CY;
  if (follow && p && !p.inPlane) {
    camX = WW * sc <= W ? CX : clamp(me.x, W / 2 / sc, WW - W / 2 / sc);
    camY = WH * sc <= H ? CY : clamp(me.y, H / 2 / sc, WH - H / 2 / sc);
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#2b2d33'; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(DPR * sc, 0, 0, DPR * sc, DPR * (W / 2 - camX * sc), DPR * (H / 2 - camY * sc));

  const takeoff = S.phase === 'takeoff';
  const tt = takeoff ? (now - takeoffT0) / 1000 : 0;
  const doorsOpen = takeoff ? 1 : (allAttached() && allInPlane() ? Math.min(1, S.engine / 40) : 0);

  // Utsikt genom portarna
  ctx.fillStyle = '#7fb069'; ctx.fillRect(WW, CY - 160, 600, 320);
  ctx.fillStyle = '#555'; ctx.fillRect(WW, CY - 40, 600, 80);
  ctx.strokeStyle = '#fff'; ctx.setLineDash([30, 24]); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(WW, CY); ctx.lineTo(WW + 600, CY); ctx.stroke(); ctx.setLineDash([]);
  // Golv
  ctx.fillStyle = '#c9c4b8'; ctx.fillRect(0, 0, WW, WH);
  ctx.strokeStyle = 'rgba(0,0,0,.06)'; ctx.lineWidth = 2;
  for (let x = 100; x < WW; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WH); ctx.stroke(); }
  for (let y = 100; y < WH; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WW, y); ctx.stroke(); }
  ctx.strokeStyle = '#e9c46a'; ctx.lineWidth = 6; ctx.setLineDash([22, 14]);
  ctx.beginPath(); ctx.ellipse(CX, CY, 235, 225, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(233,196,106,.9)'; ctx.font = '700 16px Fredoka, system-ui'; ctx.textAlign = 'center';
  ctx.fillText('BYGG HÄR', CX, CY + 250);
  // Väggar och portar
  ctx.fillStyle = '#5a5d66'; ctx.fillRect(-20, -20, WW + 40, 20); ctx.fillRect(-20, WH, WW + 40, 20); ctx.fillRect(-20, 0, 20, WH);
  ctx.fillRect(WW, 0, 20, CY - 160); ctx.fillRect(WW, CY + 160, 20, WH - CY - 160);
  const dh = 160 * (1 - doorsOpen);
  ctx.fillStyle = '#8a8f99'; ctx.fillRect(WW - 6, CY - 160, 18, dh); ctx.fillRect(WW - 6, CY + 160 - dh, 18, dh);

  for (const c of S.crates) drawCrate(ctx, c);
  for (const it of S.items) if (!it.holder && !it.attached) drawItem(ctx, it.type, it.x, it.y, TYPES[it.type].fs, true);

  // Planet
  const ox = takeoff ? 70 * tt * tt : 0;
  const spin = (allInPlane() || takeoff) && (S.engine > 0 || takeoff) ? now / (takeoff ? 18 : 60 - S.engine * .45) : undefined;
  ctx.save(); ctx.translate(CX + ox, CY + (takeoff ? Math.sin(tt * 30) * Math.min(1, tt) * 1.5 : 0));
  drawPlane(ctx, S.attached, !takeoff, spin);
  const inside = playerList().filter(q => q.inPlane);
  inside.forEach((q, i) => { ctx.beginPath(); ctx.arc(-108 + i * 22, i % 2 ? 8 : -8, 8, 0, 7); ctx.fillStyle = q.color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); });
  ctx.restore();

  // Dörrmarkering
  if (allAttached() && !takeoff && !(p && p.inPlane)) {
    const b = Math.sin(now / 200) * 4;
    ctx.fillStyle = '#f2b134'; ctx.beginPath(); ctx.moveTo(DOOR.x, DOOR.y - 14 + b + 20); ctx.lineTo(DOOR.x - 12, DOOR.y + 4 + b + 20); ctx.lineTo(DOOR.x + 12, DOOR.y + 4 + b + 20); ctx.fill();
    ctx.font = '700 14px Fredoka, system-ui'; ctx.textAlign = 'center'; ctx.fillText('DÖRR', DOOR.x, DOOR.y + 44 + b);
  }

  // Spelare
  for (const [id, q] of Object.entries(S.players)) {
    if (q.inPlane) continue;
    let x, y, face;
    if (id === myId) { x = me.x; y = me.y; face = me.face; }
    else {
      const s = shown[id] || (shown[id] = { x: q.x, y: q.y, face: 0 });
      const nx = s.x + (q.x - s.x) * Math.min(1, dt * 12), ny = s.y + (q.y - s.y) * Math.min(1, dt * 12);
      if (Math.hypot(nx - s.x, ny - s.y) > .3) s.face = Math.atan2(ny - s.y, nx - s.x);
      s.x = nx; s.y = ny; x = s.x; y = s.y; face = s.face;
    }
    drawAvatar(ctx, x, y, q.color, q.name, face);
    if (q.carrying != null) { const it = itemById(q.carrying); if (it) drawItem(ctx, it.type, x, y - 46, TYPES[it.type].fs * .75, false); }
  }

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (takeoff && tt > 2.2) {
    ctx.fillStyle = `rgba(124,196,242,${Math.min(1, (tt - 2.2) / 1.6)})`; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = '700 48px Fredoka, system-ui'; ctx.textAlign = 'center'; ctx.fillText('Lyfter!', W / 2, H / 2);
  }
}

// Marken i flygläget. Enheter: meter, tavlan i (0,0).
function drawTarget(g) {
  g.beginPath(); g.arc(0, 0, 48, 0, 7); g.fillStyle = '#cfe8b0'; g.fill();
  const rings = [[30, '#d64545'], [24, '#fff'], [18, '#d64545'], [12, '#fff'], [6, '#d64545'], [2, '#fff']];
  for (const [r, c] of rings) { g.beginPath(); g.arc(0, 0, r, 0, 7); g.fillStyle = c; g.fill(); }
}
const FIELD = ['#7fb069', '#8cbf6f', '#a7c957', '#6a994e', '#b5c99a', '#d9c77a', '#94b86a'];
function drawGround(g, x0, y0, x1, y1, seed) {
  const C = 120;
  g.fillStyle = '#86b86b'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(y0 / C); j <= Math.floor(y1 / C); j++) {
    const h = hash2(i, j, seed);
    g.fillStyle = FIELD[Math.floor(h * FIELD.length)];
    g.fillRect(i * C + 2, j * C + 2, C - 4, C - 4);
    if (h > .55 && h < .7) { g.strokeStyle = 'rgba(0,0,0,.07)'; g.lineWidth = 2; g.beginPath(); for (let k = 8; k < C; k += 10) { g.moveTo(i * C + k, j * C + 4); g.lineTo(i * C + k, j * C + C - 4); } g.stroke(); }
  }
  g.fillStyle = '#d8cfae'; g.fillRect(x0, -186, x1 - x0, 10); g.fillRect(244, y0, 10, y1 - y0);
  g.beginPath(); g.ellipse(-430, 320, 170, 95, .3, 0, 7); g.fillStyle = '#4f9fd6'; g.fill();
  g.beginPath(); g.ellipse(520, -480, 120, 70, -.4, 0, 7); g.fill();
  for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(y0 / C); j <= Math.floor(y1 / C); j++) {
    const n = Math.floor(hash2(i, j, seed + 7) * 5);
    for (let t = 0; t < n; t++) {
      const tx = i * C + hash2(i, j, seed + 11 + t) * C, ty = j * C + hash2(j, i, seed + 13 + t) * C;
      if (Math.hypot(tx, ty) < 70) continue;
      const r = 3 + hash2(i + t, j, seed) * 4;
      g.beginPath(); g.arc(tx + 1, ty + 1.5, r, 0, 7); g.fillStyle = 'rgba(0,0,0,.18)'; g.fill();
      g.beginPath(); g.arc(tx, ty, r, 0, 7); g.fillStyle = '#3d6b35'; g.fill();
    }
  }
  drawTarget(g);
}

function drawJumper(sx, sy, color, mode, sc, name) {
  if (mode === 'canopy') {
    const w = Math.max(30, 9 * sc), h = w * .42;
    ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx - w / 2, sy); ctx.lineTo(sx, sy + h * .9); ctx.lineTo(sx + w / 2, sy); ctx.stroke();
    rr(ctx, sx - w / 2, sy - h / 2, w, h, h / 2); ctx.fillStyle = color; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)'; for (let k = -1; k <= 1; k += 2) ctx.fillRect(sx + k * w * .18 - w * .04, sy - h / 2 + 2, w * .08, h - 4);
    ctx.beginPath(); ctx.arc(sx, sy + h * .9, Math.max(3, .4 * sc), 0, 7); ctx.fillStyle = '#222'; ctx.fill();
  } else if (mode === 'land') {
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
  } else {
    const s = Math.max(10, 1.8 * sc);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, s * .22); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx - s, sy - s * .8); ctx.lineTo(sx + s, sy + s * .8); ctx.moveTo(sx + s, sy - s * .8); ctx.lineTo(sx - s, sy + s * .8); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy - s * .15, s * .35, 0, 7); ctx.fillStyle = '#222'; ctx.fill();
  }
  if (name) {
    ctx.font = '700 12px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.55)';
    const ny = sy - (mode === 'canopy' ? Math.max(30, 9 * sc) * .3 + 8 : 16);
    ctx.strokeText(name, sx, ny); ctx.fillStyle = '#fff'; ctx.fillText(name, sx, ny);
  }
}

function drawFlight(now, dt) {
  const F = S.flight, pp = planePos();
  let tx, ty, tvw;
  if (!jumped) { tx = pp.x; ty = pp.y; tvw = 1350; }
  else if (landed) { tx = fall.x / 2; ty = fall.y / 2; tvw = Math.max(130, Math.hypot(fall.x, fall.y) * 2.4 + 70); }
  else { tx = fall.x; ty = fall.y; tvw = 70 + fall.alt * 2.1; }
  const kk = Math.min(1, dt * (jumped && !landed ? 8 : 2.5));
  cam.x += (tx - cam.x) * kk; cam.y += (ty - cam.y) * kk; cam.vw += (tvw - cam.vw) * Math.min(1, dt * 2.5);
  const sc = Math.min(W, H) / cam.vw;
  const ws = (x, y) => [W / 2 + (x - cam.x) * sc, H / 2 + (y - cam.y) * sc];

  ctx.setTransform(DPR * sc, 0, 0, DPR * sc, DPR * (W / 2 - cam.x * sc), DPR * (H / 2 - cam.y * sc));
  drawGround(ctx, cam.x - W / 2 / sc, cam.y - H / 2 / sc, cam.x + W / 2 / sc, cam.y + H / 2 / sc, (F.id % 997) | 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Andra spelare
  for (const [id, q] of Object.entries(S.players)) {
    if (id === myId || !q.fall) continue;
    const s = shown['f' + id] || (shown['f' + id] = { x: q.fall.x, y: q.fall.y });
    s.x += (q.fall.x - s.x) * Math.min(1, dt * 10); s.y += (q.fall.y - s.y) * Math.min(1, dt * 10);
    const [sx, sy] = ws(s.x, s.y);
    drawJumper(sx, sy, q.color, q.fall.mode, sc, q.name);
  }
  // Planet
  if (pp.x < PLANE_END + 400) {
    const [sx, sy] = ws(pp.x, pp.y);
    const k = Math.max(12 * sc / 330, 90 / 330);
    ctx.save(); ctx.translate(sx, sy); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(0,0,0,.15)';
    drawPlane(ctx, Object.fromEntries(SLOTS.map(s => [s.k, 1])), false, now / 18);
    ctx.restore();
    if (!jumped) {
      const others = playerList().filter(q => !q.jumped).length;
      ctx.font = '700 13px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText(`${others} ombord`, sx, sy + 70);
    }
  }
  // Jag
  if (fall) {
    const [sx, sy] = ws(fall.x, fall.y);
    drawJumper(sx, sy, S.players[myId] ? S.players[myId].color : '#fff', landed ? 'land' : fall.mode, sc, 'Du');
  }
  // Pil mot tavlan
  const [tsx, tsy] = ws(0, 0);
  if (tsx < 30 || tsx > W - 30 || tsy < 30 || tsy > H - 30) {
    const ang = Math.atan2(tsy - H / 2, tsx - W / 2);
    const ex = clamp(tsx, 40, W - 40), ey = clamp(tsy, 90, H - 90);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang);
    ctx.fillStyle = '#d64545'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -12); ctx.lineTo(-10, 12); ctx.fill();
    ctx.restore();
    const ref = jumped && fall ? fall : pp;
    ctx.font = '700 13px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 3;
    const label = 'Tavlan ' + Math.round(Math.hypot(ref.x, ref.y)) + ' m';
    ctx.strokeText(label, ex - Math.cos(ang) * 30, ey - Math.sin(ang) * 30 + 4); ctx.fillText(label, ex - Math.cos(ang) * 30, ey - Math.sin(ang) * 30 + 4);
  }
  // Vindmätare
  const wx = W - 52, wy = 60, wsp = Math.hypot(F.wind.x, F.wind.y), wa = Math.atan2(F.wind.y, F.wind.x);
  ctx.beginPath(); ctx.arc(wx, wy, 34, 0, 7); ctx.fillStyle = 'rgba(20,24,32,.6)'; ctx.fill();
  ctx.save(); ctx.translate(wx, wy); ctx.rotate(wa);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-20, 0); ctx.lineTo(18, 0); ctx.moveTo(8, -9); ctx.lineTo(19, 0); ctx.lineTo(8, 9); ctx.stroke();
  ctx.restore();
  ctx.font = '700 12px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
  ctx.fillText('VIND ' + fmt(wsp) + ' m/s', wx, wy + 52);
  // Höjd
  const alt = !jumped ? PLANE_ALT : fall.alt;
  ctx.font = '700 34px Fredoka, system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.4)';
  const at = Math.max(0, Math.round(alt)) + ' m';
  const warn = jumped && !landed && fall.mode === 'free' && alt < 220;
  ctx.strokeText(at, W / 2, H - (isTouch ? 210 : 70)); ctx.fillStyle = warn && Math.floor(now / 150) % 2 ? '#ff4d4d' : '#fff';
  ctx.fillText(at, W / 2, H - (isTouch ? 210 : 70));
  if (warn) { ctx.font = '700 40px Fredoka, system-ui'; ctx.fillStyle = '#ff4d4d'; ctx.strokeText('DRA SKÄRMEN!', W / 2, H / 2 - 60); ctx.fillText('DRA SKÄRMEN!', W / 2, H / 2 - 60); }
}

/* ---------------- HUD ---------------- */

let hudKey = '', hintTxt = '';
function updateHud(now) {
  let html = '', hint = '';
  const p = S.players[myId];
  if (S.phase === 'build' || S.phase === 'takeoff') {
    const done = SLOTS.filter(s => S.attached[s.k] != null).length;
    const sec = Math.floor(((S.buildTime || (Date.now() - S.buildStart))) / 1000);
    html = `Kod ${esc(S.code)} &middot; ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} &middot; Delar ${done}/${SLOTS.length}`;
    html += '<div class="chips">' + SLOTS.map(s => `<span class="chip${S.attached[s.k] != null ? ' ok' : ''}">${s.label}</span>`).join('') + '</div>';
    if (allAttached() && allInPlane()) html += `<div id="bar"><i style="width:${Math.round(S.engine)}%"></i></div>Motor`;
    const a = S.phase === 'build' && planAction(p ? { ...p, x: me.x, y: me.y } : null);
    if (a) {
      const lab = a.it ? TYPES[a.it.type].label.toLowerCase() : '';
      hint = {
        crank: `${KEY}: veva motorn! Snabbt!`,
        wait: `Väntar på att alla kliver in (${playerList().filter(q => q.inPlane).length}/${playerList().length})`,
        unlock: `${KEY}: lås upp lådan`, attach: `${KEY}: montera ${lab}`, drop: `${KEY}: släpp ${lab}`,
        board: `${KEY}: kliv in i planet`, pick: `${KEY}: ta ${lab}`, open: `${KEY}: öppna lådan`,
        locked: 'Låst låda. Hitta nyckeln!',
      }[a.k];
    } else if (S.phase === 'build') {
      hint = allAttached() ? 'Planet är klart! Gå till dörren.' : 'Öppna lådorna och bär delarna till ritningen.';
    }
  } else if (S.phase === 'flight') {
    html = `Kod ${esc(S.code)} &middot; Flygning`;
    if (!jumped) hint = `${KEY}: hoppa! Tänk på vinden.`;
    else if (landed) hint = 'Väntar på de andra...';
    else if (fall.mode === 'free') hint = `${KEY}: dra fallskärmen! Styr för att glida.`;
    else hint = 'Styr mot mitten av tavlan';
  }
  if (html !== hudKey) { hudKey = html; $('hud').innerHTML = html; }
  if (hint !== hintTxt) { hintTxt = hint; $('hint').textContent = hint; }
  $('hud').classList.toggle('hidden', S.phase === 'lobby' || S.phase === 'results');
  $('hint').classList.toggle('hidden', S.phase === 'lobby' || S.phase === 'results');
}

function showToast(text) {
  const box = $('toasts');
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 450); }, 3200);
}

/* ---------------- Huvudloop ---------------- */

let last = performance.now();
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (S) {
    if (isHost) { hostTick(dt); syncUI(); }
    if (S.phase !== 'lobby' && S.phase !== 'results') {
      update(dt, now);
      if (S.phase === 'flight' && S.flight) drawFlight(now, dt); else drawBuild(now, dt);
    }
    updateHud(now);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------------- Meny ---------------- */

$('name').value = load('fb-name');
const urlCode = new URLSearchParams(location.search).get('kod');
if (urlCode) { $('code').value = urlCode.toUpperCase().slice(0, 4); $('create').classList.add('ghost'); }
$('create').onclick = createGame;
$('join').onclick = joinGame;
$('start').onclick = () => send({ t: 'start' });
$('again').onclick = () => send({ t: 'start' });
$('leave').onclick = $('reload').onclick = () => { location.href = location.pathname; };
$('copy').onclick = () => {
  const l = shareLink();
  (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject()).then(() => showToast('Länken är kopierad'), () => showToast(l));
};
if (navigator.share) $('share').onclick = () => navigator.share({ title: 'Flygbygget', text: 'Spela Flygbygget med mig! Kod ' + (S ? S.code : code), url: shareLink() }).catch(() => { });
else $('share').classList.add('hidden');
if (!$('name').value) $('name').focus();
