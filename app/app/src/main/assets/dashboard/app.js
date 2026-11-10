/* PrintDeck dashboard: talks to OctoPrint's REST API. No dependencies, works offline. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* ---------- config ---------- */
const isHttp = /^https?:$/.test(location.protocol);
const cfg = {
  base: store.get('base', isHttp && location.port === '5000' ? location.origin : 'http://127.0.0.1:5000'),
  key: store.get('key', '') || (() => { try { return window.Octo4a ? window.Octo4a.getApiKey() : ''; } catch { return ''; } })(),
  cam: store.get('cam', isHttp ? `${location.protocol}//${location.hostname}:5001` : 'http://127.0.0.1:5001'),
  env: store.get('env', ''),
  humid: store.get('humid', true)
};
{ const q = new URLSearchParams(location.search);   // ?base=...&key=...&cam=... pre-fills the config
  ['base', 'key', 'cam', 'env'].forEach(k => { if (q.get(k) != null) { cfg[k] = q.get(k); store.set(k, cfg[k]); } }); }
const saveCfg = () => Object.entries(cfg).forEach(([k, v]) => store.set(k, v));

/* ---------- api ---------- */
async function api(path, opt = {}) {
  const headers = { 'X-Api-Key': cfg.key, ...(opt.headers || {}) };
  let body = opt.body;
  if (opt.json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opt.json); }
  const res = await fetch(cfg.base + path, { method: opt.method || (body ? 'POST' : 'GET'), headers, body });
  if (res.status === 204) return {};
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) { const e = new Error(typeof data === 'string' ? data : (data.error || res.statusText)); e.status = res.status; throw e; }
  return data;
}

/* ---------- helpers ---------- */
const fmtDur = s => {
  if (s == null || !isFinite(s)) return '--';
  s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
const fmtClock = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800);
}
function confirmDlg(title, text, okLabel = 'Confirm') {
  return new Promise(res => {
    $('#cTitle').textContent = title; $('#cText').textContent = text; $('#cOk').textContent = okLabel;
    const d = $('#dlgConfirm'); d.returnValue = ''; d.onclose = () => res(d.returnValue === 'ok'); d.showModal();
  });
}

/* ---------- state ---------- */
const S = { printer: null, job: null, conn: null, online: false, authed: true, state: 'connecting', history: { tool0: [], bed: [] }, prev: {}, files: [] };
const HIST = 150;

/* ---------- tabs ---------- */
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'files') loadFiles();
  if (b.dataset.tab === 'agent') $('#alertDot').hidden = true;
});

/* ---------- polling ---------- */
async function poll() {
  try {
    const [job, conn] = await Promise.all([api('/api/job'), api('/api/connection')]);
    S.job = job; S.conn = conn.current; S.online = true; S.authed = true;
    try { S.printer = await api('/api/printer'); }
    catch (e) { if (e.status === 409) S.printer = null; else throw e; }
  } catch (e) {
    S.online = false; S.printer = null;
    S.authed = e.status !== 401 && e.status !== 403;
    S.lastErr = e.status ? `OctoPrint says ${e.status}: ${e.message}` : 'Cannot reach OctoPrint at ' + cfg.base;
  }
  render(); runRules();
}

function derive() {
  if (!S.online) return S.authed ? ['Offline', 'bad'] : ['Key needed', 'warn'];
  const f = S.printer && S.printer.state.flags;
  if (!f) return [S.conn && S.conn.state && /closed|offline|error/i.test(S.conn.state) ? 'Disconnected' : 'Not connected', 'warn'];
  if (f.error) return ['Error', 'bad'];
  if (f.printing) return ['Printing', 'busy'];
  if (f.paused || f.pausing) return ['Paused', 'warn'];
  if (f.cancelling) return ['Cancelling', 'warn'];
  return ['Ready', 'ok'];
}

