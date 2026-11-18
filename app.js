
'use strict';
const API_BASE='https://monitor.mt5dashboard.workers.dev';
const ACCOUNTS_KEY='mab_kaakoo_paired_accounts_v1';
const LEGACY_KEY='mab_kaakoo_client_session_v1';
const DEVICE_KEY='mab_kaakoo_device_id';
const $=id=>document.getElementById(id);
let accounts=[],selectedAccountKey=null,period='today',fromDate='',toDate='';

const BACKUP_KEY='mab_kaakoo_paired_accounts_backup_v1';
const KNOWN_ACCOUNT_KEYS=[ACCOUNTS_KEY,BACKUP_KEY,'mab_kaakoo_accounts_v1','mab_kaakoo_accounts','mt5_monitor_accounts','mt5Accounts'];

function parseAccountList(raw){
  try{
    const x=JSON.parse(raw||'[]');
    return Array.isArray(x)?x.filter(v=>v&&typeof v==='object'&&v.token):[];
  }catch{return []}
}

function readSaved(){
  let saved=[];
  for(const k of KNOWN_ACCOUNT_KEYS){
    saved=merge(saved,parseAccountList(localStorage.getItem(k)));
  }
  const old=localStorage.getItem(LEGACY_KEY);
  if(old&&!saved.some(v=>v.token===old)){
    saved.push({token:old,alias:'',login:'',server:''});
  }
  return saved;
}

function merge(a,b){
  const out=[...a];
  for(const n of b){
    const i=out.findIndex(x=>
      (x.token&&n.token&&x.token===n.token)||
      (x.login&&n.login&&x.login===n.login&&x.server===n.server)
    );
    if(i<0)out.push(n);
    else out[i]={...out[i],...n};
  }
  return out;
}

function save(){
  // Persist the current list exactly as-is.
  // Do not merge old storage here, or removed accounts may return.
  const unique=[];
  for(const a of accounts){
    if(!a||!a.token)continue;
    const i=unique.findIndex(x=>
      x.token===a.token||
      (x.login&&a.login&&x.login===a.login&&x.server===a.server)
    );
    if(i<0)unique.push(a);
    else unique[i]={...unique[i],...a};
  }
  accounts=unique;
  const payload=JSON.stringify(accounts);

  // Keep recognized storage keys synchronized.
  for(const storageKey of KNOWN_ACCOUNT_KEYS){
    localStorage.setItem(storageKey,payload);
  }
  localStorage.removeItem(LEGACY_KEY);
}

function key(a){return a.login+'|'+a.server}
function currency(a){return a.accountData?.currency||''}

// Keep Cent currency above standard USD wherever currencies are grouped.
function sortCurrencyTotals(entries){
  const priority={USC:0,USD:1};
  return [...entries].sort((a,b)=>{
    const pa=priority[a[0]]??2, pb=priority[b[0]]??2;
    return pa-pb || a[0].localeCompare(b[0]);
  });
}

function profitMoney(v,c=''){
  if(v===null||v===undefined||v===''||!Number.isFinite(Number(v)))return '—';
  const n=Number(v);
  return (n>0?'+':'')+money(n,c);
}

function money(v,c=''){
  if(v===null||v===undefined||v===''||!Number.isFinite(Number(v)))return '—';
  return Number(v).toLocaleString(undefined,{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  })+(c?' '+c:'');
}

function groupedTotals(list, field){
  const totals=new Map();
  for(const a of list){
    const code=currency(a)||'Unknown';
    const n=Number(val(a,field));
    if(!Number.isFinite(n))continue;
    totals.set(code,(totals.get(code)||0)+n);
  }
  return sortCurrencyTotals(totals.entries());
}

function renderGroupedMoney(el, list, field, {signColor=false}={}){
  el.replaceChildren();
  const totals=groupedTotals(list,field);
  if(!totals.length){el.textContent='—';return;}
  for(const [ccy,total] of totals){
    const line=document.createElement('span');
    line.className='currency-total'+(signColor?(total>0?' positive':total<0?' negative':' neutral'):'');
    line.textContent=signColor?profitMoney(total,ccy==='Unknown'?'':ccy):money(total,ccy==='Unknown'?'':ccy);
    el.append(line);
  }
}

