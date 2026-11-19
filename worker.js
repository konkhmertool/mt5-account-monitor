const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
const json = (data, status=200) => new Response(JSON.stringify(data), {
  status, headers: {...cors, "Content-Type":"application/json"}
});
const nowISO = () => new Date().toISOString();
const hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function sha(s) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
function token(n=32) {
  const b=crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
function validText(s,max=128) { return typeof s==="string" && s.trim().length>0 && s.length<=max; }
async function body(req) { try { return await req.json(); } catch { return null; } }
function cleanName(s,fallback) { return validText(s,48) ? s.trim() : fallback; }

function bearer(req) {
  return (req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
}
async function accountAuth(req,env) {
  const t=bearer(req); if(!t || t.length>200) return null;
  const h=await sha(t);
  return await env.DB.prepare(
    "SELECT id,account_login,broker_server,status FROM accounts WHERE api_token_hash=?"
  ).bind(h).first();
}
async function installAuth(req,env) {
  const t=bearer(req); if(!t || t.length>200) return null;
  const h=await sha(t);
  return await env.DB.prepare(`
    SELECT i.id AS installation_row_id,i.account_id,i.installation_id,
      i.installation_name,i.status AS installation_status,
      a.account_login,a.broker_server,a.status AS account_status
    FROM installations i JOIN accounts a ON a.id=i.account_id
    WHERE i.api_token_hash=?
  `).bind(h).first();
}
async function ensureLegacyInstallation(req,env,account,b) {
  // Backward-compatible bridge for existing v1.03 installations. Older builds
  // may omit installationId; use one stable account-scoped legacy identity.
  if(!account) return null;
  const hash=await sha(bearer(req));
  const supplied=(b && /^[A-Za-z0-9_-]{12,100}$/.test(b.installationId||"")) ? b.installationId : "LEGACY-"+String(account.id).padStart(8,"0");
  const name=(b && validText(b.installationName,48)) ? b.installationName.trim() : "MT5-"+supplied.slice(-4).toUpperCase();
  const existing=await env.DB.prepare(
    "SELECT id,installation_id FROM installations WHERE account_id=? AND api_token_hash=?"
  ).bind(account.id,hash).first();
  if(existing && existing.installation_id!==supplied) {
    await env.DB.prepare(`
      UPDATE installations SET installation_id=?,installation_name=?,last_seen=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(supplied,name,existing.id).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO installations(account_id,installation_id,installation_name,api_token_hash,last_seen)
      VALUES(?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(account_id,installation_id) DO UPDATE SET
        installation_name=excluded.installation_name,last_seen=CURRENT_TIMESTAMP
    `).bind(account.id,supplied,name,hash).run();
  }
  return await env.DB.prepare(`
    SELECT i.id AS installation_row_id,i.account_id,i.installation_id,
      i.installation_name,i.status AS installation_status,a.status AS account_status
    FROM installations i JOIN accounts a ON a.id=i.account_id
    WHERE i.account_id=? AND i.installation_id=?
  `).bind(account.id,supplied).first();
}
async function sessionAuth(req,env) {
  const t=bearer(req); if(!t || t.length>200) return null;
  const h=await sha(t);
  const s=await env.DB.prepare(
    "SELECT id,account_id,expires_at FROM client_sessions WHERE token_hash=?"
  ).bind(h).first();
  if(!s || Date.parse(s.expires_at)<=Date.now()) return null;
  return s;
}
async function saveFixedPairing(env,accountId,code) {
  // Preserve the existing fixed, reusable six-digit account pairing code.
  const expires="2099-12-31T23:59:59.000Z";
  const codeHash=await sha(`${code}:${accountId}:${expires}`);
  await env.DB.prepare("DELETE FROM pairing_codes WHERE account_id=?").bind(accountId).run();
  await env.DB.prepare(
    "INSERT INTO pairing_codes(account_id,code_hash,expires_at,used_at) VALUES(?,?,?,NULL)"
  ).bind(accountId,codeHash,expires).run();
  return expires;
}
async function validatePairing(env,accountId,code) {
  const c=await env.DB.prepare(
    "SELECT code_hash,expires_at FROM pairing_codes WHERE account_id=? ORDER BY id DESC LIMIT 1"
  ).bind(accountId).first();
  if(!c || Date.parse(c.expires_at)<=Date.now()) return false;
  return (await sha(`${code}:${accountId}:${c.expires_at}`))===c.code_hash;
}
async function processCommandResults(env,accountId,results) {
  if(!Array.isArray(results)) return;
  for(const r of results.slice(0,20)) {
    if(!r || !Number.isInteger(Number(r.id))) continue;
    await env.DB.prepare(`
      UPDATE commands SET status=?,executed_at=CURRENT_TIMESTAMP,result_json=?
      WHERE id=? AND account_id=? AND status='claimed'
    `).bind(r.success?"completed":"failed",JSON.stringify(r).slice(0,2000),Number(r.id),accountId).run();
  }
}
async function claimCommands(env,accountId) {
  const now=nowISO();
  await env.DB.prepare(`
    UPDATE commands SET status='expired'
    WHERE account_id=? AND status IN ('queued','claimed') AND expires_at<=?
  `).bind(accountId,now).run();
  const pending=await env.DB.prepare(`
    SELECT id,command_type FROM commands
    WHERE account_id=? AND status='queued' AND expires_at>?
    ORDER BY id LIMIT 10
  `).bind(accountId,now).all();
  const commands=[];
  for(const c of (pending.results||[])) {
    const claim=await env.DB.prepare(
      "UPDATE commands SET status='claimed' WHERE id=? AND status='queued'"
    ).bind(c.id).run();
    if(claim.meta.changes) commands.push({id:c.id,type:c.command_type});
  }
  return commands;
}

export default {
 async fetch(req,env) {
  if(req.method==="OPTIONS") return new Response(null,{headers:cors});
  const u=new URL(req.url), p=u.pathname;
  try {
    if(p==="/api/health" && req.method==="GET") {
      await env.DB.prepare("SELECT 1").first();
      return json({success:true,message:"Mab KaaKoo MT5 API is running",database:"connected"});
    }

    // First installation creates the account. Additional installations must prove
    // account ownership with the existing six-digit pairing code.
    if(p==="/api/mt5/register" && req.method==="POST") {
      const b=await body(req);
      if(!b || !validText(b.login,64) || !validText(b.server,128) ||
         !/^[A-Za-z0-9_-]{12,100}$/.test(b.installationId||"") ||
         !/^\d{6}$/.test(b.pairingCode||""))
        return json({error:"Invalid registration data"},400);

      const login=b.login.trim(), server=b.server.trim();
      let a=await env.DB.prepare(
        "SELECT id,account_login,broker_server,status FROM accounts WHERE account_login=? AND broker_server=?"
      ).bind(login,server).first();

      if(!a) {
        const apiToken=token(32), hash=await sha(apiToken);
        const ins=await env.DB.prepare(`
          INSERT INTO accounts(account_login,broker_server,display_name,last_seen,api_token_hash)
          VALUES(?,?,?,CURRENT_TIMESTAMP,?)
        `).bind(login,server,b.displayName||null,hash).run();
        const accountId=ins.meta.last_row_id;
        await saveFixedPairing(env,accountId,b.pairingCode);
        const installName=cleanName(b.installationName,"MT5-"+b.installationId.slice(-4).toUpperCase());
        await env.DB.prepare(`
          INSERT INTO installations(account_id,installation_id,installation_name,api_token_hash,last_seen)
          VALUES(?,?,?,?,CURRENT_TIMESTAMP)
        `).bind(accountId,b.installationId,installName,hash).run();
        return json({success:true,apiToken,installationId:b.installationId,installationName:installName,linkedExisting:false});
      }

      if(a.status!=="active") return json({error:"Account is not active"},403);
      const already=await env.DB.prepare(
        "SELECT id FROM installations WHERE account_id=? AND installation_id=?"
      ).bind(a.id,b.installationId).first();
      if(already) return json({error:"This installation is already registered. Keep its saved credential file."},409);
      if(!await validatePairing(env,a.id,b.pairingCode))
        return json({error:"Incorrect or missing account pairing code"},401);

      const apiToken=token(32), hash=await sha(apiToken);
      const installName=cleanName(b.installationName,"MT5-"+b.installationId.slice(-4).toUpperCase());
      await env.DB.prepare(`
        INSERT INTO installations(account_id,installation_id,installation_name,api_token_hash,last_seen)
        VALUES(?,?,?,?,CURRENT_TIMESTAMP)
      `).bind(a.id,b.installationId,installName,hash).run();
      return json({success:true,apiToken,installationId:b.installationId,installationName:installName,linkedExisting:true});
    }

    // Existing v1 EA can upgrade its account credential into an installation row.
    if(p==="/api/mt5/upgrade-installation" && req.method==="POST") {
      const a=await accountAuth(req,env); if(!a) return json({error:"Unauthorized"},401);
      const b=await body(req);
      if(!b || !/^[A-Za-z0-9_-]{12,100}$/.test(b.installationId||""))
        return json({error:"Invalid installation identity"},400);
      // Each terminal must receive its OWN credential. Older v1.03 key files
      // may have been copied to several PCs/VPSs and therefore share one legacy
      // account token. Never reuse that token hash for multiple installation rows.
      const old=await env.DB.prepare(
        "SELECT id,installation_name FROM installations WHERE account_id=? AND installation_id=?"
      ).bind(a.id,b.installationId).first();
      const name=cleanName(b.installationName,"MT5-"+b.installationId.slice(-4).toUpperCase());
      const apiToken=token(32), installationTokenHash=await sha(apiToken);
      if(old) {
        await env.DB.prepare(`
          UPDATE installations SET installation_name=?,api_token_hash=?,status='active',
            last_seen=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?
        `).bind(name,installationTokenHash,old.id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO installations(account_id,installation_id,installation_name,api_token_hash,last_seen)
          VALUES(?,?,?,?,CURRENT_TIMESTAMP)
        `).bind(a.id,b.installationId,name,installationTokenHash).run();
      }
      return json({success:true,apiToken,installationId:b.installationId,installationName:name});
    }

    if((p==="/api/mt5/renew-pairing" || p==="/api/mt5/set-pairing-code") && req.method==="POST") {
      const i=await installAuth(req,env);
      const a=i || await accountAuth(req,env);
      if(!a) return json({error:"Unauthorized"},401);
      const b=await body(req);
      if(!b || !/^\d{6}$/.test(b.pairingCode||"")) return json({error:"Invalid code"},400);
      const accountId=i ? i.account_id : a.id;
      const expiresAt=await saveFixedPairing(env,accountId,b.pairingCode);
      return json({success:true,pairingCodeSaved:true,pairingExpiresAt:expiresAt});
    }

    if(p==="/api/mt5/heartbeat" && req.method==="POST") {
      let i=await installAuth(req,env);
      const legacy=i ? null : await accountAuth(req,env);
      const b=await body(req);
      if(!b) return json({error:"Invalid heartbeat"},400);
      if(!i && legacy) i=await ensureLegacyInstallation(req,env,legacy,b);
      const a=i || legacy;
      if(!a) return json({error:"Unauthorized"},401);
      if(i && (i.installation_status!=="active" || i.account_status!=="active"))
        return json({error:"Installation or account inactive"},403);
      const accountId=i ? i.account_id : a.id;
      await env.DB.prepare("UPDATE accounts SET last_seen=CURRENT_TIMESTAMP WHERE id=?").bind(accountId).run();
      if(i) await env.DB.prepare("UPDATE installations SET last_seen=CURRENT_TIMESTAMP WHERE id=?").bind(i.installation_row_id).run();

      // Light heartbeat updates liveness only; it does not overwrite dashboard snapshots.
      if(b.mode!=="full") return json({success:true,mode:"light",commands:[]});

      const num=v=>Number.isFinite(Number(v))?Number(v):0;
      const historyJson = b.closedProfit && typeof b.closedProfit === "object"
        ? JSON.stringify(b.closedProfit).slice(0,200000) : "{}";
      await env.DB.prepare(`
        INSERT INTO account_snapshots(account_id,balance,equity,floating_profit,today_closed_profit,
          currency,symbol,open_positions,positions_json,closed_profit_json,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(account_id) DO UPDATE SET
          balance=excluded.balance,equity=excluded.equity,floating_profit=excluded.floating_profit,
          today_closed_profit=excluded.today_closed_profit,currency=excluded.currency,
          symbol=excluded.symbol,open_positions=excluded.open_positions,
          positions_json=excluded.positions_json,closed_profit_json=excluded.closed_profit_json,
          updated_at=CURRENT_TIMESTAMP
      `).bind(accountId,num(b.balance),num(b.equity),num(b.floatingProfit),num(b.todayClosedProfit),
        b.currency||"",b.symbol||"",Math.max(0,Math.floor(num(b.openPositions))),
        JSON.stringify(Array.isArray(b.positions)?b.positions:[]),historyJson).run();

      await env.DB.prepare(`
        UPDATE account_data_requests SET status='fulfilled',fulfilled_at=CURRENT_TIMESTAMP,
          lease_expires_at=NULL WHERE account_id=? AND status IN ('pending','claimed')
      `).bind(accountId).run();
      await processCommandResults(env,accountId,b.results);
      const commands=b.allowWebClientControls===true
        ? await claimCommands(env,accountId) : [];
      return json({success:true,mode:"full",commands});
    }

    // EA checks this endpoint periodically. Only one installation receives a live lease.
    if(p==="/api/mt5/check-request" && req.method==="POST") {
      let i=await installAuth(req,env);
      if(!i) {
        const legacy=await accountAuth(req,env);
        const b=await body(req);
        if(legacy) i=await ensureLegacyInstallation(req,env,legacy,b);
      }
      if(!i || i.installation_status!=="active" || i.account_status!=="active")
        return json({error:"Unauthorized"},401);
      // Prefer the installation with the freshest heartbeat. If it stops checking in,
      // another active installation becomes eligible after the 90-second freshness window.
      const preferred=await env.DB.prepare(`
        SELECT id FROM installations
        WHERE account_id=? AND status='active'
          AND last_seen >= datetime('now','-90 seconds')
        ORDER BY last_seen DESC,id DESC LIMIT 1
      `).bind(i.account_id).first();
      if(preferred && preferred.id!==i.installation_row_id)
        return json({success:true,request:false,preferred:false});

      const r=await env.DB.prepare(
        "SELECT id,status,requested_at,lease_expires_at,date_from,date_to FROM account_data_requests WHERE account_id=?"
      ).bind(i.account_id).first();
      if(!r || r.status==="fulfilled" || r.status==="expired")
        return json({success:true,request:false});

      const requested=Date.parse(String(r.requested_at).replace(" ","T")+"Z");
      if(!Number.isFinite(requested) || Date.now()-requested>30000) {
        await env.DB.prepare("UPDATE account_data_requests SET status='expired' WHERE id=?").bind(r.id).run();
        return json({success:true,request:false});
      }

      const leaseTime=r.lease_expires_at ? Date.parse(r.lease_expires_at) : 0;
      if(r.status==="claimed" && leaseTime>Date.now())
        return json({success:true,request:false});

      const leaseExpires=new Date(Date.now()+20000).toISOString();
      const claim=await env.DB.prepare(`
        UPDATE account_data_requests
        SET status='claimed',lease_installation_id=?,lease_expires_at=?
        WHERE id=? AND (status='pending' OR lease_expires_at IS NULL OR lease_expires_at<=?)
      `).bind(i.installation_id,leaseExpires,r.id,nowISO()).run();
      return json({success:true,request:!!claim.meta.changes,leaseExpiresAt:claim.meta.changes?leaseExpires:null,dateFrom:r.date_from||"",dateTo:r.date_to||""});
    }

    // Monitor EA polls this lightweight endpoint for website control commands.
    if(p==="/api/mt5/check-commands" && req.method==="POST") {
      let i=await installAuth(req,env);
      if(!i) {
        const legacy=await accountAuth(req,env);
        const b=await body(req);
        if(legacy) i=await ensureLegacyInstallation(req,env,legacy,b);
      }
      if(!i || i.installation_status!=="active" || i.account_status!=="active")
        return json({error:"Unauthorized"},401);
      const commands=await claimCommands(env,i.account_id);
      return json({success:true,commands});
    }

    // Monitor EA reports whether each claimed command was carried out.
    if(p==="/api/mt5/command-result" && req.method==="POST") {
      const b=await body(req);
      let i=await installAuth(req,env);
      if(!i) {
        const legacy=await accountAuth(req,env);
        if(legacy) i=await ensureLegacyInstallation(req,env,legacy,b);
      }
      if(!i || i.installation_status!=="active" || i.account_status!=="active")
        return json({error:"Unauthorized"},401);
      if(!b || !Number.isInteger(Number(b.commandId)))
        return json({error:"Invalid command result"},400);
      const status=b.success===true?"completed":"failed";
      const updated=await env.DB.prepare(
        "UPDATE commands SET status=?,executed_at=CURRENT_TIMESTAMP,result_json=? WHERE id=? AND account_id=? AND status='claimed'"
      ).bind(status,JSON.stringify(b).slice(0,2000),Number(b.commandId),i.account_id).run();
      return json({success:!!updated.meta.changes});
    }

    if(p==="/api/client/pair" && req.method==="POST") {
      const b=await body(req);
      if(!b || !validText(b.login,64) || !validText(b.server,128) ||
         !/^\d{6}$/.test(b.pairingCode||""))
        return json({error:"Invalid pairing details"},400);
      const a=await env.DB.prepare(`
        SELECT id,account_login,broker_server,status FROM accounts
        WHERE account_login=? AND broker_server=?
      `).bind(b.login.trim(),b.server.trim()).first();
      if(!a || a.status!=="active") return json({error:"Account not found"},404);
      if(!await validatePairing(env,a.id,b.pairingCode))
        return json({error:"Incorrect or expired pairing code"},401);
      const clientToken=token(32), tokenHash=await sha(clientToken);
      const expiresAt=new Date(Date.now()+30*86400000).toISOString();
      await env.DB.prepare(`
        INSERT INTO client_sessions(account_id,token_hash,device_id,expires_at) VALUES(?,?,?,?)
      `).bind(a.id,tokenHash,b.deviceId||null,expiresAt).run();
      return json({success:true,token:clientToken,expiresAt,
        account:{login:a.account_login,server:a.broker_server}});
    }

    // Website calls this every 15 seconds only while its tab is visible.
    // A single account-level pending request serves all visible tabs/devices.
    if(p==="/api/client/active" && req.method==="POST") {
      const s=await sessionAuth(req,env); if(!s) return json({error:"Session expired"},401);
      const b=await body(req)||{};
      const from=/^\d{4}-\d{2}-\d{2}$/.test(b.dateFrom||"")?b.dateFrom:null;
      const to=/^\d{4}-\d{2}-\d{2}$/.test(b.dateTo||"")?b.dateTo:null;
      await env.DB.prepare(`
        INSERT INTO account_data_requests(account_id,requested_at,status,lease_installation_id,
          lease_expires_at,fulfilled_at,date_from,date_to)
        VALUES(?,CURRENT_TIMESTAMP,'pending',NULL,NULL,NULL,?,?)
        ON CONFLICT(account_id) DO UPDATE SET requested_at=CURRENT_TIMESTAMP,status='pending',
          lease_installation_id=NULL,lease_expires_at=NULL,fulfilled_at=NULL,
          date_from=excluded.date_from,date_to=excluded.date_to
      `).bind(s.account_id,from,to).run();
      return json({success:true,active:true});
    }

    if(p==="/api/client/account" && req.method==="GET") {
      const s=await sessionAuth(req,env); if(!s) return json({error:"Session expired"},401);
      const data=await env.DB.prepare(`
        SELECT a.account_login,a.broker_server,a.last_seen,
          s.balance,s.equity,s.floating_profit,s.today_closed_profit,s.currency,s.symbol,
          s.open_positions,s.positions_json,s.closed_profit_json,s.updated_at
        FROM accounts a LEFT JOIN account_snapshots s ON s.account_id=a.id WHERE a.id=?
      `).bind(s.account_id).first();
      return json({success:true,account:data});
    }

    if(p==="/api/client/commands" && req.method==="POST") {
      const s=await sessionAuth(req,env); if(!s) return json({error:"Session expired"},401);
      const b=await body(req), allowed=["close_all","stop_algo","start_algo"];
      if(!b || !allowed.includes(b.commandType)) return json({error:"Unsupported command"},400);
      const exp=new Date(Date.now()+120000).toISOString();
      const r=await env.DB.prepare(
        "INSERT INTO commands(account_id,command_type,expires_at) VALUES(?,?,?)"
      ).bind(s.account_id,b.commandType,exp).run();
      return json({success:true,commandId:r.meta.last_row_id,status:"queued"});
    }

    return json({error:"Endpoint not found"},404);
  } catch(e) {
    return json({error:"Internal server error",message:e.message},500);
  }
 }
};