/* ---------- render ---------- */
function render() {
  const [label, cls] = derive();
  S.state = label;
  const pill = $('#statePill'); pill.textContent = label; pill.className = 'pill ' + cls;

  const ban = $('#banner');
  if (!S.online) { ban.textContent = S.authed ? S.lastErr : 'OctoPrint rejected the API key. Open settings and paste a valid key.'; ban.className = 'banner'; ban.hidden = false; }
  else if (!S.printer) {
    ban.className = 'banner info'; ban.hidden = false;
    ban.innerHTML = 'Printer is not connected. <button id="btnConnect" class="link">Connect now</button>';
    $('#btnConnect').onclick = connectPrinter;
  } else ban.hidden = true;

  const t = S.printer && S.printer.temperature;
  const set = (id, v) => $(id).textContent = v;
  if (t) {
    [['tool0', 'tool'], ['bed', 'bed']].forEach(([k, p]) => {
      const h = t[k]; if (!h) return;
      set('#' + p + 'Now', h.actual == null ? '--' : h.actual.toFixed(1));
      set('#' + p + 'Target', Math.round(h.target || 0));
      const st = $('#' + p + 'State'); st.textContent = h.target ? (Math.abs(h.actual - h.target) < 3 ? 'at temperature' : h.actual < h.target ? 'heating' : 'cooling') : 'off';
      st.classList.toggle('on', !!h.target);
      const a = S.history[k]; a.push([Date.now(), h.actual, h.target || 0]); if (a.length > HIST) a.shift();
    });
    drawCharts();
  } else { ['tool', 'bed'].forEach(p => { set('#' + p + 'Now', '--'); set('#' + p + 'Target', 0); set('#' + p + 'State', 'offline'); }); }

  const j = S.job || {}, pr = j.progress || {}, f = (j.job && j.job.file) || {};
  const active = S.printer && (S.printer.state.flags.printing || S.printer.state.flags.paused);
  const pct = pr.completion == null ? null : pr.completion;
  $('#ringFg').style.strokeDashoffset = 100 - (pct || 0);
  $('#pct').textContent = pct == null || !active && !pct ? (S.printer ? '0%' : '--') : Math.round(pct) + '%';
  $('#pctLabel').textContent = active ? (S.printer.state.flags.paused ? 'paused' : 'printing') : (pct >= 100 ? 'done' : 'idle');
  $('#ringFg').style.stroke = S.printer && S.printer.state.flags.paused ? 'var(--warn)' : pct >= 100 ? 'var(--ok)' : 'var(--heat)';
  set('#jobName', f.display || f.name || 'No file selected');
  set('#tElapsed', fmtDur(pr.printTime));
  set('#tLeft', active ? fmtDur(pr.printTimeLeft) : '--');
  set('#tEta', active && pr.printTimeLeft != null ? fmtClock(new Date(Date.now() + pr.printTimeLeft * 1000)) : '--');
  const fl = j.job && j.job.filament && j.job.filament.tool0;
  set('#fil', fl ? (fl.length / 1000).toFixed(1) + ' m' : '--');
  const fg = S.printer && S.printer.state.flags;
  $('#btnPause').disabled = !active; $('#btnCancel').disabled = !active;
  $('#btnPause').textContent = fg && fg.paused ? 'Resume' : 'Pause';
  document.title = active ? `${Math.round(pct || 0)}% · PrintDeck` : 'PrintDeck';
}

const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function drawCharts() { drawSpark('toolChart', S.history.tool0, cssVar('--heat')); drawSpark('bedChart', S.history.bed, cssVar('--cool')); }
function drawSpark(id, data, color) {
  const c = $('#' + id), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  if (data.length < 2) return;
  const vals = data.flatMap(d => [d[1], d[2] || d[1]]); let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 10) { const m = (hi + lo) / 2; lo = m - 5; hi = m + 5; }
  const X = i => i / (data.length - 1) * w, Y = v => h - 4 - (v - lo) / (hi - lo) * (h - 8);
  const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
  g.beginPath(); data.forEach((d, i) => i ? g.lineTo(X(i), Y(d[1])) : g.moveTo(X(i), Y(d[1])));
  g.lineTo(X(data.length - 1), h); g.lineTo(X(0), h); g.closePath(); g.fillStyle = grad; g.fill();
  g.beginPath(); data.forEach((d, i) => i ? g.lineTo(X(i), Y(d[1])) : g.moveTo(X(i), Y(d[1])));
  g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
  const tg = data[data.length - 1][2];
  if (tg) { g.setLineDash([4, 4]); g.strokeStyle = cssVar('--dim'); g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(tg)); g.lineTo(w, Y(tg)); g.stroke(); g.setLineDash([]); }
}
addEventListener('resize', drawCharts);