function val(a,k){return a.accountData?.[k]}
function closedProfit(a){const raw=val(a,'closed_profit_json');if(raw&&typeof raw==='object')return raw;try{return JSON.parse(raw||'{}')}catch{return {}}}
function profitFor(a,k){const h=closedProfit(a);if(k==='custom')return h.customFrom===fromDate&&h.customTo===toDate?Number(h.custom):NaN;return h[k]===undefined?NaN:Number(h[k])}
function renderProfitValues(el,list,getter){el.replaceChildren();const totals=new Map();for(const a of list){const c=currency(a)||'Unknown',n=Number(getter(a));if(Number.isFinite(n))totals.set(c,(totals.get(c)||0)+n)}if(!totals.size){el.textContent='—';return}for(const [c,n] of sortCurrencyTotals(totals.entries())){const span=document.createElement('span');span.className='currency-total'+(n>0?' positive':n<0?' negative':' neutral');span.textContent=profitMoney(n,c==='Unknown'?'':c);el.append(span)}}

function parseServerTime(value){
  if(!value)return NaN;
  const text=String(value).trim();
  // D1 CURRENT_TIMESTAMP is UTC in "YYYY-MM-DD HH:mm:ss" format.
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? text.replace(' ','T')+'Z'
    : text;
  const ms=Date.parse(normalized);
  return Number.isFinite(ms)?ms:NaN;
}

function isOnline(a){
  // Liveness comes from the EA heartbeat, not from the last full snapshot.
  const ms=parseServerTime(val(a,'last_seen'));
  return Number.isFinite(ms)&&Date.now()-ms>=-30000&&Date.now()-ms<120000;
}

async function api(path,opt={}){
  const h={'Content-Type':'application/json',...(opt.headers||{})};
  if(opt.auth)h.Authorization='Bearer '+opt.auth;
  const r=await fetch(API_BASE+path,{...opt,headers:h});
  let d={};
  try{d=await r.json()}catch{}
  if(!r.ok)throw Error(d.error||'Request failed '+r.status);
  return d;
}

function accountData(a){return a.accountData||{}}

function allPositions(){
  const rows=[];
  for(const a of accounts){
    let raw=val(a,'positions_json'),ps=[];
    try{
      ps=typeof raw==='string'?JSON.parse(raw||'[]'):(Array.isArray(raw)?raw:[]);
    }catch{}
    for(const p of ps)rows.push({...p,_account:a});
  }
  return rows;
}

function getPeriodDates(p){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Phnom_Penh',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).format(new Date()).split('-').map(Number);

  const today=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
  const iso=d=>d.toISOString().slice(0,10);
  const dow=(today.getUTCDay()+6)%7;
  let s=new Date(today),e=new Date(today);

  if(p==='yesterday'){
    s.setUTCDate(s.getUTCDate()-1);
    e=new Date(s);
  }
  if(p==='this_week')s.setUTCDate(s.getUTCDate()-dow);
  if(p==='last_week'){
    s.setUTCDate(s.getUTCDate()-dow-7);
    e=new Date(s);
    e.setUTCDate(e.getUTCDate()+6);
  }
  if(p==='this_month')s.setUTCDate(1);
  if(p==='last_month'){
    s.setUTCDate(1);
    s.setUTCMonth(s.getUTCMonth()-1);
    e=new Date(s);
    e.setUTCMonth(e.getUTCMonth()+1);
    e.setUTCDate(0);
  }
  return [iso(s),iso(e)];
}

function selectedProfitKey(){
  return period==='custom'?'custom':
    period==='this_week'?'thisWeek':
    period==='last_week'?'lastWeek':
    period==='this_month'?'thisMonth':
    period==='last_month'?'lastMonth':period;
}

function selectedPeriodColumnLabel(){
  const labels={today:'Today',yesterday:'Yesterday',this_week:'This Week',last_week:'Last Week',this_month:'This Month',last_month:'Last Month'};
  if(period!=='custom')return labels[period]||'Today';
  const fmt=ymd=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(new Date(ymd+'T00:00:00Z'));
  return fromDate===toDate?fmt(fromDate):`${fmt(fromDate)} – ${fmt(toDate)}`;
}

