
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

function money(v,c=''){
  if(v===null||v===undefined||v===''||!Number.isFinite(Number(v)))return '—';
  return Number(v).toLocaleString(undefined,{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  })+(c?' '+c:'');
}

function val(a,k){return a.accountData?.[k]}

function isOnline(a){
  const t=val(a,'updated_at');
  if(!t)return false;
  const ms=new Date(String(t).replace(' ','T')+'Z').getTime();
  return Number.isFinite(ms)&&Date.now()-ms<120000;
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
}

function dateChanged(){
  fromDate=$('dateFrom').value;
  toDate=$('dateTo').value;
  document.querySelectorAll('.period').forEach(b=>b.classList.remove('active'));
  $('profitPeriodLabel').textContent='PROFIT · SELECTED DATES';
  render();
}

function addCell(tr,text,cls=''){
  const td=document.createElement('td');
  td.textContent=text??'—';
  if(cls)td.className=cls;
  tr.appendChild(td);
  return td;
}

function nameCell(tr,a){
  const td=document.createElement('td');
  const b=document.createElement('span');
  b.className='account-main';
  b.textContent=a.alias||a.login||'MT5 account';
  const s=document.createElement('span');
  s.className='account-sub';
  s.textContent=(a.login||'')+' · '+(a.server||'');
  td.append(b,s);
  tr.appendChild(td);
}

function render(){
  const usable=accounts;
  const selected=usable.find(a=>key(a)===selectedAccountKey)||null;

  $('profitScope').textContent=selected?(selected.alias||selected.login):'all accounts';
  const ccy=[...new Set(usable.map(currency).filter(Boolean))];
  const c=ccy.length===1?ccy[0]:(ccy.length?'Mixed':'');
  const sum=k=>usable.reduce((n,a)=>n+Number(val(a,k)||0),0);
  const bal=sum('balance'),eq=sum('equity'),fl=sum('floating_profit'),pos=allPositions();
  const closedAvailable=usable.some(a=>
    val(a,'today_closed_profit')!==null&&val(a,'today_closed_profit')!==undefined
  );

  // Historical closed-profit data is not supplied by the current Monitor EA.
  $('profitSelected').textContent='—';
  $('profitWeek').textContent='—';
  $('profitMonth').textContent='—';
  $('profitAll').textContent='—';
  $('profitSelectedNote').textContent=closedAvailable?
    'Historical totals require MT5 history sync':
    'Closed-trade history not yet supplied by Monitor EA';

  $('profitFloating').textContent=money(
    selected?val(selected,'floating_profit'):fl,
    selected?currency(selected):c
  );
  $('totalBalance').textContent=money(bal,c);
  $('totalEquity').textContent=money(eq,c);
  $('totalFloating').textContent=money(fl,c);
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

  if(!usable.length){
    $('accountRows').innerHTML='<tr><td colspan="9" class="empty-row">Add an account to see its information here.</td></tr>';
  }

  for(const a of usable){
    const d=accountData(a),cc=currency(a),on=isOnline(a),tr=document.createElement('tr');

    if(selectedAccountKey===key(a))tr.classList.add('selected');
    nameCell(tr,a);
    addCell(tr,money(d.balance,cc));
    addCell(tr,money(d.equity,cc));
    addCell(tr,'—');
    addCell(tr,'—');
    addCell(tr,'—');
    addCell(tr,'—');
    addCell(tr,money(d.floating_profit,cc),Number(d.floating_profit)<0?'negative':'positive');
    addCell(tr,on?'● Online':'● Offline',on?'online':'offline');
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

    const metric=(label,value)=>{
      const el=document.createElement('div');
      el.className='metric';
      const l=document.createElement('span');
      l.textContent=label;
      const b=document.createElement('b');
      b.textContent=value;
      el.append(l,b);
      metrics.append(el);
    };

    metric('Balance',money(d.balance,cc));
    metric('Equity',money(d.equity,cc));
    metric('Margin','—');
    metric('Free margin','—');
    metric('Floating P/L',money(d.floating_profit,cc));
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
restore();
