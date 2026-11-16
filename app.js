(() => {
'use strict';
const $=id=>document.getElementById(id);
const API=()=>String(localStorage.getItem('mk_api_base')||window.MK_CONFIG?.API_BASE_URL||'').replace(/\/+$/,'');
const TOKEN_KEY='mk_browser_client_token', CACHE_KEY='mk_accounts_cache', CACHE_TTL=3*24*60*60*1000;
let token=localStorage.getItem(TOKEN_KEY)||'', accounts=[], selectedPeriod='today';
const fmt=(v,c='')=>v===undefined||v===null||v===''?'—':`${Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ${c}`.trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2600)}
async function api(path,opts={}){
 const headers={'Content-Type':'application/json',...(opts.headers||{})};if(token)headers.Authorization='Bearer '+token;
 const r=await fetch(API()+path,{...opts,headers});let data={};try{data=await r.json()}catch{}
 if(!r.ok)throw Error(data.error||data.message||`API error ${r.status}`);return data;
}
function setConnection(on,msg){$('connection').className='connection '+(on?'':'offline');$('connection').innerHTML=`<i></i>${esc(msg)}`}
async function ensureBrowserIdentity(){
 if(token)return;
 const r=await api('/api/client/register',{method:'POST',body:JSON.stringify({})});
 token=r.token||r.clientToken||r.accessToken||'';
 if(!token)throw Error('Backend did not return a browser access token. Please check the client registration API response.');
 localStorage.setItem(TOKEN_KEY,token);
}
function loadCache(){
 try{const x=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(x&&Date.now()-x.savedAt<CACHE_TTL&&Array.isArray(x.accounts)){accounts=x.accounts;render();}}catch{}
}
function saveCache(){localStorage.setItem(CACHE_KEY,JSON.stringify({savedAt:Date.now(),accounts}));}
function val(a,...keys){for(const k of keys)if(a[k]!==undefined&&a[k]!==null)return a[k];return undefined}
function render(){
 const body=$('accountsBody'),foot=$('accountsFoot');
 if(!accounts.length){body.innerHTML='<tr><td colspan="7" class="empty">No MT5 accounts added yet. Click “Add Account” to connect your first account.</td></tr>';foot.innerHTML='';}
 else{
 let sums={balance:0,equity:0,margin:0,free:0,floating:0,positions:0,today:0,week:0,month:0,all:0};let live=0;
 body.innerHTML=accounts.map((a,i)=>{
  const c=esc(a.currency||'USD'),status=String(a.status||'waiting').toLowerCase(),online=status==='online';
  const balance=val(a,'balance'),equity=val(a,'equity'),margin=val(a,'margin'),free=val(a,'free_margin','freeMargin'),floating=val(a,'floating_pl','floatingPL'),positions=val(a,'open_positions','openPositions');
  const p=a.profit_reports||a.profitReports||a.profits||{};
  const today=val(p,'today')??val(a,'today_profit','todayProfit'),week=val(p,'this_week','thisWeek')??val(a,'this_week_profit'),month=val(p,'this_month','thisMonth')??val(a,'this_month_profit'),all=val(p,'all_time','allTime')??val(a,'all_time_profit');
  for(const [k,v] of Object.entries({balance,equity,margin,free,floating,today,week,month,all}))if(v!==undefined)sums[k]+=Number(v)||0;
  if(online)live++;sums.positions+=Number(positions)||0;
  return `<tr><td><div class="account-name"><span class="status-dot ${online?'online':''}"></span>${esc(a.display_name||a.account_number||'MT5 Account')}</div><span class="account-sub">ID: #${esc(a.account_number||'—')} · ${esc(a.broker_server||'—')} · ${esc(status.replaceAll('_',' '))}</span></td>
  <td>${fmt(balance,c)}</td><td>${today===undefined?'<span class="waiting">Waiting for MT5...</span>':fmt(today,c)}</td><td>${fmt(week,c)}</td><td>${fmt(month,c)}</td><td>${fmt(all,c)}</td><td>${fmt(floating,c)}</td></tr>`;
 }).join('');
 foot.innerHTML=`<tr><td><b>TOTAL (${accounts.length} accounts)</b></td><td><b>${fmt(sums.balance,accounts[0]?.currency||'')}</b></td><td><b>${fmt(sums.today,accounts[0]?.currency||'')}</b></td><td><b>${fmt(sums.week,accounts[0]?.currency||'')}</b></td><td><b>${fmt(sums.month,accounts[0]?.currency||'')}</b></td><td><b>${fmt(sums.all,accounts[0]?.currency||'')}</b></td><td><b>${fmt(sums.floating,accounts[0]?.currency||'')}</b></td></tr>`;
 $('totalBalance').textContent=fmt(sums.balance,accounts[0]?.currency||'');$('totalEquity').textContent=fmt(sums.equity,accounts[0]?.currency||'');$('totalMargin').textContent=fmt(sums.margin,accounts[0]?.currency||'');$('totalFreeMargin').textContent=fmt(sums.free,accounts[0]?.currency||'');$('totalPositions').textContent=sums.positions;$('liveCount').textContent=`${live}/${accounts.length} live accounts open`;
 }
 const total=(key)=>accounts.reduce((s,a)=>{const p=a.profit_reports||a.profitReports||a.profits||{};const v=p[key]??a[key];return s+(Number(v)||0)},0);
 $('sumToday').textContent=accounts.length?fmt(total('today'),accounts[0]?.currency):'Waiting...';
 $('sumWeek').textContent=accounts.length?fmt(total('this_week'),accounts[0]?.currency):'Waiting...';
 $('sumMonth').textContent=accounts.length?fmt(total('this_month'),accounts[0]?.currency):'Waiting...';
 $('sumAll').textContent=accounts.length?fmt(total('all_time'),accounts[0]?.currency):'Waiting...';
 $('sumFloating').textContent=accounts.length?fmt(accounts.reduce((s,a)=>s+Number(val(a,'floating_pl','floatingPL')||0),0),accounts[0]?.currency):'—';
}
async function refresh(){
 try{
  await ensureBrowserIdentity();
  const r=await api('/api/client/accounts');
  accounts=Array.isArray(r)?r:(r.accounts||r.items||[]);
  saveCache();render();setConnection(true,'Connected');
 }catch(e){setConnection(false,'Offline / API unavailable');toast(e.message);}
}
function openModal(){$('addDialog').showModal();$('accountNumber').focus()}
async function addAccount(e){
 e.preventDefault();$('submitAdd').disabled=true;$('formMessage').className='form-message';$('formMessage').textContent='Verifying pairing code…';
 try{
  await ensureBrowserIdentity();
  const payload={accountNumber:$('accountNumber').value.trim(),brokerServer:$('brokerServer').value.trim(),keycode:$('pairCode').value.trim()};
  const r=await api('/api/client/accounts/add',{method:'POST',body:JSON.stringify(payload)});
  $('formMessage').className='form-message success';$('formMessage').textContent=r.message||'Account added. Waiting for the MT5 EA to connect…';
  await refresh();$('addForm').reset();setTimeout(()=>$('addDialog').close(),900);
 }catch(err){$('formMessage').className='form-message error';$('formMessage').textContent=err.message;}
 finally{$('submitAdd').disabled=false}
}
function init(){
 loadCache();
 $('openAdd').addEventListener('click',openModal);$('closeAdd').addEventListener('click',()=>$('addDialog').close());$('cancelAdd').addEventListener('click',()=>$('addDialog').close());$('addForm').addEventListener('submit',addAccount);
 document.querySelectorAll('.period').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.period').forEach(x=>x.classList.remove('active'));b.classList.add('active');selectedPeriod=b.dataset.period;}));
 const now=new Date();const localDate=new Date(now-now.getTimezoneOffset()*60000).toISOString().slice(0,10);$('dateFrom').value=localDate;$('dateTo').value=localDate;
 refresh();setInterval(refresh,15000);
}
document.addEventListener('DOMContentLoaded',init);
})();
