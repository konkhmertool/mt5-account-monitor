'use strict';
const API_BASE = 'https://monitor.mt5dashboard.workers.dev';
const ACCOUNTS_KEY = 'mab_kaakoo_paired_accounts_v1';
const LEGACY_SESSION_KEY = 'mab_kaakoo_client_session_v1';
const DEVICE_KEY = 'mab_kaakoo_device_id';
const $ = id => document.getElementById(id);
let savedAccounts = [];
let restoreFinished = false;

function readStoredAccounts() {
  let list = [];
  try {
    const raw = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    if (Array.isArray(raw)) list = raw.filter(x => x && x.token);
  } catch {}
  // Migrate the old single-session format without dropping it.
  const legacy = localStorage.getItem(LEGACY_SESSION_KEY);
  if (legacy && !list.some(x => x.token === legacy)) {
    list.push({token:legacy, alias:'', login:'', server:'', accountData:null});
  }
  return list;
}
function mergeAccounts(base, incoming) {
  const merged = [...base];
  for (const item of incoming) {
    const i = merged.findIndex(x =>
      (x.login && item.login && x.login === item.login && x.server === item.server) ||
      (x.token && item.token && x.token === item.token)
    );
    if (i >= 0) merged[i] = {...merged[i], ...item};
    else merged.push(item);
  }
  return merged;
}
function saveAccounts() {
  // Re-read storage immediately before writing, so a late restore or another
  // successful pairing cannot overwrite accounts already saved by this browser.
  const latest = readStoredAccounts();
  savedAccounts = mergeAccounts(latest, savedAccounts);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(savedAccounts));
  localStorage.removeItem(LEGACY_SESSION_KEY);
}
function getDeviceId() {
  let device = localStorage.getItem(DEVICE_KEY);
  if (!device) {
    device = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    localStorage.setItem(DEVICE_KEY, device);
  }
  return 'browser-' + device;
}
function openModal(){ $('addModal').classList.remove('hidden'); $('accountLogin').focus(); }
function closeModal(){ $('addModal').classList.add('hidden'); $('formMessage').textContent=''; $('addAccountForm').reset(); }
$('openAdd').addEventListener('click',openModal);
$('emptyAdd').addEventListener('click',openModal);
$('closeModal').addEventListener('click',closeModal);
$('cancelModal').addEventListener('click',closeModal);
$('addModal').addEventListener('click',e=>{if(e.target===$('addModal'))closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});

function setActivePeriod(button){
  document.querySelectorAll('.period').forEach(b=>b.classList.toggle('active',b===button));
  $('profitPeriodLabel').textContent='PROFIT · '+button.dataset.period.toUpperCase();
}
document.querySelectorAll('.period').forEach(b=>b.addEventListener('click',()=>setActivePeriod(b)));

