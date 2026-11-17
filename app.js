'use strict';
const API_BASE = 'https://monitor.mt5dashboard.workers.dev';
const ACCOUNTS_KEY = 'mab_kaakoo_paired_accounts_v1';
const LEGACY_SESSION_KEY = 'mab_kaakoo_client_session_v1';
const $ = id => document.getElementById(id);
let savedAccounts = loadSavedAccounts();

function loadSavedAccounts() {
  try {
    const list = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    if (Array.isArray(list)) return list.filter(x => x && x.token && x.login && x.server);
  } catch {}
  const legacy = localStorage.getItem(LEGACY_SESSION_KEY);
  return legacy ? [{token:legacy, alias:'MT5 Account', login:'', server:''}] : [];
}
function saveAccounts() {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(savedAccounts));
  localStorage.removeItem(LEGACY_SESSION_KEY);
}
function openModal(){ $('addModal').classList.remove('hidden'); $('accountLogin').focus(); }
function closeModal(){ $('addModal').classList.add('hidden'); $('formMessage').textContent=''; $('addAccountForm').reset(); }
$('openAdd').addEventListener('click',openModal);
$('emptyAdd').addEventListener('click',openModal);
$('closeModal').addEventListener('click',closeModal);
$('cancelModal').addEventListener('click',closeModal);
$('addModal').addEventListener('click',e=>{if(e.target===$('addModal'))closeModal();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
$('togglePin').addEventListener('click',()=>{const x=$('accountCode');x.type=x.type==='password'?'text':'password';});
$('accountCode').type='password';

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
  const main=document.createElement('span');main.className='account-main';main.textContent=a.alias||a.login;
  const sub=document.createElement('span');sub.className='account-sub';sub.textContent=`${a.login} · ${a.server}`;
  td.append(main,sub);row.appendChild(td);
}
function renderAccounts() {
  const valid=savedAccounts.filter(a=>a.accountData);
  $('accountCount').textContent=String(valid.length);
  if(!valid.length){
    $('accountsEmpty').classList.remove('hidden');$('accountsTableWrap').classList.add('hidden');
  } else {
    $('accountsEmpty').classList.add('hidden');$('accountsTableWrap').classList.remove('hidden');
  }
  $('accountRows').replaceChildren();
  $('profitRows').replaceChildren();
  let totals={balance:0,equity:0,floating:0,positions:0,online:0};
  let currencies=new Set();
  for(const a of valid) {
    const d=a.accountData||{}, c=d.currency||'';
    if(c)currencies.add(c);
    const bal=Number(d.balance||0), eq=Number(d.equity||0), fl=Number(d.floating_profit||0);
    totals.balance+=bal;totals.equity+=eq;totals.floating+=fl;totals.positions+=Number(d.open_positions||0);
    const online=d.updated_at && (Date.now()-new Date(String(d.updated_at).replace(' ','T')+'Z').getTime()<120000);
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
  const currency=currencies.size===1?[...currencies][0]: (currencies.size>1?'Mixed':'');
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
  if(!entry.alias || entry.alias==='MT5 Account')entry.alias=entry.login;
  return entry;
}
async function restoreAccounts() {
  $('systemStatus').textContent='Loading';
  const restored=[];
  for(const entry of savedAccounts) {
    try { restored.push(await fetchAccount(entry)); }
    catch(err) { if(!/session expired|unauthorized/i.test(err.message)) restored.push(entry); }
  }
  savedAccounts=restored;
  saveAccounts();
  renderAccounts();
  $('systemStatus').textContent='Ready';
  if(savedAccounts.length) $('profitScope').textContent='all accounts';
}
$('addAccountForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const btn=$('loginButton'),msg=$('formMessage');
  btn.disabled=true;btn.textContent='Connecting…';msg.textContent='Checking pairing code…';msg.className='form-message';
  const login=$('accountLogin').value.trim(),server=$('accountServer').value.trim(),code=$('accountCode').value.trim(),alias=$('accountAlias').value.trim();
  let device=localStorage.getItem('mab_kaakoo_device_id');
  if(!device){device=(crypto.randomUUID?crypto.randomUUID():String(Date.now()));localStorage.setItem('mab_kaakoo_device_id',device);}
  try{
    const result=await api('/api/client/pair',{method:'POST',body:JSON.stringify({login,server,pairingCode:code,deviceId:'browser-'+device})});
    const entry={token:result.token,alias,login,server,accountData:null};
    await fetchAccount(entry);
    const existing=savedAccounts.findIndex(a=>a.login===login&&a.server===server);
    if(existing>=0)savedAccounts[existing]=entry;else savedAccounts.push(entry);
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