let quickPeriodRefreshTimer=null;
async function refreshAfterPeriodChange(){
  await requestLiveSnapshots();
  if(quickPeriodRefreshTimer)clearInterval(quickPeriodRefreshTimer);
  let attempts=0;
  quickPeriodRefreshTimer=setInterval(async()=>{
    if(document.visibilityState!=='visible'){
      clearInterval(quickPeriodRefreshTimer);quickPeriodRefreshTimer=null;return;
    }
    await refreshVisibleAccounts();
    attempts++;
    if(attempts>=8){clearInterval(quickPeriodRefreshTimer);quickPeriodRefreshTimer=null;}
  },1000);
}

function setPeriod(p){
  period=p;
  document.querySelectorAll('.period').forEach(b=>
    b.classList.toggle('active',b.dataset.period===p)
  );
  [fromDate,toDate]=getPeriodDates(p);
  $('dateFrom').value=fromDate;
  $('dateTo').value=toDate;
  $('profitPeriodLabel').textContent='PROFIT · '+p.replace('_',' ').toUpperCase();
  render();
  refreshAfterPeriodChange();
}

function dateChanged(){
  fromDate=$('dateFrom').value;
  toDate=$('dateTo').value;
  document.querySelectorAll('.period').forEach(b=>b.classList.remove('active'));
  period='custom';
  $('profitPeriodLabel').textContent='PROFIT · SELECTED DATES';
  render();
  refreshAfterPeriodChange();
}

function addCell(tr,text,cls=''){
  const td=document.createElement('td');
  td.textContent=text??'—';
  if(cls)td.className=cls;
  tr.appendChild(td);
  return td;
}

function nameCell(tr,a,index,on){
  const td=document.createElement('td');
  const wrap=document.createElement('div');
  wrap.className='account-name-wrap';
  const order=document.createElement('span');
  order.className='account-order';
  order.textContent=String(index);
  const dot=document.createElement('span');
  dot.className='account-status-dot '+(on?'online':'offline');
  dot.setAttribute('aria-label',on?'Online':'Offline');
  const text=document.createElement('div');
  const b=document.createElement('span');
  b.className='account-main';
  b.textContent=a.alias||a.login||'MT5 account';
  const sub=document.createElement('span');
  sub.className='account-sub';
  sub.textContent=(a.login||'')+' · '+(a.server||'');
  text.append(b,sub);
  wrap.append(order,dot,text);
  td.append(wrap);
  tr.appendChild(td);
  return td;
}

