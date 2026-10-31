const $ = (id) => document.getElementById(id);

let apiUrl = "";
let adminToken = "";
let clients = [];
let busy = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function setStatus(text, state = "") {
  $("connection").className = `status ${state}`;
  $("connection").innerHTML = `<i></i>${escapeHtml(text)}`;
}

function message(text, isError = false) {
  $("adminMessage").textContent = text;
  $("adminMessage").className = `message ${isError ? "error-text" : ""}`;
}

async function api(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "accept": "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(adminToken ? { "authorization": `Bearer ${adminToken}` } : {}),
      ...(options.headers || {})
    },
    cache: "no-store"
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status})`);
  return data;
}

async function login(event) {
  event.preventDefault();
  apiUrl = $("apiUrl").value.trim().replace(/\/+$/, "");
  const password = $("adminPassword").value;
  if (!apiUrl || !password) return;
  try {
    const parsed = new URL(apiUrl);
    if (parsed.protocol !== "https:") throw new Error("Use an HTTPS Worker URL.");
  } catch (e) {
    $("loginMessage").textContent = e.message || "Enter a valid Worker URL.";
    return;
  }

  $("loginBtn").disabled = true;
  $("loginMessage").textContent = "Connecting…";
  try {
    const response = await fetch(`${apiUrl}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ password }),
      cache: "no-store"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Login failed (HTTP ${response.status})`);
    adminToken = data.token;
    $("adminPassword").value = "";
    $("loginPanel").hidden = true;
    $("adminArea").hidden = false;
    $("refreshBtn").disabled = false;
    $("logoutBtn").hidden = false;
    setStatus("Admin connected", "online");
    await loadClients();
  } catch (e) {
    adminToken = "";
    $("loginMessage").textContent = e.message;
    setStatus("Connection issue", "error");
  } finally {
    $("loginBtn").disabled = false;
  }
}

function accountCounts(list) {
  const all = list.flatMap(c => Array.isArray(c.accounts) ? c.accounts : []);
  return {
    clients: list.length,
    accounts: all.length,
    pending: all.filter(a => a.status === "Pending").length,
    approved: all.filter(a => a.status === "Approved").length,
    inactive: all.filter(a => ["Rejected", "Revoked"].includes(a.status)).length
  };
}

function renderSummary() {
  const c = accountCounts(clients);
  $("clientCount").textContent = c.clients;
  $("accountCount").textContent = c.accounts;
  $("pendingCount").textContent = c.pending;
  $("approvedCount").textContent = c.approved;
  $("inactiveCount").textContent = c.inactive;
}

function statusClass(status) {
  return String(status || "Pending").toLowerCase();
}

function filteredClients() {
  const q = $("searchInput").value.trim().toLowerCase();
  const filter = $("statusFilter").value;
  return clients.map(client => {
    const accounts = (client.accounts || []).filter(a => {
      const matchesStatus = filter === "All" || a.status === filter;
      const haystack = [client.displayName, client.email, a.displayName, a.login, a.server].join(" ").toLowerCase();
      return matchesStatus && (!q || haystack.includes(q));
    });
    return { ...client, visibleAccounts: accounts };
  }).filter(c => c.visibleAccounts.length || (!q && filter === "All" && !(c.accounts || []).length));
}

function renderClients() {
  renderSummary();
  const list = filteredClients();
  if (!list.length) {
    $("clientsList").innerHTML = '<div class="empty-state">No registrations match this filter.</div>';
    return;
  }

  $("clientsList").innerHTML = list.map(client => {
    const accountsHtml = client.visibleAccounts.map(account => {
      const id = escapeHtml(account.id);
      const status = escapeHtml(account.status || "Pending");
      const approved = account.status === "Approved";
      const pending = account.status === "Pending";
      const actions = pending
        ? `<button class="small-btn approve-btn" data-action="approve" data-client="${escapeHtml(client.id)}" data-account="${id}">Approve</button>
           <button class="small-btn reject-btn" data-action="reject" data-client="${escapeHtml(client.id)}" data-account="${id}">Reject</button>`
        : approved
          ? `<button class="small-btn revoke-btn" data-action="revoke" data-client="${escapeHtml(client.id)}" data-account="${id}">Revoke</button>`
          : `<span class="muted">No action available</span>`;

      return `<article class="account-row">
        <div class="account-main">
          <div class="account-title"><strong>${escapeHtml(account.displayName || "MT5 Account")}</strong><span class="status-pill ${statusClass(status)}">${status}</span></div>
          <div class="account-meta"><span>Login: <b>${escapeHtml(account.login)}</b></span><span>Server: <b>${escapeHtml(account.server)}</b></span></div>
          ${account.adminNote ? `<div class="admin-note">Admin note: ${escapeHtml(account.adminNote)}</div>` : ""}
        </div>
        <div class="account-actions">${actions}</div>
      </article>`;
    }).join("");

    return `<section class="client-card">
      <div class="client-heading">
        <div><h3>${escapeHtml(client.displayName || "Unnamed client")}</h3>
          <p>${client.email ? escapeHtml(client.email) : "No email supplied"} <span class="dot">•</span> Client ID: <code>${escapeHtml(client.id)}</code></p>
        </div>
        <span class="client-total">${client.visibleAccounts.length} account${client.visibleAccounts.length === 1 ? "" : "s"} shown</span>
      </div>
      <div class="account-list">${accountsHtml || '<div class="empty-inline">No accounts match this filter.</div>'}</div>
    </section>`;
  }).join("");
}

async function loadClients() {
  if (!adminToken || busy) return;
  busy = true;
  $("refreshBtn").disabled = true;
  try {
    const data = await api("/api/admin/clients", { method: "GET" });
    clients = Array.isArray(data.clients) ? data.clients : [];
    renderClients();
    setStatus("Admin connected", "online");
    message(`Loaded ${clients.length} client registration(s).`);
  } catch (e) {
    setStatus("Session expired / error", "error");
    message(`${e.message} If your admin session expired, log in again.`, true);
    if (/session expired|invalid/i.test(e.message)) logout(false);
  } finally {
    busy = false;
    $("refreshBtn").disabled = !adminToken;
  }
}

async function accountAction(button) {
  if (button.disabled) return;
  const { action, client, account } = button.dataset;
  const labels = { approve: "approve this MT5 account", reject: "reject this MT5 account", revoke: "revoke this MT5 account" };
  if (!window.confirm(`Are you sure you want to ${labels[action]}?`)) return;

  let note = "";
  if (action === "reject") {
    note = window.prompt("Optional note for your records (leave blank if none):") || "";
  }
  button.disabled = true;
  message(`${action[0].toUpperCase()}${action.slice(1)} request processing…`);
  try {
    const result = await api(`/api/admin/clients/${encodeURIComponent(client)}/accounts/${encodeURIComponent(account)}/${action}`, {
      method: "POST",
      body: JSON.stringify({ note })
    });
    if (action === "approve" && result.eaUploadToken) {
      $("privateLinkToken").value = result.privateLinkToken || "A private-link token already exists. Use the client's previously issued private link.";
      $("eaUploadToken").value = result.eaUploadToken;
      $("tokenPanel").hidden = false;
      $("tokenPanel").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    message(`Account ${result.accountStatus || action + "d"} successfully.`);
    await loadClients();
  } catch (e) {
    message(e.message, true);
    button.disabled = false;
  }
}

function logout(showMessage = true) {
  adminToken = "";
  clients = [];
  $("adminArea").hidden = true;
  $("loginPanel").hidden = false;
  $("refreshBtn").disabled = true;
  $("logoutBtn").hidden = true;
  $("tokenPanel").hidden = true;
  setStatus("Not connected");
  if (showMessage) $("loginMessage").textContent = "You have logged out.";
}

$("loginForm").addEventListener("submit", login);
$("refreshBtn").addEventListener("click", loadClients);
$("logoutBtn").addEventListener("click", () => logout(true));
$("searchInput").addEventListener("input", renderClients);
$("statusFilter").addEventListener("change", renderClients);
$("clientsList").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button) accountAction(button);
});
$("closeTokenBtn").addEventListener("click", () => { $("tokenPanel").hidden = true; });
document.querySelectorAll("[data-copy]").forEach(button => {
  button.addEventListener("click", async () => {
    const field = $(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(field.value);
      const old = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => button.textContent = old, 1200);
    } catch {
      field.focus(); field.select();
      message("Clipboard permission was blocked. Select the token text and copy it manually.", true);
    }
  });
});
