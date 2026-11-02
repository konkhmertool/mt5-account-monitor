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
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const loadAccounts = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } };
  const saveAccounts = (a) => localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  let accounts = loadAccounts();
  let snapshots = [];

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
      return;
    }
    const byKey = new Map(snapshots.map(s => [`${s.login}|${s.server}`,s]));
    const totals = {today:0,week:0,month:0,all:0,float:0,balance:0,equity:0,margin:0,free:0,positions:0};
    body.innerHTML = accounts.map((a,i) => {
      const s = byKey.get(`${a.login}|${a.server}`);
      if (!s) return `<tr><td><div class="account-name">${esc(a.displayName || a.login)}</div><div class="muted">${esc(a.login)} · ${esc(a.server)}</div><button class="remove" data-remove="${i}">Remove account</button><div class="waiting">Waiting for MT5 data</div></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
      const currency = s.currency || "";
      totals.today += number(s.today); totals.week += number(s.week); totals.month += number(s.month);
      totals.all += number(s.allTime); totals.float += number(s.floating); totals.balance += number(s.balance);
      totals.equity += number(s.equity); totals.margin += number(s.margin); totals.free += number(s.freeMargin);
      totals.positions += number(s.openPositions);
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
    const currency = snapshots[0]?.currency || "";
    setMoney("todayProfit",totals.today,currency,true);
    setMoney("weekProfit",totals.week,currency,true);
    setMoney("monthProfit",totals.month,currency,true);
    setMoney("allProfit",totals.all,currency,true);
    setMoney("floating",totals.float,currency,true);
    setMoney("totalBalance",totals.balance,currency);
    setMoney("totalEquity",totals.equity,currency);
    setMoney("marginUsed",totals.margin,currency);
    setMoney("freeMargin",totals.free,currency);
    $("openPositions").textContent=String(totals.positions);
  }

  async function refresh() {
    if (!accounts.length) { notice("Add an MT5 account first."); return; }
    $("refreshBtn").disabled=true; $("refreshBtn").textContent="Refreshing…";
    try {
      const response = await fetch(`${WORKER_URL.replace(/\/$/,"")}/api/snapshots`, {
        method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({accounts})
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
    notice("Account added. Make sure its MT5 monitoring EA is running, then press Refresh.");
  });
  $("accountsBody").addEventListener("click",(event)=>{
    const button=event.target.closest("[data-remove]"); if(!button)return;
    accounts.splice(Number(button.dataset.remove),1); saveAccounts(accounts); snapshots=[]; render(); notice("Account removed from this browser.");
  });
  $("refreshBtn").addEventListener("click",refresh);
  render();
})();
