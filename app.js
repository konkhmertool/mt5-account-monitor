const $ = (id) => document.getElementById(id);
let activeApiUrl = "";
let activePin = "";
let refreshTimer = null;

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function money(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${fmt(n)}${currency ? ` ${escapeHtml(currency)}` : ""}`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function pnlClass(value) { return Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : ""; }
function setStatus(text, state = "") {
  $("connection").className = `status ${state}`;
  $("connection").innerHTML = `<i></i>${escapeHtml(text)}`;
}
function setMessage(text) { $("message").textContent = text; }

async function connect(event) {
  if (event) event.preventDefault();
  const url = $("apiUrl").value.trim().replace(/\/+$/, "");
  const pin = $("pin").value;
  if (!url || !pin) return;
  try { new URL(url); } catch { setMessage("Please enter a valid HTTPS Worker URL."); return; }
  if (!url.startsWith("https://")) { setMessage("Use an HTTPS URL for security."); return; }
  activeApiUrl = url;
  activePin = pin;
  await loadDashboard();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { if (activeApiUrl && activePin) loadDashboard(true); }, 30000);
}

async function loadDashboard(silent = false) {
  if (!activeApiUrl || !activePin) return;
  if (!silent) setMessage("Connecting to API…");
  try {
    const response = await fetch(`${activeApiUrl}/api/dashboard`, {
      method: "GET",
      headers: { "x-dashboard-pin": activePin, "accept": "application/json" },
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    renderDashboard(data.accounts || []);
    setStatus("Connected", "online");
    setMessage(`Loaded ${data.count ?? (data.accounts || []).length} account(s). Auto-refresh every 30 seconds.`);
  } catch (error) {
    setStatus("Connection issue", "error");
    setMessage(`${error.message}. Check the Worker URL, dashboard PIN, CORS origin and KV binding.`);
  }
}

function renderDashboard(accounts) {
  const balance = accounts.reduce((sum, a) => sum + Number(a.account?.balance || 0), 0);
  const equity = accounts.reduce((sum, a) => sum + Number(a.account?.equity || 0), 0);
  const floating = accounts.reduce((sum, a) => sum + Number(a.account?.floatingProfit || 0), 0);
  const today = accounts.reduce((sum, a) => sum + Number(a.account?.todayRealizedProfit || 0), 0);
  $("accountCount").textContent = accounts.length;
  $("totalBalance").textContent = fmt(balance);
  $("totalEquity").textContent = fmt(equity);
  $("totalFloating").textContent = fmt(floating);
  $("totalFloating").className = pnlClass(floating);
  $("totalToday").textContent = fmt(today);
  $("totalToday").className = pnlClass(today);

  const accountRows = accounts.map((snapshot) => {
    const a = snapshot.account || {};
    const positions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
    return `<tr>
      <td><strong>${escapeHtml(a.login)}</strong><br><span class="muted">${escapeHtml(a.server || "")}</span></td>
      <td>${escapeHtml(a.currency || "—")}</td>
      <td>${money(a.balance, a.currency)}</td><td>${money(a.equity, a.currency)}</td>
      <td class="${pnlClass(a.floatingProfit)}">${money(a.floatingProfit, a.currency)}</td>
      <td class="${pnlClass(a.todayRealizedProfit)}">${money(a.todayRealizedProfit, a.currency)}</td>
      <td>${positions.length}</td><td>${escapeHtml(snapshot.receivedAt || "—")}</td>
    </tr>`;
  });
  $("accountsBody").innerHTML = accountRows.length ? accountRows.join("") : '<tr><td colspan="8" class="empty">No account snapshots yet. Attach the EA to a chart and wait for its first update.</td></tr>';

  const positions = accounts.flatMap((snapshot) => (snapshot.positions || []).map((p) => ({ ...p, accountLogin: snapshot.account?.login, currency: snapshot.account?.currency })));
  $("positionCount").textContent = `${positions.length} position${positions.length === 1 ? "" : "s"}`;
  const positionRows = positions.map((p) => {
    const side = String(p.type || "").toUpperCase();
    return `<tr><td>${escapeHtml(p.accountLogin)}</td><td><strong>${escapeHtml(p.symbol)}</strong></td>
      <td class="${side === "BUY" ? "side-buy" : side === "SELL" ? "side-sell" : ""}">${escapeHtml(side)}</td>
      <td>${fmt(p.volume, 2)}</td><td>${fmt(p.openPrice, 5)}</td><td>${fmt(p.currentPrice, 5)}</td>
      <td>${Number(p.stopLoss) ? fmt(p.stopLoss, 5) : "—"}</td><td>${Number(p.takeProfit) ? fmt(p.takeProfit, 5) : "—"}</td>
      <td class="${pnlClass(p.profit)}">${money(p.profit, p.currency)}</td></tr>`;
  });
  $("positionsBody").innerHTML = positionRows.length ? positionRows.join("") : '<tr><td colspan="9" class="empty">No open positions.</td></tr>';
  $("lastUpdated").textContent = `Browser updated: ${new Date().toLocaleTimeString()}`;
}

$("connectForm").addEventListener("submit", connect);
$("refreshBtn").addEventListener("click", () => loadDashboard());
