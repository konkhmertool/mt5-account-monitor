'use strict';

// This URL must match the deployed Cloudflare Worker.
const API_BASE = 'https://monitor.mt5dashboard.workers.dev';
const SESSION_KEY = 'mab_kaakoo_client_session_v1';

const $ = (id) => document.getElementById(id);
const pairSection = $('pairSection');
const dashboardSection = $('dashboardSection');
const pairForm = $('pairForm');
let sessionToken = localStorage.getItem(SESSION_KEY) || '';
let refreshTimer = null;

$('year').textContent = new Date().getFullYear();

function showMessage(message, type='') {
  const el = $('pairMessage');
  el.textContent = message;
  el.className = `message ${type}`;
}
function setMoney(id, value, currency) {
  const n = Number(value || 0);
  const el = $(id);
  el.textContent = `${n.toFixed(2)} ${currency || ''}`.trim();
  el.classList.toggle('positive', n > 0);
  el.classList.toggle('negative', n < 0);
}
async function api(path, options={}) {
  const headers = {'Content-Type':'application/json', ...(options.headers || {})};
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;
  const response = await fetch(`${API_BASE}${path}`, {...options, headers});
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function showDashboard() {
  pairSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
}
function showPairForm(message='') {
  if (refreshTimer) clearInterval(refreshTimer);
  sessionToken = '';
  localStorage.removeItem(SESSION_KEY);
  dashboardSection.classList.add('hidden');
  pairSection.classList.remove('hidden');
  $('logoutBtn').classList.add('hidden');
  if (message) showMessage(message, 'error');
}
function renderPositions(positions) {
  const body = $('positionsBody');
  $('positionCount').textContent = Array.isArray(positions) ? positions.length : '0';
  if (!Array.isArray(positions) || positions.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No open positions.</td></tr>';
    return;
  }
  body.replaceChildren();
  for (const p of positions) {
    const tr = document.createElement('tr');
    const values = [
      p.symbol ?? p.Symbol ?? '—',
      p.type ?? p.Type ?? p.side ?? '—',
      p.volume ?? p.volumeLots ?? p.Volume ?? '—',
      p.openPrice ?? p.price ?? p.PriceOpen ?? '—',
      p.profit ?? p.Profit ?? 0
    ];
    values.forEach((value, i) => {
      const td = document.createElement('td');
      td.textContent = i === 4 ? Number(value).toFixed(2) : String(value);
      if (i === 4) td.className = Number(value) > 0 ? 'positive' : Number(value) < 0 ? 'negative' : '';
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}
async function refreshDashboard() {
  try {
    const data = await api('/api/client/account', {method:'GET', authToken:sessionToken});
    const a = data.account || {};
    const currency = a.currency || '';
    $('accountIdentity').textContent = `Account ${a.account_login || '—'} · ${a.broker_server || '—'}`;
    $('brokerValue').textContent = a.broker_server || '—';
    $('symbolValue').textContent = a.symbol || '—';
    $('positionsValue').textContent = a.open_positions ?? 0;
    $('statusValue').textContent = 'Connected';
    setMoney('balanceValue', a.balance, currency);
    setMoney('equityValue', a.equity, currency);
    setMoney('floatingValue', a.floating_profit, currency);
    setMoney('todayValue', a.today_closed_profit, currency);
    const updated = a.updated_at ? new Date(a.updated_at.replace(' ', 'T') + (a.updated_at.endsWith('Z') ? '' : 'Z')) : null;
    $('lastUpdated').textContent = updated && !Number.isNaN(updated.getTime()) ? `Last update: ${updated.toLocaleString()}` : 'Waiting for MT5 data';
    $('connectionText').textContent = a.updated_at ? 'Live connection' : 'Waiting for MT5';
    let positions = [];
    try { positions = JSON.parse(a.positions_json || '[]'); } catch {}
    renderPositions(positions);
  } catch (err) {
    if (/session|unauthorized/i.test(err.message)) {
      showPairForm('Your website session expired. Please pair your account again.');
      return;
    }
    $('connectionText').textContent = 'Connection problem';
    $('statusValue').textContent = 'Unavailable';
  }
}
pairForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('pairBtn');
  button.disabled = true;
  showMessage('Connecting to your MT5 account…');
  const payload = {
    login: $('login').value.trim(),
    server: $('server').value.trim(),
    pairingCode: $('pairingCode').value.trim(),
    deviceId: 'browser-' + (localStorage.getItem('mab_kaakoo_device_id') || (() => {
      const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      localStorage.setItem('mab_kaakoo_device_id', id);
      return id;
    })())
  };
  try {
    const result = await api('/api/client/pair', {method:'POST', body:JSON.stringify(payload)});
    sessionToken = result.token;
    localStorage.setItem(SESSION_KEY, sessionToken);
    showDashboard();
    await refreshDashboard();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshDashboard, 5000);
  } catch (err) {
    showMessage(err.message || 'Could not connect account.', 'error');
  } finally {
    button.disabled = false;
  }
});
$('logoutBtn').addEventListener('click', () => showPairForm('You have logged out.'));
async function start() {
  if (!sessionToken) return;
  showDashboard();
  await refreshDashboard();
  if (sessionToken) refreshTimer = setInterval(refreshDashboard, 5000);
}
start();
