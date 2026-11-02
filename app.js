(() => {
  "use strict";
  const WORKER_URL = "https://monitor.mt5dashboard.workers.dev";
  const STORAGE_KEY = "mt5_client_monitor_accounts_v1";
  const $ = (id) => document.getElementById(id);
  const number = (value) => Number(value || 0);
  const money = (value, currency) => {
    const n = number(value);
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return `${sign}${Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency || ""}`.trim();
  };
  const profitClass = (value) => number(value) > 0 ? "positive" : number(value) < 0 ? "negative" : "neutral";
  // Normalize USD and USC account values into USC for combined dashboard totals.
  // 1 USD = 100 USC. Individual account rows continue to show native currency.
  const toUSC = (value, currency) => {
    const amount = number(value);
    const code = String(currency || "").trim().toUpperCase();
    if (code === "USD") return amount * 100;
    if (code === "USC") return amount;
    return amount;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const loadAccounts = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } };
  const saveAccounts = (a) => localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  let accounts = loadAccounts();
  let snapshots = [];
  let selectedRange = "today";

  const pad2 = (n) => String(n).padStart(2, "0");
  const toDateInput = (date) => `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`;
  function setDateRange(from, to, rangeName) {
    $("dateFrom").value = toDateInput(from);
    $("dateTo").value = toDateInput(to);
    selectedRange = rangeName || "custom";
    document.querySelectorAll(".range-btn").forEach(btn =>
      btn.classList.toggle("active", btn.dataset.range === selectedRange));
  }
  function applyPreset(name) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = today.getDay();
    let from = new Date(today), to = new Date(today);
    if (name === "yesterday") {
      from.setDate(from.getDate()-1); to = new Date(from);
    } else if (name === "thisWeek") {
      from.setDate(from.getDate() - ((day + 6) % 7));
    } else if (name === "lastWeek") {
      from.setDate(from.getDate() - ((day + 6) % 7) - 7);
      to = new Date(from); to.setDate(to.getDate()+6);
    } else if (name === "thisMonth") {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (name === "lastMonth") {
      from = new Date(today.getFullYear(), today.getMonth()-1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0);
    }
    setDateRange(from, to, name);
  }

  function notice(message, error=false) {
    $("notice").textContent = message;
    $("notice").classList.toggle("error", error);
  }
  function setMoney(id, value, currency, colored=false) {
    const el = $(id);
    el.textContent = money(value, currency);
    el.classList.toggle("positive", colored && number(value) > 0);
    el.classList.toggle("negative", colored && number(value) < 0);
    el.classList.toggle("neutral", colored && number(value) === 0);
  }
  function render() {
    const body = $("accountsBody");
    if (!accounts.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">No accounts added yet. Select “Add Account” to begin.</td></tr>';
      ["todayProfit","weekProfit","monthProfit","allProfit","floating","totalBalance","totalEquity","marginUsed","freeMargin","openPositions"].forEach(id => { $(id).textContent="—"; $(id).classList.remove("positive","negative","neutral"); });
      $("accountsOpen").textContent="0/0 accounts open";
      return;
    }
    const byKey = new Map(snapshots.map(s => [`${s.login}|${s.server}`,s]));
    const totals = {today:0,week:0,month:0,all:0,float:0,balance:0,equity:0,margin:0,free:0,positions:0,accountsOpen:0};
    body.innerHTML = accounts.map((a,i) => {
      const s = byKey.get(`${a.login}|${a.server}`);
      if (!s) return `<tr><td><div class="account-name">${esc(a.displayName || a.login)}</div><div class="muted">${esc(a.login)} · ${esc(a.server)}</div><button class="remove" data-remove="${i}">Remove account</button><div class="waiting">Waiting for MT5 data</div></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
      const currency = s.currency || "";
      totals.today += toUSC(s.today,currency); totals.week += toUSC(s.week,currency); totals.month += toUSC(s.month,currency);
      totals.all += toUSC(s.allTime,currency); totals.float += toUSC(s.floating,currency); totals.balance += toUSC(s.balance,currency);
      totals.equity += toUSC(s.equity,currency); totals.margin += toUSC(s.margin,currency); totals.free += toUSC(s.freeMargin,currency);
      totals.positions += number(s.openPositions);
      if (number(s.openPositions) > 0) totals.accountsOpen += 1;
      return `<tr>
        <td><div class="account-name">${esc(s.displayName || a.displayName || a.login)}</div><div class="muted">${esc(a.login)} · ${esc(a.server)}</div><button class="remove" data-remove="${i}">Remove account</button></td>
        <td>${money(s.balance,currency)}</td>
        <td class="${profitClass(s.today)}">${money(s.today,currency)}</td>
        <td class="${profitClass(s.week)}">${money(s.week,currency)}</td>
        <td class="${profitClass(s.month)}">${money(s.month,currency)}</td>
        <td class="${profitClass(s.allTime)}">${money(s.allTime,currency)}</td>
        <td class="${profitClass(s.floating)}">${money(s.floating,currency)}</td>
      </tr>`;
    }).join("");
    // All combined dashboard cards use USC so USD and USC accounts can be added correctly.
    const totalCurrency = "USC";
    setMoney("todayProfit",totals.today,totalCurrency,true);
    setMoney("weekProfit",totals.week,totalCurrency,true);
    setMoney("monthProfit",totals.month,totalCurrency,true);
    setMoney("allProfit",totals.all,totalCurrency,true);
    setMoney("floating",totals.float,totalCurrency,true);
    setMoney("totalBalance",totals.balance,totalCurrency);
    setMoney("totalEquity",totals.equity,totalCurrency);
    setMoney("marginUsed",totals.margin,totalCurrency);
    setMoney("freeMargin",totals.free,totalCurrency);
    $("openPositions").textContent=String(totals.positions);
    $("accountsOpen").textContent=`${totals.accountsOpen}/${snapshots.length} accounts open`;
  }

  async function refresh(silent=false) {
    if (!accounts.length) { if(!silent) notice("Add an MT5 account first."); return; }
    if(!silent){ $("refreshBtn").disabled=true; $("refreshBtn").textContent="Refreshing…"; }
    try {
      const response = await fetch(`${WORKER_URL.replace(/\/$/,"")}/api/snapshots`, {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({accounts})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      snapshots = result.snapshots || [];
      render();
      const missing = result.invalidCount || 0;
      if(!silent) notice(`Updated ${snapshots.length} of ${accounts.length} accounts.${missing ? ` ${missing} account(s) could not be verified.` : ""}`);
    } catch (e) { if(!silent) notice(`Refresh failed: ${e.message}`,true); }
    finally { if(!silent){ $("refreshBtn").disabled=false; $("refreshBtn").textContent="↻ Refresh"; } }
  }


  // Browser viewer lease: EA keeps uploading only while this lease is renewed.
  let viewerStarted=false;
  async function sessionRequest(path, keepalive=false) {
    if(!accounts.length) return;
    try {
      await fetch(`${WORKER_URL.replace(/\/$/,"")}${path}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({accounts}), keepalive
      });
    } catch (e) { /* Lease expires automatically if the browser disconnects. */ }
  }
  async function startViewer() {
    if(!accounts.length) return;
    await sessionRequest("/api/session/start"); viewerStarted=true;
    await refresh(true);
  }
  function stopViewer() {
    // Do not revoke the shared account lease from one tab; it expires 45 seconds
    // after the last visible tab heartbeat. This supports multiple open tabs.
    viewerStarted=false;
  }
  let heartbeatTimer=null, refreshTimer=null;
  function enableViewer() {
    if(!accounts.length) return;
    startViewer();
    if(!heartbeatTimer) heartbeatTimer=setInterval(()=>sessionRequest("/api/session/heartbeat"),15000);
    if(!refreshTimer) refreshTimer=setInterval(()=>refresh(true),2000);
  }
  function disableViewer() {
    stopViewer();
    if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}
    if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}
  }

  $("addBtn").addEventListener("click",()=>$ ("addDialog").showModal());
  $("closeDialog").addEventListener("click",()=>$ ("addDialog").close());
  $("cancelBtn").addEventListener("click",()=>$ ("addDialog").close());
  $("addForm").addEventListener("submit",(event)=>{
    event.preventDefault();
    const login=$("loginInput").value.trim(), server=$("serverInput").value.trim(), keycode=$("keyInput").value.trim();
    if(!/^\d{6}$/.test(keycode)){notice("Keycode must be exactly 6 digits.",true);return;}
    if(accounts.some(a=>a.login===login&&a.server===server)){notice("This account is already in your list.",true);return;}
    accounts.push({login,server,keycode}); saveAccounts(accounts);
    $("addForm").reset(); $("addDialog").close(); snapshots=[]; render();
    notice("Account added. Waiting for the MT5 monitoring EA.");
    if(document.visibilityState==="visible") enableViewer();
  });
  $("accountsBody").addEventListener("click",(event)=>{
    const button=event.target.closest("[data-remove]"); if(!button)return;
    accounts.splice(Number(button.dataset.remove),1); saveAccounts(accounts); snapshots=[]; render(); notice("Account removed from this browser.");
    disableViewer(); if(accounts.length && document.visibilityState==="visible") enableViewer();
  });
  $("refreshBtn").addEventListener("click",()=>refresh(false));
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible") enableViewer(); else disableViewer();
  });
  window.addEventListener("pagehide",()=>disableViewer());
  render();
  if(document.visibilityState==="visible") enableViewer();
})();
