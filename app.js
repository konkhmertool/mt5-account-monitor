(() => {
  "use strict";
  const WORKER_URL="https://monitor.mt5dashboard.workers.dev", STORAGE_KEY="mt5_client_monitor_accounts_v1";
  const $=id=>document.getElementById(id), n=v=>Number(v||0), pad=v=>String(v).padStart(2,"0");
  const money=(v,c)=>{v=n(v);return `${v>0?"+":v<0?"−":""}${Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${c||""}`.trim()};
  const cls=v=>n(v)>0?"positive":n(v)<0?"negative":"neutral";
  const toUSC=(v,c)=>String(c||"").toUpperCase()==="USD"?n(v)*100:n(v);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const load=()=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch{return []}};
  let accounts=load(),snapshots=[],profitRows=[],selectedRange="today",busy=false,heartbeat=null,poll=null,historyPoll=null,historyBusy=false;
  function setConnection(ok){const e=$("connectionStatus");if(!e)return;e.classList.toggle("connected",ok);e.classList.toggle("connecting",!ok);e.querySelector(".connection-text").textContent=ok?"Connected":"Connecting...";}
  function browserDate(){const d=new Date();return {y:d.getFullYear(),m:d.getMonth()+1,d:d.getDate()};}
  const dateString=o=>`${o.y}-${pad(o.m)}-${pad(o.d)}`;
  const shift=(o,days)=>{const d=new Date(Date.UTC(o.y,o.m-1,o.d+days));return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,d:d.getUTCDate()}};
  const firstMonth=o=>({y:o.y,m:o.m,d:1});
  const monday=o=>{const day=new Date(Date.UTC(o.y,o.m-1,o.d)).getUTCDay();return shift(o,-((day+6)%7))};
  const toStamp=s=>{const [y,m,d]=s.split("-").map(Number);return Math.floor(new Date(y,m-1,d,0,0,0,0).getTime()/1000)};
  function rangeDates(name){const today=browserDate();let from=today,to=today;if(name==="yesterday")from=to=shift(today,-1);else if(name==="thisWeek")from=monday(today);else if(name==="lastWeek"){from=shift(monday(today),-7);to=shift(from,6)}else if(name==="thisMonth")from=firstMonth(today);else if(name==="lastMonth"){const first=firstMonth(today);to=shift(first,-1);from=firstMonth(to)}return {from,to};}
  function labelForRange(){const map={today:"Today's Profit",yesterday:"Yesterday's Profit",thisWeek:"This Week's Profit",lastWeek:"Last Week's Profit",thisMonth:"This Month's Profit",lastMonth:"Last Month's Profit"};return map[selectedRange]||"Selected Period Profit";}
  function updateDateInputs(from,to){$("dateFrom").value=dateString(from);$("dateTo").value=dateString(to);}
  function applyPreset(name){selectedRange=name;const r=rangeDates(name);updateDateInputs(r.from,r.to);document.querySelectorAll(".range-btn").forEach(b=>b.classList.toggle("active",b.dataset.range===name));$("selectedProfitLabel").textContent=labelForRange();$("selectedRangeHeading").textContent=({today:"TODAY",yesterday:"YESTERDAY",thisWeek:"THIS WEEK",lastWeek:"LAST WEEK",thisMonth:"THIS MONTH",lastMonth:"LAST MONTH"})[name]||"SELECTED PERIOD";loadProfit().then(render).catch(e=>$("notice").textContent=e.message);}
  function chosenRange(){return {from:$ ("dateFrom").value,to:$ ("dateTo").value};}
  function selectedPeriodLabel(){return selectedRange==="custom"?"Selected Period":selectedRange==="today"?"Today":selectedRange==="yesterday"?"Yesterday":selectedRange==="thisWeek"?"This Week":selectedRange==="lastWeek"?"Last Week":selectedRange==="thisMonth"?"This Month":"Last Month";}
  function render(){
    const body=$("accountsBody"),foot=$("accountsFoot");if(!accounts.length){body.innerHTML='<tr><td colspan="7" class="empty">No accounts added yet. Select “Add Account” to begin.</td></tr>';foot.innerHTML="";return;}
    const snapMap=new Map(snapshots.map(s=>[`${s.login}|${s.server}`,s])),profitMap=new Map(profitRows.map(p=>[`${p.login}|${p.server}`,p]));
    const totals={balance:0,range:0,week:0,month:0,all:0,float:0,equity:0,margin:0,free:0,positions:0,live:0};
    body.innerHTML=accounts.map((a,i)=>{
      const s=snapMap.get(`${a.login}|${a.server}`),p=profitMap.get(`${a.login}|${a.server}`),live=s&&Date.now()-Date.parse(s.updatedAt)<=15000;
      if(!s)return `<tr><td><div class="account-name"><span class="account-queue">${i+1}</span><span class="status-dot offline"></span><span class="account-title">${esc(a.displayName||a.login)}</span></div><div class="muted">ID: #${esc(a.login)} · ${esc(a.server)}</div><button class="remove" data-remove="${i}">Remove account</button></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>0.00</td></tr>`;
      const c=s.currency||"",range=n(p?.rangeProfit),week=n(p?.weekProfit),month=n(p?.monthProfit),all=n(p?.allTimeProfit),floating=live?n(s.floating):0;
      totals.balance+=toUSC(s.balance,c);totals.range+=toUSC(range,c);totals.week+=toUSC(week,c);totals.month+=toUSC(month,c);totals.all+=toUSC(all,c);totals.float+=toUSC(floating,c);totals.equity+=toUSC(s.equity,c);totals.margin+=toUSC(s.margin,c);totals.free+=toUSC(s.freeMargin,c);if(live){totals.live++;totals.positions+=n(s.openPositions)}
      return `<tr><td><div class="account-name"><span class="account-queue">${i+1}</span><span class="status-dot ${live?"online":"offline"}" title="${live?"Live":"Offline"}"></span><span class="account-title">${esc(s.displayName||a.displayName||a.login)}</span></div><div class="muted">ID: #${esc(a.login)} · ${esc(a.server)}</div><button class="remove" data-remove="${i}">Remove account</button></td><td>${money(toUSC(s.balance,c),"USC")}</td><td class="${cls(range)}">${money(toUSC(range,c),"USC")}</td><td class="${cls(week)}">${money(toUSC(week,c),"USC")}</td><td class="${cls(month)}">${money(toUSC(month,c),"USC")}</td><td class="${cls(all)}">${money(toUSC(all,c),"USC")}</td><td class="${cls(floating)}">${money(toUSC(floating,c),"USC")}</td></tr>`;
    }).join("");
    const sums=[totals.balance,totals.range,totals.week,totals.month,totals.all,totals.float];
    foot.innerHTML=`<tr><th>TOTAL (${accounts.length} accounts)</th>${sums.map((v,i)=>`<th class="${i===0?"":cls(v)}">${money(v,"USC")}</th>`).join("")}</tr>`;
    $("selectedProfitLabel").textContent=labelForRange();setMoney("selectedProfit",totals.range);setMoney("weekProfit",totals.week);setMoney("monthProfit",totals.month);setMoney("allProfit",totals.all);setMoney("floating",totals.float);
    setMoney("totalBalance",totals.balance);setMoney("totalEquity",totals.equity);setMoney("marginUsed",totals.margin);setMoney("freeMargin",totals.free);$("openPositions").textContent=totals.positions;$("accountsOpen").textContent=`${accounts.filter(a=>{const s=snapMap.get(`${a.login}|${a.server}`);return s&&Date.now()-Date.parse(s.updatedAt)<=15000&&n(s.openPositions)>0}).length}/${totals.live} live accounts open`;
  }
  function setMoney(id,v){const e=$(id);e.textContent=money(v,"USC");e.classList.remove("positive","negative","neutral");e.classList.add(cls(v));}
  async function post(path,data){const r=await fetch(WORKER_URL+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j;}
  async function loadProfit(){
    if(!accounts.length||historyBusy)return;const r=chosenRange();if(!r.from||!r.to||r.from>r.to)return;historyBusy=true;
    try{
      const today=browserDate(),week=monday(today),month=firstMonth(today),toDate={y:+r.to.slice(0,4),m:+r.to.slice(5,7),d:+r.to.slice(8,10)},nextWeek=shift(week,7),nextMonth=month.m===12?{y:month.y+1,m:1,d:1}:{y:month.y,m:month.m+1,d:1};
      const queued=await post("/api/history/request",{accounts,fromTime:toStamp(r.from),toExclusive:toStamp(dateString(shift(toDate,1))),weekStart:toStamp(dateString(week)),weekEndExclusive:toStamp(dateString(nextWeek)),monthStart:toStamp(dateString(month)),monthEndExclusive:toStamp(dateString(nextMonth))});
      const reqs=queued.requests||[],deadline=Date.now()+18000;let results=[];
      while(Date.now()<deadline&&results.length<reqs.length){await new Promise(resolve=>setTimeout(resolve,700));const got=await post("/api/history/result",{requests:reqs});results=got.results||[];}
      const byKey=new Map(results.map(x=>[`${x.login}|${x.server}`,x]));
      profitRows=accounts.map(ac=>{const x=byKey.get(`${ac.login}|${ac.server}`);return x?x:{login:ac.login,server:ac.server,rangeProfit:0,weekProfit:0,monthProfit:0,allTimeProfit:0,historyPending:true};});
      if(results.length<reqs.length)$("notice").textContent="Some MT5 accounts did not respond to the live history request. Check that their EA is connected and the client session is active.";
    }finally{historyBusy=false;}
  }
  async function refresh(silent=false){if(busy||!accounts.length)return;busy=true;try{const r=await post("/api/snapshots",{accounts});snapshots=r.snapshots||[];setConnection(true);if(selectedRange!=="custom"){const d=rangeDates(selectedRange);updateDateInputs(d.from,d.to);}render();}catch(e){setConnection(false);if(!silent)$("notice").textContent=e.message;}finally{busy=false;}}
  async function session(path){if(!accounts.length)return;try{await post(path,{accounts})}catch{setConnection(false)}}
  function startViewer(){if(!accounts.length)return;session("/api/session/start");if(!heartbeat)heartbeat=setInterval(()=>session("/api/session/heartbeat"),15000);if(!poll)poll=setInterval(()=>refresh(true),2000);if(!historyPoll)historyPoll=setInterval(()=>{if(selectedRange==="today"&&document.visibilityState==="visible")loadProfit().then(render).catch(e=>{$("notice").textContent=e.message})},2000);refresh(true);loadProfit().then(render).catch(e=>{$("notice").textContent=e.message});}
  function stopViewer(){if(heartbeat){clearInterval(heartbeat);heartbeat=null}if(poll){clearInterval(poll);poll=null}if(historyPoll){clearInterval(historyPoll);historyPoll=null}if(accounts.length){const body=JSON.stringify({accounts});try{navigator.sendBeacon(WORKER_URL+"/api/session/end",new Blob([body],{type:"application/json"}))}catch{}}}
  document.querySelectorAll(".range-btn").forEach(b=>b.addEventListener("click",()=>applyPreset(b.dataset.range)));
  function customChanged(){const f=$("dateFrom").value,t=$("dateTo").value;if(!f||!t)return;if(f>t){$("notice").textContent="From date must be on or before To date.";return}selectedRange="custom";document.querySelectorAll(".range-btn").forEach(b=>b.classList.remove("active"));$("selectedProfitLabel").textContent="Selected Period Profit";$("selectedRangeHeading").textContent="SELECTED PERIOD";loadProfit().then(render).catch(e=>$("notice").textContent=e.message);}
  $("dateFrom").addEventListener("change",customChanged);$("dateTo").addEventListener("change",customChanged);
  $("addBtn").addEventListener("click",()=>$ ("addDialog").showModal());$("closeDialog").addEventListener("click",()=>$ ("addDialog").close());$("cancelBtn").addEventListener("click",()=>$ ("addDialog").close());
  $("addForm").addEventListener("submit",e=>{e.preventDefault();const login=$("loginInput").value.trim(),server=$("serverInput").value.trim(),keycode=$("keyInput").value.trim();if(!/^\d{6}$/.test(keycode))return;if(accounts.some(a=>a.login===login&&a.server===server))return;accounts.push({login,server,keycode});localStorage.setItem(STORAGE_KEY,JSON.stringify(accounts));$("addForm").reset();$("addDialog").close();startViewer();});
  $("accountsBody").addEventListener("click",e=>{const b=e.target.closest("[data-remove]");if(!b)return;accounts.splice(+b.dataset.remove,1);localStorage.setItem(STORAGE_KEY,JSON.stringify(accounts));profitRows=[];snapshots=[];render();});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")startViewer();else stopViewer()});window.addEventListener("pagehide",stopViewer);
  if(accounts.length){const today=browserDate();updateDateInputs(today,today);startViewer()}else{const d=new Date();updateDateInputs({y:d.getFullYear(),m:d.getMonth()+1,d:d.getDate()},{y:d.getFullYear(),m:d.getMonth()+1,d:d.getDate()});}
})();
