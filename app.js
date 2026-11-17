'use strict';
const API_BASE = 'https://monitor.mt5dashboard.workers.dev';
const SESSION_KEY = 'mab_kaakoo_client_session_v1';
const $ = id => document.getElementById(id);
let sessionToken = localStorage.getItem(SESSION_KEY) || '';
let currentAccount = null;

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
function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(options.auth)headers.Authorization='Bearer '+options.auth;return fetch(API_BASE+path,{...options,headers}).then(async r=>{let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||'Request failed ('+r.status+')');return d;});}
function renderAccount(a){
  currentAccount=a;
  $('accountsEmpty').classList.add('hidden');$('accountsTableWrap').classList.remove('hidden');
  $('accountCount').textContent='1';$('onlineCount').textContent='1/1 accounts online';$('onlineSummary').textContent='1 account online';
  $('accountRows').innerHTML='';
  const tr=document.createElement('tr');
  const accountCell=document.createElement('td');
  accountCell.innerHTML='<span class="account-main"></span><span class="account-sub"></span>';
  accountCell.querySelector('.account-main').textContent=a.alias;
  accountCell.querySelector('.account-sub').textContent=`${a.login} · ${a.server}`;
  tr.appendChild(accountCell);
  const cells=[money(a.balance,a.currency),money(a.equity,a.currency),'—','—','—','—','—'];
  cells.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(i===6)td.className='positive';tr.appendChild(td);});
  const status=document.createElement('td');status.innerHTML='<span class="online">● Online</span>';tr.appendChild(status);
  $('accountRows').appendChild(tr);
  $('profitRows').innerHTML='';
  const pr=document.createElement('tr');
  const first=document.createElement('td');first.textContent=a.alias+' · '+a.login;pr.appendChild(first);
  for(let i=0;i<5;i++){const td=document.createElement('td');td.textContent='—';pr.appendChild(td);}
  $('profitRows').appendChild(pr);
  $('totalBalance').textContent=money(a.balance,a.currency);
  $('totalEquity').textContent=money(a.equity,a.currency);
  $('totalFloating').textContent=money(a.floating,a.currency);
  $('totalPositions').textContent=String(a.openPositions??0);
  $('profitFloating').textContent=money(a.floating,a.currency);
  $('openPositionCount').textContent=String(a.openPositions??0);
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
    sessionToken=result.token;localStorage.setItem(SESSION_KEY,sessionToken);
    let snapshot={};
    try{const response=await api('/api/client/account',{method:'GET',auth:sessionToken});snapshot=response.account||{};}catch{}
    renderAccount({alias,login,server,balance:snapshot.balance,equity:snapshot.equity,floating:snapshot.floating_profit,currency:snapshot.currency||'',openPositions:snapshot.open_positions||0});
    closeModal();
    $('systemStatus').textContent='Ready';
  }catch(err){msg.textContent=err.message||'Unable to pair account.';}
  finally{btn.disabled=false;btn.textContent='Login';}
});
$('symbolFilter').addEventListener('input',()=>{});
$('dateFrom').value=new Date().toISOString().slice(0,10);
$('dateTo').value=new Date().toISOString().slice(0,10);