function render(){
  const usable=accounts;
  const selected=usable.find(a=>key(a)===selectedAccountKey)||null;

  $('profitScope').textContent=selected?(selected.alias||selected.login):'all accounts';
  const sumByCurrency=(field)=>groupedTotals(usable,field);
  const pos=allPositions();
  const selectedHistoryKey=selectedProfitKey();
  renderProfitValues($('profitSelected'),selected?[selected]:usable,a=>profitFor(a,selectedHistoryKey));
  renderProfitValues($('profitWeek'),selected?[selected]:usable,a=>profitFor(a,'thisWeek'));
  renderProfitValues($('profitMonth'),selected?[selected]:usable,a=>profitFor(a,'thisMonth'));
  renderProfitValues($('profitAll'),selected?[selected]:usable,a=>profitFor(a,'allTime'));
  $('profitSelectedNote').textContent=period==='custom'?`Closed trading P/L · ${fromDate} to ${toDate} (Cambodia time)`:'Closed trading P/L · Cambodia time';

  renderGroupedMoney($('profitFloating'),selected?[selected]:usable,'floating_profit',{signColor:true});
  renderGroupedMoney($('totalBalance'),usable,'balance');
  renderGroupedMoney($('totalEquity'),usable,'equity');
  renderGroupedMoney($('totalFloating'),usable,'floating_profit',{signColor:true});
  $('totalMargin').textContent='—';
  $('totalFreeMargin').textContent='—';
  $('totalPositions').textContent=String(pos.length);
  $('openPositionCount').textContent=String(pos.length);

  const online=usable.filter(isOnline).length;
  $('onlineCount').textContent=`${online}/${usable.length} accounts online`;
  $('onlineSummary').textContent=usable.length?
    `${online} account${online===1?'':'s'} online`:
    'All accounts offline';
  $('accountCount').textContent=String(usable.length);
  $('accountsEmpty').classList.toggle('hidden',usable.length>0);
  $('accountRows').replaceChildren();
  $('accountCards').replaceChildren();
  const accountTable=$('accountRows').closest('table');
  const accountHeaderRow=accountTable.querySelector('thead tr');
  if(accountHeaderRow && accountHeaderRow.children.length>=6){
    accountHeaderRow.children[1].textContent=selectedPeriodColumnLabel();
  }
  let footer=accountTable.querySelector('tfoot#accountFooter');
  if(!footer){
    footer=document.createElement('tfoot');
    footer.id='accountFooter';
    accountTable.append(footer);
  }
  footer.replaceChildren();

  if(!usable.length){
    $('accountRows').innerHTML='<tr><td colspan="6" class="empty-row">Add an account to see its information here.</td></tr>';
  }

  usable.forEach((a,index)=>{
    const d=accountData(a),cc=currency(a),on=isOnline(a),tr=document.createElement('tr');

    if(selectedAccountKey===key(a))tr.classList.add('selected');
    nameCell(tr,a,index+1,on);
    const selectedProfit=profitFor(a,selectedHistoryKey);
    addCell(tr,Number.isFinite(selectedProfit)?profitMoney(selectedProfit,cc):'—',selectedProfit>0?'positive':selectedProfit<0?'negative':'neutral');
    for(const k of ['thisWeek','thisMonth','allTime']){const n=profitFor(a,k);addCell(tr,profitMoney(n,cc),n>0?'positive':n<0?'negative':'neutral');}
    addCell(tr,profitMoney(d.floating_profit,cc),Number(d.floating_profit)>0?'positive':Number(d.floating_profit)<0?'negative':'neutral');
    tr.addEventListener('click',()=>selectAccount(a));
    $('accountRows').appendChild(tr);

    const card=document.createElement('article');
    card.className='account-card'+(selectedAccountKey===key(a)?' selected':'');
    card.tabIndex=0;

    const head=document.createElement('div');
    head.className='account-card-head';

    const title=document.createElement('div');
    title.innerHTML='<div class="account-card-title"></div><div class="account-card-sub"></div>';
    title.querySelector('.account-card-title').textContent=a.alias||a.login;
    title.querySelector('.account-card-sub').textContent=`${a.login} · ${a.server}`;

    const actions=document.createElement('div');
    actions.className='account-card-actions';

    // EDIT: change alias only. Account credentials remain unchanged.
    const editBtn=document.createElement('button');
    editBtn.type='button';
    editBtn.className='account-action edit-account';
    editBtn.textContent='Edit';
    editBtn.title='Edit account alias';
    editBtn.addEventListener('click',e=>{
      e.stopPropagation();
      const next=window.prompt('Edit account alias:',a.alias||a.login||'');
      if(next===null)return;
      a.alias=next.trim();
      save();
      render();
    });

    // REMOVE: remove this account from this browser after confirmation.
    const removeBtn=document.createElement('button');
    removeBtn.type='button';
    removeBtn.className='account-action remove-account';
    removeBtn.textContent='Remove';
    removeBtn.title='Remove this account';
    removeBtn.addEventListener('click',e=>{
      e.stopPropagation();
      if(!window.confirm(`Remove account ${a.alias||a.login} (${a.login} · ${a.server}) from this browser?`))return;

      accounts=accounts.filter(x=>
        x.token!==a.token&&!(x.login===a.login&&x.server===a.server)
      );
      if(selectedAccountKey===key(a))selectedAccountKey=null;
      save();
      render();
    });

    const pill=document.createElement('span');
    pill.className='status-pill';
    pill.textContent=on?'ONLINE':'OFFLINE';

    actions.append(editBtn,removeBtn,pill);
    head.append(title,actions);
    card.append(head);

    const metrics=document.createElement('div');
    metrics.className='account-metrics';

    const metric=(label,value,numberValue=null)=>{
      const el=document.createElement('div');
      el.className='metric';
      const l=document.createElement('span');
      l.textContent=label;
      const b=document.createElement('b');
      b.textContent=value;
      if(numberValue!==null)b.classList.add(numberValue>0?'positive':numberValue<0?'negative':'neutral');
      el.append(l,b);
      metrics.append(el);
    };

    metric('Balance',money(d.balance,cc),Number(d.balance)||0);
    metric('Equity',money(d.equity,cc),Number(d.equity)||0);
    metric('Margin','—');
    metric('Free margin','—');
    metric('Floating P/L',profitMoney(d.floating_profit,cc),Number(d.floating_profit)||0);
    metric('Margin level','—');
    metric('Open positions',String(d.open_positions??0));
    metric('Symbol',d.symbol||'—');
    card.append(metrics);

    const foot=document.createElement('div');
    foot.className='account-card-foot';
    const last=document.createElement('span');
    last.textContent='Last update: '+(d.updated_at||'—');
    const view=document.createElement('span');
    view.textContent='View positions →';
    foot.append(last,view);
    card.append(foot);

    card.addEventListener('click',()=>selectAccount(a));
    card.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        selectAccount(a);
      }
    });
    $('accountCards').append(card);
  });

  // Exactly one footer row. Currency totals are grouped in each cell, never
  // added across USD and USC because they are different denominations.
  if(usable.length){
    const ftr=document.createElement('tr');
    ftr.className='account-total-row';
    const label=addCell(ftr,`TOTAL · ${usable.length} ACCOUNT${usable.length===1?'':'S'}`);
    label.className='account-total-label';
    const appendTotals=(field)=>{
      const td=document.createElement('td');
      td.className='account-total-values';
      const values=groupedTotals(usable,field);
      if(!values.length){td.textContent='—';}
      for(const [ccy,total] of values){
        const line=document.createElement('span');
        line.className='currency-total'+(total>0?' positive':total<0?' negative':' neutral');
        line.textContent=profitMoney(total,ccy==='Unknown'?'':ccy);
        td.append(line);
      }
      ftr.append(td);
    };
    const appendProfitTotals=(field)=>{const td=document.createElement('td');td.className='account-total-values';const totals=new Map();for(const a of usable){const c=currency(a)||'Unknown',n=profitFor(a,field);if(Number.isFinite(n))totals.set(c,(totals.get(c)||0)+n)}if(!totals.size)td.textContent='—';for(const [c,n] of sortCurrencyTotals(totals.entries())){const span=document.createElement('span');span.className='currency-total'+(n>0?' positive':n<0?' negative':' neutral');span.textContent=profitMoney(n,c==='Unknown'?'':c);td.append(span)}ftr.append(td)};
    appendProfitTotals(selectedHistoryKey);
    ['thisWeek','thisMonth','allTime'].forEach(appendProfitTotals);
    appendTotals('floating_profit');
    footer.append(ftr);
  }

  $('selectionHint').textContent=selected?
    `Showing positions for ${selected.alias||selected.login}`:
    'Select an account to filter positions';
  $('clearAccountFilter').classList.toggle('hidden',!selected);

  let filtered=pos.filter(p=>!selected||key(p._account)===selectedAccountKey);
  const q=$('symbolFilter').value.trim().toLowerCase();
  if(q)filtered=filtered.filter(p=>String(p.symbol||'').toLowerCase().includes(q));

  $('positionRows').replaceChildren();
  if(!filtered.length){
    $('positionRows').innerHTML='<tr><td colspan="11" class="empty-row">No open positions.</td></tr>';
  }

  for(const p of filtered){
    const tr=document.createElement('tr');
    const a=p._account;
    addCell(tr,a.alias||a.login);
    addCell(tr,p.ticket);
    addCell(tr,p.symbol);
    addCell(tr,p.type,p.type==='BUY'?'type-buy':'type-sell');
    addCell(tr,p.volume);
    addCell(tr,p.open_price??'—');
    addCell(tr,p.current_price??'—');
    addCell(tr,p.sl??'—');
    addCell(tr,p.tp??'—');
    addCell(tr,money(p.swap,currency(a)));
    addCell(tr,money(p.profit,currency(a)),Number(p.profit)<0?'negative':'positive');
    $('positionRows').append(tr);
  }

  // Footer totals follow the currently visible positions (account and symbol filters).
  const positionTable=$('positionRows').closest('table');
  let positionFooter=positionTable.querySelector('tfoot#positionFooter');
  if(!positionFooter){
    positionFooter=document.createElement('tfoot');
    positionFooter.id='positionFooter';
    positionTable.append(positionFooter);
  }
  positionFooter.replaceChildren();
  if(filtered.length){
    const totalsRow=document.createElement('tr');
    totalsRow.className='positions-total-row';
    const label=addCell(totalsRow,`TOTAL · ${filtered.length} POSITION${filtered.length===1?'':'S'}`);
    label.className='positions-total-label';
    // Ticket, symbol and type have no meaningful aggregate.
    for(let i=0;i<3;i++)addCell(totalsRow,'');
    const totalVolume=filtered.reduce((sum,p)=>sum+(Number(p.volume)||0),0);
    const volumeCell=addCell(totalsRow,totalVolume.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}));
    volumeCell.className='positions-total-values';
    for(let i=0;i<4;i++)addCell(totalsRow,'');
    const appendPositionCurrencyTotal=(field)=>{
      const td=document.createElement('td');
      td.className='positions-total-values';
      const totals=new Map();
      for(const p of filtered){
        const c=currency(p._account)||'Unknown';
        const n=Number(p[field]);
        if(Number.isFinite(n))totals.set(c,(totals.get(c)||0)+n);
      }
      if(!totals.size)td.textContent='—';
      for(const [ccy,total] of sortCurrencyTotals(totals.entries())){
        const line=document.createElement('span');
        line.className='currency-total'+(total>0?' positive':total<0?' negative':' neutral');
        line.textContent=profitMoney(total,ccy==='Unknown'?'':ccy);
        td.append(line);
      }
      totalsRow.append(td);
    };
    appendPositionCurrencyTotal('swap');
    appendPositionCurrencyTotal('profit');
    positionFooter.append(totalsRow);
  }
}

