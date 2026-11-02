(() => {
  "use strict";
  // Change this to your deployed Cloudflare Worker URL.  
  const WORKER_URL = "https://monitor.mt5dashboard.workers.dev";
  const STORAGE_KEY = "mt5_client_monitor_accounts_v1";
  const $ = (id) => document.getElementById(id);
  const money = (value, currency) => {
    const n = Number(value || 0);
    return `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency || ""}`.trim();
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const loadAccounts = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } };
  const saveAccounts = (a) => localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  let accounts = loadAccounts();
  let snapshots = [];

  function notice(message, error=false) { $("notice").textContent = message; $("notice").classList.toggle("error", error); }
  function render() {
    const body = $("accountsBody");
    $("accountCount").textContent = `${accounts.length} account${accounts.length===1?"":"s"}`;
    if (!accounts.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">No accounts added yet. Select “Add Account” to begin.</td></tr>';
      ["todayProfit","weekProfit","monthProfit","allProfit","floating","totalBalance","totalEquity","marginUsed","freeMargin","openPositions"].forEach(id => $(id).textContent="—");
      return;
    }
    const byKey = new Map(snapshots.map(s => [`${s.login}|${s.server}`,s]));
    let totals = {today:0,week:0,month:0,all:0,float:0,balance:0,equity:0,margin:0,free:0,positions:0};
    body.innerHTML = accounts.map((a,i) => {
      const s = byKey.get(`${a.login}|${a.server}`);
      if (!s) return `<tr><td><span class="account-name">${esc(a.login)}</span><div class="muted">No data received yet</div></td><td>${esc(a.server)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>Waiting</td><td><button class="remove" data-remove="${i}">Remove</button></td></tr>`;
      const currency = s.currency || "";
      ["today","week","month","all","float","balance","equity","margin","free"].forEach(k => totals[k] += Number(s[k==="float"?"floating":k==="all"?"allTime":k==="balance"?"balance":k==="equity"?"equity":k==="margin"?"margin":k==="free"?"freeMargin":k==="today"?"today":k==="week"?"week": "month"] || 0));
      totals.positions += Number(s.openPositions || 0);
      const p = Number(s.floating || 0);
      const updated = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "—";
      return `<tr><td><span class="account-name">${esc(s.displayName || a.login)}</span><div class="muted">${esc(a.login)} · ${esc(currency)}</div></td><td>${esc(a.server)}</td><td>${money(s.balance,currency)}</td><td>${money(s.equity,currency)}</td><td class="${p>=0?"positive":"negative"}">${money(p,currency)}</td><td>${Number(s.openPositions||0)}</td><td>${esc(updated)}</td><td><button class="remove" data-remove="${i}">Remove</button></td></tr>`;
    }).join("");
    const currency = snapshots[0]?.currency || "";
    $("todayProfit").textContent=money(totals.today,currency);
    $("weekProfit").textContent=money(totals.week,currency);
    $("monthProfit").textContent=money(totals.month,currency);
    $("allProfit").textContent=money(totals.all,currency);
    $("floating").textContent=money(totals.float,currency);
    $("totalBalance").textContent=money(totals.balance,currency);
    $("totalEquity").textContent=money(totals.equity,currency);
    $("marginUsed").textContent=money(totals.margin,currency);
    $("freeMargin").textContent=money(totals.free,currency);
    $("openPositions").textContent=String(totals.positions);
  }

  async function refresh() {
    if (!accounts.length) { notice("Add an MT5 account first."); return; }
    if (WORKER_URL.includes("YOUR-WORKER-NAME")) { notice("Set your Cloudflare Worker URL in app.js before using Refresh.",true); return; }
    $("refreshBtn").disabled=true; $("refreshBtn").textContent="Refreshing…";
    try {
      const response = await fetch(`${WORKER_URL.replace(/\/$/,"")}/api/snapshots`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({accounts})
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      snapshots = result.snapshots || [];
      render();
      const missing = result.invalidCount || 0;
      notice(`Updated ${snapshots.length} of ${accounts.length} account(s). ${missing ? `${missing} account(s) could not be verified. `:""}Snapshot times are shown in the table.`);
    } catch (e) { notice(`Refresh failed: ${e.message}`,true); }
    finally { $("refreshBtn").disabled=false; $("refreshBtn").textContent="↻ Refresh"; }
  }

  $("addBtn").addEventListener("click",()=>$("addDialog").showModal());
  $("closeDialog").addEventListener("click",()=>$("addDialog").close());
  $("cancelBtn").addEventListener("click",()=>$("addDialog").close());
  $("addForm").addEventListener("submit",(event)=>{
    event.preventDefault();
    const login=$("loginInput").value.trim(), server=$("serverInput").value.trim(), keycode=$("keyInput").value.trim().toUpperCase();
    if(!/^[A-Z0-9]{12}$/.test(keycode)){notice("Keycode must be exactly 12 letters/numbers.",true);return;}
    if(accounts.some(a=>a.login===login&&a.server===server)){notice("This account is already in your list.",true);return;}
    accounts.push({login,server,keycode}); saveAccounts(accounts);
    $("addForm").reset(); $("addDialog").close(); snapshots=[]; render();
    notice("Account added. Make sure its MT5 monitoring EA is running, then press Refresh.");
  });
  $("accountsBody").addEventListener("click",(event)=>{
    const button=event.target.closest("[data-remove]"); if(!button)return;
    accounts.splice(Number(button.dataset.remove),1); saveAccounts(accounts); snapshots=[]; render(); notice("Account removed from this browser.");
  });
  $("refreshBtn").addEventListener("click",refresh);
  render();
})();