/* ---------- job + heater actions ---------- */
$('#btnPause').onclick = () => api('/api/job', { json: { command: 'pause', action: 'toggle' } }).then(poll).catch(e => toast(e.message));
$('#btnCancel').onclick = async () => {
  if (await confirmDlg('Cancel this print?', 'The print stops and cannot be resumed.', 'Cancel print'))
    api('/api/job', { json: { command: 'cancel' } }).then(poll).catch(e => toast(e.message));
};
async function connectPrinter() {
  try { await api('/api/connection', { json: { command: 'connect', port: 'AUTO', baudrate: 0 } }); toast('Connecting…'); setTimeout(poll, 1500); }
  catch (e) { toast(e.message); }
}
async function setTemp(which, v) {
  try {
    if (which === 'tool') await api('/api/printer/tool', { json: { command: 'target', targets: { tool0: v } } });
    else await api('/api/printer/bed', { json: { command: 'target', target: v } });
    poll();
  } catch (e) { toast(e.message); }
}
$$('.presets[data-target]').forEach(box => box.onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  const which = box.dataset.target;
  if (b.classList.contains('custom')) {
    $('#tempTitle').textContent = which === 'tool' ? 'Nozzle target' : 'Bed target';
    const d = $('#dlgTemp'); $('#tempVal').value = ''; d.returnValue = '';
    d.onclose = () => { const v = parseInt($('#tempVal').value, 10); if (d.returnValue === 'ok' && v >= 0) setTemp(which, v); };
    d.showModal();
  } else setTemp(which, +b.dataset.v);
});

/* ---------- files ---------- */
async function loadFiles() {
  try {
    const r = await api('/api/files/local?recursive=true');
    S.files = (r.files || []).filter(f => f.type === 'machinecode').sort((a, b) => (b.date || 0) - (a.date || 0));
    $('#free').textContent = r.free ? fmtSize(r.free) + ' free' : '';
    const ul = $('#fileList');
    ul.innerHTML = S.files.length ? S.files.map((f, i) => {
      const est = f.gcodeAnalysis && f.gcodeAnalysis.estimatedPrintTime;
      const last = f.prints && f.prints.last;
      return `<li><div class="f-main"><div class="f-name">${esc(f.display || f.name)}</div>
        <div class="f-meta">${fmtSize(f.size)}${est ? ' · ~' + fmtDur(est) : ''}${last ? ' · last print ' + (last.success ? 'ok' : 'failed') : ''}</div></div>
        <div class="f-act"><button class="go" data-i="${i}" data-a="print">Print</button><button class="del" data-i="${i}" data-a="del" aria-label="Delete">✕</button></div></li>`;
    }).join('') : '<li class="empty">No G-code yet. Upload your first file above.</li>';
  } catch (e) { toast(e.message); }
}
$('#fileList').onclick = async e => {
  const b = e.target.closest('button'); if (!b) return;
  const f = S.files[+b.dataset.i], path = encodeURIComponent(f.path || f.name).replace(/%2F/g, '/');
  if (b.dataset.a === 'print') {
    if (S.printer && S.printer.state.flags.printing) return toast('A print is already running');
    if (!S.printer) return toast('Printer is not connected');
    if (!await confirmDlg('Start printing?', f.display || f.name, 'Print')) return;
    try { await api('/api/files/local/' + path, { json: { command: 'select', print: true } }); toast('Print started'); $('[data-tab=print]').click(); poll(); }
    catch (er) { toast(er.message); }
  } else if (await confirmDlg('Delete file?', f.display || f.name, 'Delete')) {
    try { await api('/api/files/local/' + path, { method: 'DELETE' }); loadFiles(); } catch (er) { toast(er.message); }
  }
};
async function upload(files) {
  const fill = $('#upFill'), bar = $('#upBar'); bar.hidden = false;
  for (const file of files) {
    if (!/\.(gcode|gco|g)$/i.test(file.name)) { toast(file.name + ': only G-code files can be printed'); continue; }
    const fd = new FormData(); fd.append('file', file);
    const auto = $('#autoPrint').checked && files.length === 1;
    if (auto) { fd.append('select', 'true'); fd.append('print', 'true'); }
    try {
      await new Promise((res, rej) => {
        const x = new XMLHttpRequest(); x.open('POST', cfg.base + '/api/files/local'); x.setRequestHeader('X-Api-Key', cfg.key);
        x.upload.onprogress = e => fill.style.width = (e.loaded / e.total * 100) + '%';
        x.onload = () => x.status < 300 ? res() : rej(new Error('Upload failed (' + x.status + ')')); x.onerror = () => rej(new Error('Upload failed'));
        x.send(fd);
      });
      toast(auto ? 'Uploaded, printing…' : 'Uploaded ' + file.name);
    } catch (e) { toast(e.message); }
  }
  bar.hidden = true; fill.style.width = '0'; loadFiles(); poll();
}
const drop = $('#drop');
$('#btnPick').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => { upload([...e.target.files]); e.target.value = ''; };
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => upload([...e.dataTransfer.files]));