function money(v,c=''){if(v===null||v===undefined||v==='')return '—';return Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+(c?' '+c:'');}
function api(path,options={}) {
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(options.auth)headers.Authorization='Bearer '+options.auth;
  return fetch(API_BASE+path,{...options,headers}).then(async r=>{
    let d={};try{d=await r.json()}catch{}
    if(!r.ok)throw new Error(d.error||'Request failed ('+r.status+')');
    return d;
  });
}
function makeCell(row,text,className='') {
  const td=document.createElement('td');td.textContent=text??'—';if(className)td.className=className;row.appendChild(td);return td;
}
function accountAliasCell(row,a) {
  const td=document.createElement('td');
  const main=document.createElement('span');main.className='account-main';main.textContent=a.alias||a.login||'MT5 Account';
  const sub=document.createElement('span');sub.className='account-sub';sub.textContent=`${a.login||''} · ${a.server||''}`;
  td.append(main,sub);row.appendChild(td);
}
function renderAccounts() {
  const valid=savedAccounts.filter(a=>a && a.token && a.accountData);
  $('accountCount').textContent=String(valid.length);
  if(!valid.length){$('accountsEmpty').classList.remove('hidden');$('accountsTableWrap').classList.add('hidden');}
  else{$('accountsEmpty').classList.add('hidden');$('accountsTableWrap').classList.remove('hidden');}
  $('accountRows').replaceChildren();$('profitRows').replaceChildren();
  let totals={balance:0,equity:0,floating:0,positions:0,online:0};
  const currencies=new Set();
  for(const a of valid){
    const d=a.accountData||{},c=d.currency||'';
    if(c)currencies.add(c);
    totals.balance+=Number(d.balance||0);totals.equity+=Number(d.equity||0);
    totals.floating+=Number(d.floating_profit||0);totals.positions+=Number(d.open_positions||0);
    const stamp=d.updated_at?new Date(String(d.updated_at).replace(' ','T')+'Z').getTime():0;
    const online=stamp && Date.now()-stamp<120000;
    if(online)totals.online++;
    const tr=document.createElement('tr');accountAliasCell(tr,a);
    makeCell(tr,money(d.balance,c));makeCell(tr,money(d.equity,c));
    makeCell(tr,'—');makeCell(tr,'—');makeCell(tr,'—');makeCell(tr,'—');
    makeCell(tr,money(d.floating_profit,c),Number(d.floating_profit)>0?'positive':Number(d.floating_profit)<0?'negative':'');
    const status=document.createElement('td');status.innerHTML=online?'<span class="online">● Online</span>':'<span class="offline">● Offline</span>';tr.appendChild(status);
    $('accountRows').appendChild(tr);
    const pr=document.createElement('tr');accountAliasCell(pr,a);
    for(let i=0;i<4;i++)makeCell(pr,'—');
    makeCell(pr,money(d.floating_profit,c));$('profitRows').appendChild(pr);
  }
  const currency=currencies.size===1?[...currencies][0]:(currencies.size>1?'Mixed':'');
  $('totalBalance').textContent=valid.length?money(totals.balance,currency):'—';
  $('totalEquity').textContent=valid.length?money(totals.equity,currency):'—';
  $('totalFloating').textContent=valid.length?money(totals.floating,currency):'—';
  $('profitFloating').textContent=valid.length?money(totals.floating,currency):'—';
  $('totalPositions').textContent=String(totals.positions);
  $('onlineCount').textContent=`${totals.online}/${valid.length} accounts online`;
  $('onlineSummary').textContent=valid.length?`${totals.online} account${totals.online===1?'':'s'} online`:'All accounts online';
  $('openPositionCount').textContent=String(totals.positions);
  $('positionRows').innerHTML='<tr><td colspan="11" class="empty-row">No open positions.</td></tr>';
}
async function fetchAccount(entry) {
  const result=await api('/api/client/account',{method:'GET',auth:entry.token});
  entry.accountData=result.account||{};
  entry.login=entry.accountData.account_login||entry.login;
  entry.server=entry.accountData.broker_server||entry.server;
  if(!entry.alias || entry.alias==='MT5 Account')entry.alias=entry.login||'MT5 Account';
  return entry;
}
async function restoreAccounts() {
  $('systemStatus').textContent='Loading';
  const initial=readStoredAccounts();
  const restored=[];
  for(const entry of initial) {
    try { restored.push(await fetchAccount({...entry})); }
    catch(err) {
      // Keep temporarily unavailable sessions; never silently delete an account.
      restored.push(entry);
    }
  }
  savedAccounts=mergeAccounts(readStoredAccounts(),restored);
  saveAccounts();
  renderAccounts();
  restoreFinished=true;
  $('systemStatus').textContent='Ready';
  if(savedAccounts.length)$('profitScope').textContent='all accounts';
}
$('addAccountForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('loginButton'),msg=$('formMessage');
  btn.disabled=true;btn.textContent='Connecting…';msg.textContent='Checking pairing code…';msg.className='form-message';
  const login=$('accountLogin').value.trim(),server=$('accountServer').value.trim(),code=$('accountCode').value.trim(),alias=$('accountAlias').value.trim();
  try{
    const result=await api('/api/client/pair',{method:'POST',body:JSON.stringify({login,server,pairingCode:code,deviceId:getDeviceId()})});
    const entry={token:result.token,alias,login,server,accountData:null};
    await fetchAccount(entry);
    // Merge with current browser storage before adding, preserving every existing account.
    savedAccounts=mergeAccounts(readStoredAccounts(),savedAccounts);
    savedAccounts=mergeAccounts(savedAccounts,[entry]);
    saveAccounts();
    renderAccounts();
    closeModal();
    $('systemStatus').textContent='Ready';
  }catch(err){msg.textContent=err.message||'Unable to pair account.';}
  finally{btn.disabled=false;btn.textContent='Login';}
});
$('symbolFilter').addEventListener('input',()=>{});
$('dateFrom').value=new Date().toISOString().slice(0,10);
$('dateTo').value=new Date().toISOString().slice(0,10);
restoreAccounts();