function selectAccount(a){
  selectedAccountKey=selectedAccountKey===key(a)?null:key(a);
  render();
}

async function fetchAccount(a){
  const r=await api('/api/client/account',{auth:a.token});
  if(r.account){
    a.accountData={...(a.accountData||{}),...r.account};
  }
  a.login=a.accountData?.account_login||a.login||r.account?.login;
  a.server=a.accountData?.broker_server||a.server||r.account?.server;
  if(!a.alias)a.alias=a.login;
  a.lastFetchError='';
  return a;
}

async function restore(){
  $('systemStatus').textContent='Restoring';
  const saved=readSaved();
  accounts=merge(accounts,saved);
  render();

  const refreshed=[];
  for(const a of saved){
    try{
      refreshed.push(await fetchAccount({...a}));
    }catch(err){
      refreshed.push({...a,lastFetchError:err.message||'Unable to refresh account'});
    }
  }

  accounts=merge(saved,refreshed);
  try{
    save();
  }catch(err){
    console.error('Account storage failed:',err);
    $('systemStatus').textContent='Storage error';
  }
  render();
  $('systemStatus').textContent='Ready';
}

// A visible dashboard requests fresh MT5 snapshots. The Worker combines all
// browser sessions into one account-level request, so multiple tabs/devices do
// not create duplicate position uploads.
let liveRefreshBusy=false;
async function requestLiveSnapshots(){
  if(document.visibilityState!=='visible'||!accounts.length)return;
  for(const a of accounts){
    try{await api('/api/client/active',{method:'POST',auth:a.token,body:JSON.stringify({dateFrom:fromDate,dateTo:toDate})});}
    catch(err){a.activityError=err.message||'Activity request failed';}
  }
}