/* ---------- control ---------- */
const gcode = cmds => api('/api/printer/command', { json: { commands: [].concat(cmds) } });
$$('.jog button').forEach(b => b.onclick = () => {
  const j = b.dataset.j, s = parseFloat($('#step').value);
  if (j === 'home') return api('/api/printer/printhead', { json: { command: 'home', axes: ['x', 'y'] } }).catch(e => toast(e.message));
  const d = { x: 0, y: 0, z: 0 }; d[j[0]] = j[1] === '+' ? s : -s;
  api('/api/printer/printhead', { json: { command: 'jog', ...d } }).catch(e => toast(e.message));
});
$$('[data-home]').forEach(b => b.onclick = () => api('/api/printer/printhead', { json: { command: 'home', axes: b.dataset.home.split(',') } }).catch(e => toast(e.message)));
$$('[data-ext]').forEach(b => b.onclick = () => {
  if (S.printer && S.printer.temperature.tool0.actual < 170) return toast('Nozzle too cold to move filament');
  api('/api/printer/tool', { json: { command: 'extrude', amount: +b.dataset.ext } }).catch(e => toast(e.message));
});
$('#btnOff').onclick = () => { setTemp('tool', 0); setTemp('bed', 0); };
$('#btnM84').onclick = () => gcode('M84').catch(e => toast(e.message));
$('#gform').onsubmit = e => {
  e.preventDefault(); const v = $('#gline').value.trim(); if (!v) return;
  log('> ' + v); gcode(v).then(() => $('#gline').value = '').catch(er => log('! ' + er.message));
};
function log(t) { const c = $('#console'); c.textContent += t + '\n'; c.scrollTop = c.scrollHeight; }

/* ---------- camera ---------- */
function startCam() {
  const img = $('#camImg'), off = $('#camOff');
  if (!cfg.cam) { off.hidden = false; img.removeAttribute('src'); return; }
  img.onload = () => off.hidden = true;
  img.onerror = () => { off.hidden = false; setTimeout(startCam, 8000); };
  img.src = cfg.cam.replace(/\/$/, '') + '/mjpeg?t=' + Date.now();
}
$('#btnCamFull').onclick = () => { $('#camFullImg').src = $('#camImg').src; $('#camFull').hidden = false; };
$('#btnCamClose').onclick = () => { $('#camFull').hidden = true; $('#camFullImg').removeAttribute('src'); };

/* ---------- agent rules (run locally while the dashboard is open) ---------- */
const RULES = [
  { id: 'runaway', name: 'Heater runaway', desc: 'Target exceeded by 20° or nozzle above 285°', on: true },
  { id: 'stuck', name: 'Heater not rising', desc: 'Below target and not climbing for 3 minutes', on: true },
  { id: 'drop', name: 'Temperature drop while printing', desc: '15° under target for 30 seconds', on: true },
  { id: 'lost', name: 'Printer connection lost', desc: 'Printer drops offline during a print', on: true },
  { id: 'done', name: 'Print finished', desc: 'Notify when a job completes or fails', on: true },
  { id: 'autopause', name: 'Auto-pause on danger', desc: 'Pause the print when a rule above fires', on: false }
];
const ruleOn = store.get('rules', {});
RULES.forEach(r => { if (ruleOn[r.id] == null) ruleOn[r.id] = r.on; });
$('#rules').innerHTML = RULES.map(r => `<li><div>${r.name}<small>${r.desc}</small></div>
  <label class="sw"><input type="checkbox" data-r="${r.id}" ${ruleOn[r.id] ? 'checked' : ''}><span></span></label></li>`).join('');
$('#rules').onchange = e => { ruleOn[e.target.dataset.r] = e.target.checked; store.set('rules', ruleOn); };

let alerts = store.get('alerts', []);
const lastFired = {};
function renderAlerts() {
  $('#alerts').innerHTML = alerts.length ? alerts.map(a => `<li class="${a.level}">${esc(a.msg)}<time>${new Date(a.t).toLocaleString()}</time></li>`).join('')
    : '<li class="empty">Nothing to report. All quiet.</li>';
}
function alertUser(id, level, msg, cooldown = 120000) {
  if (Date.now() - (lastFired[id] || 0) < cooldown) return false;
  lastFired[id] = Date.now();
  alerts.unshift({ t: Date.now(), level, msg }); alerts = alerts.slice(0, 50); store.set('alerts', alerts);
  renderAlerts(); toast(msg);
  if (!$('#tab-agent').classList.contains('active')) $('#alertDot').hidden = false;
  try { window.Octo4a && window.Octo4a.notify && window.Octo4a.notify('PrintDeck', msg); } catch {}
  return true;
}
$('#btnClearAlerts').onclick = () => { alerts = []; store.set('alerts', alerts); renderAlerts(); };

