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
  const toUSC = (value, currency) => {
    const amount = number(value), code = String(currency || "").trim().toUpperCase();
    return code === "USD" ? amount * 100 : amount;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const loadAccounts = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } };
  const saveAccounts = (a) => localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  let accounts = loadAccounts(), snapshots = [], selectedRange = "today";
  let heartbeatTimer = null, refreshTimer = null, viewerStarted = false;
  let requestInProgress = false;

  function setConnection(connected, message) {
    const el = $("connectionStatus");
    if (!el) return;
    el.classList.toggle("connected", !!connected);
    el.classList.toggle("connecting", !connected);
    el.querySelector(".connection-dot").textContent = "•";
    el.querySelector(".connection-text").textContent = message || (connected ? "Connected" : "Connecting...");
  }

  // Use Cambodia's calendar date (UTC+7), independent of the device timezone.
  function cambodiaToday() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone:"Asia/Phnom_Penh", year:"numeric", month:"2-digit", day:"2-digit"
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map(x => [x.type,x.value]));
    return new Date(Number(p.year), Number(p.month)-1, Number(p.day));
  }
  const pad2 = n => String(n).padStart(2,"0");
  const toDateInput = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  function setDateRange(from,to,name) {
    $("dateFrom").value = toDateInput(from);
    $("dateTo").value = toDateInput(to);
    selectedRange = name || "custom";
    document.querySelectorAll(".range-btn").forEach(b => b.classList.toggle("active",b.dataset.range===selectedRange));
  }
  function applyPreset(name) {
    const today = cambodiaToday(), from = new Date(today), to = new Date(today), day = today.getDay();
    if(name==="yesterday"){from.setDate(from.getDate()-1);to.setTime(from.getTime());}
    else if(name==="thisWeek") from.setDate(from.getDate()-((day+6)%7));
    else if(name==="lastWeek"){from.setDate(from.getDate()-((day+6)%7)-7);to.setTime(from.getTime());to.setDate(to.getDate()+6);}
    else if(name==="thisMonth") from.setDate(1);
    else if(name==="lastMonth"){from.setDate(1);from.setMonth(from.getMonth()-1);to.setTime(today.getTime());to.setDate(0);}
    setDateRange(from,to,name);
  }
  function notice(message,error=false) {
    const el=$("notice"); if(!el)return;
    el.textContent=message; el.classList.toggle("error",error);
  }
  function setMoney(id,value,currency,colored=false) {
    const el=$(id); if(!el)return;
    el.textContent=money(value,currency);
    el.classList.toggle("positive",colored&&number(value)>0);
    el.classList.toggle("negative",colored&&number(value)<0);
    el.classList.toggle("neutral",colored&&number(value)===0);
  }
  function isSnapshotLive(s) {
    const stamp=Date.parse(s?.updatedAt||"");
    return Number.isFinite(stamp) && Date.now()-stamp<=15000 && Date.now()>=stamp-5000;
  }

  function render() {
    const body=$("accountsBody");
    if(!accounts.length) {
      body.innerHTML='<tr><td colspan="7" class="empty">No accounts added yet. Select “Add Account” to begin.</td></tr>';
      ["todayProfit","weekProfit","monthProfit","allProfit","floating","totalBalance","totalEquity","marginUsed","freeMargin","openPositions"].forEach(id=>{if($(id)){$(id).textContent="—";$(id).classList.remove("positive","negative","neutral");}});
      $("accountsOpen").textContent="0/0 accounts open"; return;
    }
    const byKey=new Map(snapshots.map(s=>[`${s.login}|${s.server}`,s]));
    const totals={today:0,week:0,month:0,all:0,float:0,balance:0,equity:0,margin:0,free:0,positions:0,accountsOpen:0};
    body.innerHTML=accounts.map((a,i)=>{
      const s=byKey.get(`${a.login}|${a.server}`), live=!!s&&isSnapshotLive(s);
      if(!s) return `<tr><td><div class="account-name"><span class="status-dot offline"></span>${esc(a.displayName||a.login)}</div><div class="muted">ID: #${esc(a.login)} · ${esc(a.server)}</div><button class="remove" data-remove="${i}">Remove account</button></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td class="neutral">0.00</td></tr>`;
      const c=s.currency||"", floating=live?number(s.floating):0;
      totals.today+=toUSC(s.today,c); totals.week+=toUSC(s.week,c); totals.month+=toUSC(s.month,c);
      totals.all+=toUSC(s.allTime,c); totals.float+=live?toUSC(floating,c):0;
      totals.balance+=toUSC(s.balance,c); totals.equity+=toUSC(s.equity,c);
      totals.margin+=toUSC(s.margin,c); totals.free+=toUSC(s.freeMargin,c);
      if(live){totals.positions+=number(s.openPositions);if(number(s.openPositions)>0)totals.accountsOpen++;}
      return `<tr><td><div class="account-name"><span class="status-dot ${live?"online":"offline"}" title="${live?"Connected":"Offline"}"></span>${esc(s.displayName||a.displayName||a.login)}</div><div class="muted">ID: #${esc(a.login)} · ${esc(a.server)}</div><button class="remove" data-remove="${i}">Remove account</button></td><td>${money(s.balance,c)}</td><td class="${profitClass(s.today)}">${money(s.today,c)}</td><td class="${profitClass(s.week)}">${money(s.week,c)}</td><td class="${profitClass(s.month)}">${money(s.month,c)}</td><td class="${profitClass(s.allTime)}">${money(s.allTime,c)}</td><td class="${profitClass(floating)}">${money(floating,c)}</td></tr>`;
    }).join("");
    setMoney("todayProfit",totals.today,"USC",true); setMoney("weekProfit",totals.week,"USC",true);
    setMoney("monthProfit",totals.month,"USC",true); setMoney("allProfit",totals.all,"USC",true);
    setMoney("floating",totals.float,"USC",true); setMoney("totalBalance",totals.balance,"USC");
    setMoney("totalEquity",totals.equity,"USC"); setMoney("marginUsed",totals.margin,"USC");
    setMoney("freeMargin",totals.free,"USC"); $("openPositions").textContent=String(totals.positions);
    const liveCount=accounts.filter(a=>isSnapshotLive(byKey.get(`${a.login}|${a.server}`))).length;
    $("accountsOpen").textContent=`${totals.accountsOpen}/${liveCount} live accounts open`;
  }

  async function refresh() {
    if(!accounts.length){setConnection(false,"Connecting...");return;}
    if(requestInProgress)return;
    requestInProgress=true;
    try {
      const response=await fetch(`${WORKER_URL}/api/snapshots`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accounts})
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);
      snapshots=result.snapshots||[];
      setConnection(true,"Connected");
      render();
    } catch(e) {
      setConnection(false,"Connecting...");
    } finally {requestInProgress=false;}
  }

  async function sessionRequest(path,keepalive=false) {
    if(!accounts.length)return false;
    try {
      const r=await fetch(`${WORKER_URL}${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accounts}),keepalive});
      return r.ok;
    } catch {return false;}
  }
  async function startViewer() {
    if(!accounts.length){setConnection(false,"Connecting...");return;}
    const ok=await sessionRequest("/api/session/start");
    viewerStarted=ok;
    await refresh();
  }
  function enableViewer() {
    if(!accounts.length){setConnection(false,"Connecting...");return;}
    setConnection(false,"Connecting...");
    startViewer();
    if(!heartbeatTimer)heartbeatTimer=setInterval(()=>sessionRequest("/api/session/heartbeat"),15000);
    if(!refreshTimer)refreshTimer=setInterval(refresh,2000);
  }
  function disableViewer() {
    viewerStarted=false;
    if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}
    if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}
    setConnection(false,"Connecting...");
  }

  $("addBtn").addEventListener("click",()=>$("addDialog").showModal());
  $("closeDialog").addEventListener("click",()=>$("addDialog").close());
  $("cancelBtn").addEventListener("click",()=>$("addDialog").close());
  $("addForm").addEventListener("submit",event=>{
    event.preventDefault();
    const login=$("loginInput").value.trim(),server=$("serverInput").value.trim(),keycode=$("keyInput").value.trim();
    if(!/^\d{6}$/.test(keycode)){notice("Keycode must be exactly 6 digits.",true);return;}
    if(accounts.some(a=>a.login===login&&a.server===server)){notice("This account is already in your list.",true);return;}
    accounts.push({login,server,keycode});saveAccounts(accounts);
    $("addForm").reset();$("addDialog").close();snapshots=[];render();enableViewer();
  });
  $("accountsBody").addEventListener("click",event=>{
    const b=event.target.closest("[data-remove]");if(!b)return;
    accounts.splice(Number(b.dataset.remove),1);saveAccounts(accounts);snapshots=[];render();
    disableViewer();if(accounts.length&&document.visibilityState==="visible")enableViewer();
  });

  // Date selector interaction: presets set Cambodia-local calendar dates.
  document.querySelectorAll(".range-btn").forEach(btn=>btn.addEventListener("click",()=>applyPreset(btn.dataset.range)));
  function customDateChanged(){
    selectedRange="custom";
    document.querySelectorAll(".range-btn").forEach(b=>b.classList.remove("active"));
    const f=$("dateFrom").value,t=$("dateTo").value;
    if(f&&t&&f>t){notice("The From date must be before or equal to the To date.",true);return;}
    // Historical profit filtering needs closed-deal history from the EA; this selector
    // stores the chosen interval but does not fabricate historical totals from summaries.
  }
  $("dateFrom").addEventListener("change",customDateChanged);
  $("dateTo").addEventListener("change",customDateChanged);
  $("accountsBody").addEventListener("click",()=>{});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")enableViewer();else disableViewer();});
  window.addEventListener("pagehide",disableViewer);

  // Default selected period: Today in Cambodia.
  applyPreset("today");
  render();
  if(document.visibilityState==="visible")enableViewer();
})();