// Read snapshots frequently enough to show the next EA upload without relying
// on a page reload. Heartbeat-based online status remains independent of this.
async function refreshVisibleAccounts(){
  if(document.visibilityState!=='visible'||liveRefreshBusy||!accounts.length)return;
  liveRefreshBusy=true;
  try{
    for(const a of accounts){
      try{await fetchAccount(a);}
      catch(err){a.lastFetchError=err.message||'Unable to refresh account';}
    }
    render();
  }finally{liveRefreshBusy=false;}
}

function startLiveDashboard(){
  const activate=()=>{
    if(document.visibilityState!=='visible')return;
    requestLiveSnapshots();
    refreshVisibleAccounts();
  };
  document.addEventListener('visibilitychange',activate);
  activate();
  // Dashboard activity heartbeat: 15 seconds while visible only.
  setInterval(()=>{
    if(document.visibilityState==='visible')requestLiveSnapshots();
  },15000);
  // Poll snapshots/heartbeats so positions and online dots update automatically.
  setInterval(()=>{
    if(document.visibilityState==='visible')refreshVisibleAccounts();
  },5000);
}

function deviceId(){
  let v=localStorage.getItem(DEVICE_KEY);
  if(!v){
    v=crypto.randomUUID?crypto.randomUUID():String(Date.now());
    localStorage.setItem(DEVICE_KEY,v);
  }
  return 'browser-'+v;
}