const dropSince = {}, stuckRef = {};
function danger(id, msg) {
  if (alertUser(id, 'bad', msg) && ruleOn.autopause && S.printer && S.printer.state.flags.printing)
    api('/api/job', { json: { command: 'pause', action: 'pause' } }).then(() => alertUser('ap' + id, 'info', 'Print paused automatically.', 0)).catch(() => {});
}
function runRules() {
  const fl = S.printer && S.printer.state.flags, printing = fl && fl.printing;
  const wasPrinting = S.prev.printing;
  if (S.printer) {
    const t = S.printer.temperature;
    [['tool0', 'Nozzle'], ['bed', 'Bed']].forEach(([k, name]) => {
      const h = t[k]; if (!h || h.actual == null) return;
      if (ruleOn.runaway && h.target > 0 && h.actual > h.target + 20) danger('run' + k, `${name} is ${Math.round(h.actual)}° with target ${Math.round(h.target)}°. Possible runaway.`);
      if (ruleOn.runaway && k === 'tool0' && h.actual > 285) danger('hot', `Nozzle at ${Math.round(h.actual)}°, above the safe limit.`);
      if (ruleOn.drop && printing && h.target > 0 && h.actual < h.target - 15) {
        dropSince[k] = dropSince[k] || Date.now();
        if (Date.now() - dropSince[k] > 30000) danger('drop' + k, `${name} fell to ${Math.round(h.actual)}° (target ${Math.round(h.target)}°) during the print.`);
      } else dropSince[k] = 0;
      if (ruleOn.stuck && h.target > 0 && h.actual < h.target - 10) {
        const r = stuckRef[k];
        if (!r || h.actual > r.v + 2) stuckRef[k] = { t: Date.now(), v: h.actual };
        else if (Date.now() - r.t > 180000) danger('stuck' + k, `${name} is not heating (${Math.round(h.actual)}° of ${Math.round(h.target)}°).`);
      } else stuckRef[k] = null;
    });
  }
  if (ruleOn.lost && wasPrinting && !S.printer) danger('lost', 'Lost the printer connection during a print.');
  if (ruleOn.done && wasPrinting && S.printer && !printing && !fl.paused && !fl.pausing) {
    const pct = S.job && S.job.progress && S.job.progress.completion;
    pct >= 99.5 ? alertUser('done', 'info', 'Print finished.', 0) : alertUser('fail', 'bad', 'Print stopped at ' + Math.round(pct || 0) + '%.', 0);
  }
  S.prev.printing = !!(printing || (fl && (fl.paused || fl.pausing)));
}

/* ---------- environment sensor (optional) ---------- */
async function pollEnv() {
  const pill = $('#envPill');
  if (!cfg.env) { pill.hidden = true; return; }
  try {
    const r = await fetch(cfg.env.replace(/\/$/, '') + '/api', { cache: 'no-store' }).then(x => x.json());
    const t = r.temperature ?? r.temp, h = r.humidity ?? r.hum;
    if (t == null) throw 0;
    pill.textContent = `${(+t).toFixed(1)}°  ${h != null ? Math.round(h) + '%' : ''}`; pill.hidden = false;
    if (cfg.humid && h > 65) alertUser('humid', 'info', `Humidity is ${Math.round(h)}%. Filament may absorb moisture.`, 3600000);
  } catch { pill.hidden = true; }
}

/* ---------- settings ---------- */
const dlg = $('#dlgSettings');
function openSettings() {
  $('#sBase').value = cfg.base; $('#sKey').value = cfg.key; $('#sCam').value = cfg.cam; $('#sEnv').value = cfg.env; $('#sHumid').checked = cfg.humid;
  dlg.returnValue = ''; dlg.showModal();
}
$('#btnSettings').onclick = openSettings;
dlg.onclose = () => {
  if (dlg.returnValue !== 'save') return;
  cfg.base = $('#sBase').value.trim().replace(/\/$/, '') || cfg.base; cfg.key = $('#sKey').value.trim();
  cfg.cam = $('#sCam').value.trim(); cfg.env = $('#sEnv').value.trim(); cfg.humid = $('#sHumid').checked;
  saveCfg(); startCam(); pollEnv(); poll(); toast('Saved');
};

/* ---------- boot ---------- */
renderAlerts(); startCam(); poll(); pollEnv();
setInterval(poll, 2000); setInterval(pollEnv, 60000);
if (!cfg.key) setTimeout(openSettings, 400);
})();