function addAccountActionStyles(){
  if($('accountActionStyles'))return;
  const style=document.createElement('style');
  style.id='accountActionStyles';
  style.textContent=`
    .account-card-head{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:10px
    }
    .account-card-actions{
      display:flex;
      align-items:center;
      gap:6px;
      flex-shrink:0
    }
    .account-action{
      border:1px solid #2a394a;
      background:#1b2633;
      color:#a9c7e8;
      border-radius:6px;
      padding:4px 8px;
      font:inherit;
      font-size:11px;
      line-height:1.3;
      cursor:pointer
    }
    .account-action:hover{
      border-color:#f3bd3e;
      color:#f3bd3e
    }
    .account-action.remove-account{
      color:#ff8585;
      border-color:#56343a
    }
    .account-action.remove-account:hover{
      background:#3a2026;
      border-color:#ff8585;
      color:#ffaaaa
    }
  `;
  document.head.appendChild(style);
}

function openModal(){
  $('addModal').classList.remove('hidden');
  $('accountLogin').focus();
}

function closeModal(){
  $('addModal').classList.add('hidden');
  $('formMessage').textContent='';
  $('addAccountForm').reset();
}

$('openAdd').addEventListener('click',openModal);
$('emptyAdd').addEventListener('click',openModal);
$('closeModal').addEventListener('click',closeModal);
$('cancelModal').addEventListener('click',closeModal);
$('addModal').addEventListener('click',e=>{
  if(e.target===$('addModal'))closeModal();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();
});

document.querySelectorAll('.period').forEach(b=>
  b.addEventListener('click',()=>setPeriod(b.dataset.period))
);
$('dateFrom').addEventListener('change',dateChanged);
$('dateTo').addEventListener('change',dateChanged);
$('symbolFilter').addEventListener('input',render);
$('clearAccountFilter').addEventListener('click',()=>{
  selectedAccountKey=null;
  render();
});

$('addAccountForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('loginButton'),msg=$('formMessage');
  btn.disabled=true;
  btn.textContent='Connecting…';
  msg.textContent='Checking pairing code…';

  const login=$('accountLogin').value.trim();
  const server=$('accountServer').value.trim();
  const pairingCode=$('accountCode').value.trim();
  const alias=$('accountAlias').value.trim();

  try{
    const r=await api('/api/client/pair',{
      method:'POST',
      body:JSON.stringify({login,server,pairingCode,deviceId:deviceId()})
    });

    const paired={token:r.token,login,server,alias,accountData:null};
    accounts=merge(readSaved(),accounts);
    accounts=merge(accounts,[paired]);
    save();
    render();

    msg.textContent='Pairing saved. Loading account data…';
    const a=await fetchAccount(paired);
    accounts=merge(accounts,[a]);
    save();
    selectedAccountKey=null;
    render();
    closeModal();
  }catch(err){
    msg.textContent=err.message||'Unable to pair account';
  }finally{
    btn.disabled=false;
    btn.textContent='Login';
  }
});

addAccountActionStyles();
setPeriod('today');
restore().then(startLiveDashboard);
