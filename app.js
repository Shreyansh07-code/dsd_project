/* Fraud Watch – frontend for the Supabase fraud detection schema.
   Tables used: customers, accounts, transactions, risk_assessments,
   transaction_rule_matches, fraud_rules, fraud_alerts. */

// Optional: hard-code your project here, or use the Connection dialog in the app.
const DEFAULT_URL = "https://tavceheuecenekjuvlqc.supabase.co";
const DEFAULT_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhdmNlaGV1ZWNlbmVranV2bHFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MTg5Mjc5MCwiZXhwIjoyMTA3NDY4NzkwfQ.SJeIZm9QTEm17un5ogRuZdimZsKv6tkVNmBOcUEOpBY";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTime = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "–");
let sb = null, accounts = [], customers = [], txs = [], alerts = [], users = [], cases = [], query = "", openCaseId = null, pendingAlert = null;
const acctLabel = (id) => accounts.find((a) => a.account_id === id)?.account_number ?? `#${id}`;
const riskOf = (t) => t.risk_assessments?.[0];
const tone = (cat) => ({ low: "lo", medium: "me", high: "hi", critical: "hi" }[String(cat).toLowerCase()] || "lo");

function toast(msg, bad = false) {
  const t = $("toast"); t.textContent = msg; t.className = "toast show" + (bad ? " err" : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = "toast"), 3500);
}
function needClient() { if (sb) return true; toast("Connect to Supabase first.", true); $("settings").showModal(); return false; }
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/* ---------- navigation + dialogs ---------- */
document.querySelectorAll(".nav[data-view]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".nav[data-view]").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + b.dataset.view));
}));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => $(b.dataset.close).close()));
const openTx = () => { if (needClient()) { $("txTime").value = localNow(); $("txDlg").showModal(); } };
$("newTx").onclick = openTx; $("newTx2").onclick = openTx;
$("refresh").onclick = () => sb && loadAll();
$("search").oninput = (e) => { query = e.target.value.trim().toLowerCase(); renderList(); };

/* ---------- connection ---------- */
function connect(url, key) {
  try {
    sb = window.supabase.createClient(url, key);
    $("connDot").classList.add("on"); loadAll();
  } catch (e) { sb = null; toast("Could not connect: " + e.message, true); }
}
$("openSettings").onclick = () => {
  const c = JSON.parse(localStorage.getItem("fw_cfg") || "{}");
  $("sbUrl").value = c.url || DEFAULT_URL; $("sbKey").value = c.key || DEFAULT_KEY; $("settings").showModal();
};
$("settingsForm").addEventListener("submit", (e) => {
  if (e.submitter?.value !== "save") return;
  const url = $("sbUrl").value.trim(), key = $("sbKey").value.trim();
  localStorage.setItem("fw_cfg", JSON.stringify({ url, key })); connect(url, key);
});

/* ---------- load data ---------- */
async function loadAll() {
  const res = await Promise.all([
    sb.from("customers").select("customer_id, full_name").order("full_name"),
    sb.from("accounts").select("account_id, account_number, account_type, account_status, customers(full_name)").order("account_id", { ascending: false }),
    sb.from("transactions").select("transaction_id, source_account_id, destination_account_id, amount, transaction_type, transaction_timestamp, transaction_status, risk_assessments(risk_score, risk_category)").order("transaction_id", { ascending: false }).limit(150),
    sb.from("fraud_alerts").select("alert_id, transaction_id, case_id, alert_priority, alert_status, alert_message, created_at, transactions(amount)").order("alert_id", { ascending: false }).limit(100),
    sb.from("users").select("user_id, full_name, role").order("full_name"),
    sb.from("investigation_cases").select("*").order("case_id", { ascending: false }),
  ]);
  const bad = res.find((r) => r.error);
  if (bad) return toast(dbErr(bad.error), true);
  [customers, accounts, txs, alerts, users, cases] = res.map((r) => r.data);
  render();
  if (openCaseId) loadDetail();
}

/* ---------- render ---------- */
function render() { renderBubbles(); renderCal(); renderGauge(); renderProgress(); renderList(); renderAccounts(); renderAlerts(); renderCases(); }

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function renderBubbles() {
  const today = new Date();
  const t = txs.filter((x) => sameDay(new Date(x.transaction_timestamp), today));
  const f = t.filter(riskOf);
  const vol = t.reduce((s, x) => s + Number(x.amount), 0), fvol = f.reduce((s, x) => s + Number(x.amount), 0);
  const big = 210, mid = vol ? Math.max(70, Math.min(190, big * Math.sqrt(fvol / vol))) : 70;
  $("bubbles").innerHTML =
    `<div class="blob y" style="width:${big}px;height:${big}px"><div>${money(vol)}<small>total</small></div></div>
     <div class="blob c" style="width:${mid}px;height:${mid}px"><div>${money(fvol)}<small>flagged</small></div></div>
     <div class="blob d" style="width:92px;height:92px"><div>${f.length}<small>alerts</small></div></div>`;
  $("lgVol").textContent = `Total volume (${t.length} transactions)`;
  $("lgFlag").textContent = `Flagged volume (${f.length} flagged)`;
}

function renderCal() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  $("calMonth").textContent = now.toLocaleString([], { month: "long", year: "numeric" });
  const has = new Set(), flag = new Set();
  txs.forEach((t) => { const d = new Date(t.transaction_timestamp); if (d.getFullYear() === y && d.getMonth() === m) { has.add(d.getDate()); if (riskOf(t)) flag.add(d.getDate()); } });
  let h = ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<span class="dow">${d}</span>`).join("");
  h += "<span></span>".repeat((new Date(y, m, 1).getDay() + 6) % 7);
  for (let d = 1, n = new Date(y, m + 1, 0).getDate(); d <= n; d++)
    h += `<span class="d${has.has(d) ? " y" : ""}${flag.has(d) ? " f" : ""}${d === now.getDate() ? " t" : ""}">${d}</span>`;
  $("cal").innerHTML = h;
}

function renderGauge() {
  const last = txs.map(riskOf).find(Boolean);
  const score = last ? Number(last.risk_score) : 0, cat = tone(last?.risk_category);
  $("gaugeVal").style.strokeDasharray = `${236 * score / 100} 315`;
  $("gaugeVal").style.stroke = { hi: "#f4796b", me: "#fbd449", lo: "#6dbb85" }[cat];
  $("gaugeNum").textContent = last ? score : "–";
  $("gaugeNote").textContent = last ? `${last.risk_category} risk on the latest flagged transaction` : "No flagged transactions yet";
}

function renderProgress() {
  const total = alerts.length, open = alerts.filter((a) => a.alert_status === "New").length;
  const pct = total ? Math.round(((total - open) / total) * 100) : 0;
  $("pct").textContent = pct + "%"; $("barFill").style.width = pct + "%";
  $("barOpen").textContent = `${open} open`; $("barTotal").textContent = `${total} total`;
  $("alertDot").hidden = !open;
}

function renderList() {
  const rows = txs.filter((t) => !query || `${t.transaction_id} ${acctLabel(t.source_account_id)} ${acctLabel(t.destination_account_id)} ${t.transaction_type} ${t.transaction_status} ${t.amount}`.toLowerCase().includes(query)).slice(0, 8);
  $("txList").innerHTML = rows.length ? rows.map((t) => {
    const r = riskOf(t), s = r ? Number(r.risk_score) : 0, on = Math.round((s / 100) * 12);
    return `<li class="row"><span class="av">${esc(t.transaction_type[0])}</span>
      <div class="who"><b>${esc(acctLabel(t.source_account_id))} → ${esc(acctLabel(t.destination_account_id))}</b><small>${esc(t.transaction_type)} · ${esc(t.transaction_status)} · ${fmtTime(t.transaction_timestamp)}</small></div>
      <span class="amt">${money(t.amount)}</span>
      <span class="segs ${tone(r?.risk_category)}" title="${r ? esc(r.risk_category) + " risk" : "Not flagged"}">${Array.from({ length: 12 }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("")}</span>
      <span class="sc">${r ? s : "–"}</span></li>`;
  }).join("") : `<li class="empty">${txs.length ? "No transactions match your search." : "No transactions yet. Click New transaction."}</li>`;
}

function renderAccounts() {
  const opts = accounts.length ? accounts.map((a) => `<option value="${a.account_id}">${esc(a.account_number)} – ${esc(a.customers?.full_name ?? "Unknown")}</option>`).join("") : '<option value="">No accounts yet</option>';
  $("txSource").innerHTML = opts; $("txDest").innerHTML = opts;
  if (accounts.length > 1) $("txDest").selectedIndex = 1;
  $("aCustomer").innerHTML = customers.length ? customers.map((c) => `<option value="${c.customer_id}">${esc(c.full_name)} (#${c.customer_id})</option>`).join("") : '<option value="">No customers yet</option>';
  $("acctBody").innerHTML = accounts.length ? accounts.map((a) => `<tr><td>${a.account_id}</td><td>${esc(a.account_number)}</td><td>${esc(a.customers?.full_name ?? "–")}</td><td>${esc(a.account_type)}</td><td>${esc(a.account_status)}</td></tr>`).join("") : '<tr><td colspan="5" class="empty">No accounts yet.</td></tr>';
}

function renderAlerts() {
  $("alertBody").innerHTML = alerts.length ? alerts.map((a) => `<tr><td>${a.alert_id}</td><td>${fmtTime(a.created_at)}</td><td>${a.transaction_id}</td><td class="num">${a.transactions ? money(a.transactions.amount) : "–"}</td><td><span class="chip ${tone(a.alert_priority)}">${esc(a.alert_priority)}</span></td><td>${esc(a.alert_status)}</td><td>${a.case_id ?? "–"}</td><td>${esc(a.alert_message)}</td></tr>`).join("") : '<tr><td colspan="8" class="empty">No alerts yet.</td></tr>';
}

/* ---------- submit transaction ---------- */
$("txForm").addEventListener("submit", async (e) => {
  e.preventDefault(); if (!needClient()) return;
  const err = $("txError"); err.textContent = "";
  document.querySelectorAll("#txForm .bad").forEach((x) => x.classList.remove("bad"));
  const src = Number($("txSource").value), dst = Number($("txDest").value), amt = Number($("txAmount").value);
  if (!src || !dst) return (err.textContent = "Choose both accounts. Add accounts first if the lists are empty.");
  if (src === dst) { $("txDest").classList.add("bad"); return (err.textContent = "Source and destination accounts must be different."); }
  if (!(amt > 0)) { $("txAmount").classList.add("bad"); return (err.textContent = "Enter an amount greater than 0."); }
  if (!$("txTime").value) return (err.textContent = "Choose the date and time.");

  const btn = $("txSubmit"); btn.disabled = true; btn.textContent = "Scoring…";
  const { data, error } = await sb.from("transactions").insert({
    source_account_id: src, destination_account_id: dst, amount: amt.toFixed(2),
    transaction_type: $("txType").value, transaction_timestamp: new Date($("txTime").value).toISOString(),
    transaction_status: $("txStatus").value, description: $("txDesc").value.trim() || null,
  }).select("transaction_id").single();
  btn.disabled = false; btn.textContent = "Submit and score";
  if (error) { err.textContent = error.message; return; }

  $("txForm").reset(); $("txDlg").close();
  await showResult(data.transaction_id);
  loadAll();
});

// The AFTER INSERT trigger has already written the risk rows when insert() returns.
async function showResult(id) {
  const [risk, matches, al] = await Promise.all([
    sb.from("risk_assessments").select("risk_score, risk_category").eq("transaction_id", id).order("assessment_id", { ascending: false }).limit(1),
    sb.from("transaction_rule_matches").select("observed_value, fraud_rules(rule_name, risk_points)").eq("transaction_id", id),
    sb.from("fraud_alerts").select("alert_id, alert_status, alert_message").eq("transaction_id", id),
  ]);
  const r = risk.data?.[0];
  $("resultBody").innerHTML = !r
    ? `<h2>Transaction ${id} saved</h2><p class="clear">No rule was triggered. No risk score or alert was created.</p>`
    : `<h2>Transaction ${id} scored</h2>
       <div class="res-top"><span class="res-score">${Number(r.risk_score)}</span><span class="chip ${tone(r.risk_category)}">${esc(r.risk_category)}</span></div>
       <p class="res-h">Rules triggered</p><ul class="res-list">${(matches.data || []).map((m) => `<li><span>${esc(m.fraud_rules?.rule_name ?? "Rule")}${m.observed_value != null ? ` (${esc(m.observed_value)})` : ""}</span><b>+${m.fraud_rules?.risk_points ?? "?"}</b></li>`).join("") || "<li>None recorded</li>"}</ul>
       <p class="res-h">Alerts created</p><ul class="res-list">${(al.data || []).map((a) => `<li><span>${esc(a.alert_message)}</span><b>#${a.alert_id} · ${esc(a.alert_status)}</b></li>`).join("") || "<li>None</li>"}</ul>`;
  $("resultDlg").showModal();
}

/* ---------- customers & accounts ---------- */
$("custForm").addEventListener("submit", async (e) => {
  e.preventDefault(); if (!needClient()) return;
  const err = $("custError"); err.textContent = "";
  const name = $("cName").value.trim(); if (!name) return (err.textContent = "Enter the customer's full name.");
  const { error } = await sb.from("customers").insert({ full_name: name, email: $("cEmail").value.trim() || null, phone: $("cPhone").value.trim() || null, address: $("cAddress").value.trim() || null });
  if (error) return (err.textContent = error.message);
  toast("Customer saved"); $("custForm").reset(); loadAll();
});
$("acctForm").addEventListener("submit", async (e) => {
  e.preventDefault(); if (!needClient()) return;
  const err = $("acctError"); err.textContent = "";
  const cid = Number($("aCustomer").value), num = $("aNumber").value.trim();
  if (!cid) return (err.textContent = "Choose a customer. Add one first if the list is empty.");
  if (!num) return (err.textContent = "Enter an account number.");
  const { error } = await sb.from("accounts").insert({ customer_id: cid, account_number: num, account_type: $("aType").value, account_status: $("aStatus").value });
  if (error) return (err.textContent = error.code === "23505" ? "That account number already exists." : error.message);
  toast("Account opened"); $("aNumber").value = ""; loadAll();
});

/* ---------- investigations ---------- */
const dbErr = (e) => (e.code === "42501" ? "Blocked by row-level security. Add a policy that allows this action on the table in Supabase." : e.message);
const userName = (id) => users.find((u) => u.user_id === id)?.full_name ?? "Unassigned";
const userOpts = (blank) => (blank ? '<option value="">Unassigned</option>' : "") + users.map((u) => `<option value="${u.user_id}">${esc(u.full_name)} (${esc(u.role)})</option>`).join("");

function renderCases() {
  const cur = $("actor").value || localStorage.getItem("fw_actor");
  $("actor").innerHTML = users.length ? userOpts(false) : '<option value="">No users found</option>';
  if (cur && users.some((u) => u.user_id === cur)) $("actor").value = cur;
  $("actorNote").textContent = users.length ? "Notes and evidence are saved under this user." : "Add a row to the users table first. Notes and evidence need one.";
  $("caseAssign").innerHTML = userOpts(true);

  const queue = alerts.filter((a) => !a.case_id && a.alert_status === "New");
  $("queueCount").textContent = `${queue.length} waiting`;
  $("queue").innerHTML = queue.length ? queue.map((a) => `<li class="qi"><div class="who"><b>Alert #${a.alert_id} · Txn ${a.transaction_id}</b><small>${a.transactions ? money(a.transactions.amount) : "–"} · ${esc(a.alert_message)}</small></div>
    <span class="chip ${tone(a.alert_priority)}">${esc(a.alert_priority)}</span>
    <button class="btn mini dark" data-open="${a.alert_id}">Investigate</button><button class="btn mini ghost" data-dismiss="${a.alert_id}">Dismiss</button></li>`).join("")
    : '<li class="empty">No alerts waiting. New flagged transactions show up here.</li>';

  $("caseCount").textContent = `${cases.length} total`;
  $("caseList").innerHTML = cases.length ? cases.map((c) => `<li class="qi${c.case_id === openCaseId ? " on" : ""}" data-case="${c.case_id}" tabindex="0"><div class="who"><b>Case #${c.case_id} · ${esc(c.case_title)}</b><small>${esc(c.case_status)} · ${esc(userName(c.assigned_to))} · ${fmtTime(c.created_at)}</small></div><span class="chip ${tone(c.case_priority)}">${esc(c.case_priority)}</span></li>`).join("")
    : '<li class="empty">No cases yet. Investigate an alert to open the first one.</li>';
}
$("actor").onchange = (e) => localStorage.setItem("fw_actor", e.target.value);

$("queue").addEventListener("click", async (e) => {
  const o = e.target.closest("[data-open]"), d = e.target.closest("[data-dismiss]");
  if (o) {
    const a = alerts.find((x) => x.alert_id === Number(o.dataset.open)); pendingAlert = a;
    $("caseFor").textContent = `For alert #${a.alert_id} on transaction ${a.transaction_id}`;
    $("caseTitle").value = `Investigate transaction ${a.transaction_id}`; $("caseDesc").value = a.alert_message;
    const p = String(a.alert_priority); $("casePrio").value = ["Low", "Medium", "High", "Critical"].includes(p) ? p : "Medium";
    $("caseError").textContent = ""; $("caseDlg").showModal();
  }
  if (d && confirm("Dismiss this alert as a false positive? No case will be opened.")) {
    const { error } = await sb.from("fraud_alerts").update({ alert_status: "Dismissed" }).eq("alert_id", Number(d.dataset.dismiss));
    if (error) return toast(dbErr(error), true);
    toast("Alert dismissed"); loadAll();
  }
});

$("caseForm").addEventListener("submit", async (e) => {
  e.preventDefault(); const err = $("caseError"); err.textContent = "";
  const title = $("caseTitle").value.trim(); if (!title) return (err.textContent = "Enter a case title.");
  const btn = $("caseSubmit"); btn.disabled = true;
  const { data: c, error } = await sb.from("investigation_cases").insert({
    case_title: title, case_description: $("caseDesc").value.trim() || null, case_priority: $("casePrio").value,
    case_status: "Open", assigned_to: $("caseAssign").value || null,
  }).select("case_id").single();
  if (error) { btn.disabled = false; return (err.textContent = dbErr(error)); }
  const link = await sb.from("case_transactions").insert({ case_id: c.case_id, transaction_id: pendingAlert.transaction_id, relationship_type: "Flagged transaction" });
  const upd = await sb.from("fraud_alerts").update({ case_id: c.case_id, alert_status: "Investigating" }).eq("alert_id", pendingAlert.alert_id);
  btn.disabled = false;
  if (link.error || upd.error) toast("Case created, but linking failed: " + dbErr(link.error || upd.error), true); else toast(`Case #${c.case_id} opened`);
  $("caseDlg").close(); openCaseId = c.case_id; await loadAll();
});

$("caseList").addEventListener("click", (e) => { const li = e.target.closest("[data-case]"); if (li) { openCaseId = Number(li.dataset.case); renderCases(); loadDetail(); } });
$("caseList").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.click(); });

async function loadDetail() {
  const id = openCaseId, box = $("caseDetail"), c = cases.find((x) => x.case_id === id);
  if (!c) { box.hidden = true; return; }
  box.hidden = false;
  const [ct, notes, ev] = await Promise.all([
    sb.from("case_transactions").select("transaction_id, relationship_type, transactions(amount, transaction_type, transaction_status, source_account_id, destination_account_id)").eq("case_id", id),
    sb.from("investigation_notes").select("note_id, note_text, created_at, users(full_name)").eq("case_id", id).order("created_at", { ascending: false }),
    sb.from("case_evidence").select("evidence_id, evidence_title, evidence_description, file_path, created_at, users(full_name)").eq("case_id", id).order("created_at", { ascending: false }),
  ]);
  const ids = (ct.data || []).map((x) => x.transaction_id);
  const rules = ids.length ? await sb.from("transaction_rule_matches").select("transaction_id, observed_value, fraud_rules(rule_name, risk_points)").in("transaction_id", ids) : { data: [] };
  const bad = [ct, notes, ev, rules].find((r) => r.error);
  if (bad) { box.innerHTML = `<p class="err">${esc(dbErr(bad.error))}</p>`; return; }

  const done = c.case_status === "Resolved";
  box.innerHTML = `
    <div class="dhead"><h2>Case #${c.case_id} · ${esc(c.case_title)}</h2><span class="chip ${tone(c.case_priority)}">${esc(c.case_priority)}</span><span class="chip">${esc(c.case_status)}</span></div>
    <p class="muted">${esc(c.case_description || "No description.")} · Assigned to ${esc(userName(c.assigned_to))} · Opened ${fmtTime(c.created_at)}</p>
    <div class="dgrid"><div>
      <h3>Related transactions</h3>${(ct.data || []).map((x) => { const t = x.transactions; return `<div class="item"><b>Txn ${x.transaction_id}</b> · ${t ? money(t.amount) : "–"}<small>${t ? `${esc(acctLabel(t.source_account_id))} → ${esc(acctLabel(t.destination_account_id))} · ${esc(t.transaction_type)} · ${esc(t.transaction_status)}` : ""} · ${esc(x.relationship_type || "")}</small></div>`; }).join("") || '<p class="muted">None linked.</p>'}
      <h3>Rules triggered</h3>${(rules.data || []).map((m) => `<div class="item">${esc(m.fraud_rules?.rule_name ?? "Rule")} <b>+${m.fraud_rules?.risk_points ?? "?"}</b><small>Txn ${m.transaction_id}${m.observed_value != null ? ` · observed ${esc(m.observed_value)}` : ""}</small></div>`).join("") || '<p class="muted">No rule matches recorded.</p>'}
      <h3>Resolution</h3>${done ? `<div class="item"><b>${esc(c.resolution_outcome)}</b><small>${esc(c.resolution_notes || "")} · ${fmtTime(c.resolved_at)}</small></div>` : `
      <div class="iform"><select id="resOutcome"><option>Fraudulent</option><option>Legitimate</option></select><textarea id="resNotes" rows="2" placeholder="Resolution notes"></textarea><button class="btn dark mini" id="resBtn">Resolve case</button></div>`}
    </div><div>
      <h3>Notes</h3><div class="iform"><textarea id="noteText" rows="2" placeholder="Add a note or finding"></textarea><button class="btn dark mini" id="noteBtn">Save note</button></div>
      ${(notes.data || []).map((n) => `<div class="item">${esc(n.note_text)}<small>${esc(n.users?.full_name ?? "")} · ${fmtTime(n.created_at)}</small></div>`).join("") || '<p class="muted">No notes yet.</p>'}
      <h3>Evidence</h3><div class="iform"><input id="evTitle" maxlength="150" placeholder="Evidence title"><textarea id="evDesc" rows="2" placeholder="Description (optional)"></textarea><input id="evFile" type="file"><button class="btn dark mini" id="evBtn">Save evidence</button></div>
      ${(ev.data || []).map((x) => `<div class="item"><b>${esc(x.evidence_title)}</b> ${x.file_path ? `<button class="link" data-file="${esc(x.file_path)}">Open file</button>` : ""}<small>${esc(x.evidence_description || "")} ${esc(x.users?.full_name ?? "")} · ${fmtTime(x.created_at)}</small></div>`).join("") || '<p class="muted">No evidence yet.</p>'}
    </div></div>`;

  const uid = () => { const v = $("actor").value; if (!v) toast("Choose a user in Working as first.", true); return v; };
  $("noteBtn").onclick = async () => {
    const text = $("noteText").value.trim(), u = uid(); if (!u) return; if (!text) return toast("Write a note first.", true);
    const { error } = await sb.from("investigation_notes").insert({ case_id: id, user_id: u, note_text: text });
    if (error) return toast(dbErr(error), true); toast("Note saved"); loadDetail();
  };
  $("evBtn").onclick = async () => {
    const title = $("evTitle").value.trim(), u = uid(); if (!u) return; if (!title) return toast("Give the evidence a title.", true);
    let path = null; const f = $("evFile").files[0];
    if (f) {
      path = `${id}/${Date.now()}-${f.name.replace(/[^\w.\-]/g, "_")}`;
      const up = await sb.storage.from("evidence").upload(path, f);
      if (up.error) return toast("File upload failed: " + up.error.message + ". Create a Storage bucket named evidence.", true);
    }
    const { error } = await sb.from("case_evidence").insert({ case_id: id, uploaded_by: u, evidence_title: title, evidence_description: $("evDesc").value.trim() || null, file_path: path });
    if (error) return toast(dbErr(error), true); toast("Evidence saved"); loadDetail();
  };
  if (!done) $("resBtn").onclick = async () => {
    const outcome = $("resOutcome").value;
    const { error } = await sb.from("investigation_cases").update({ case_status: "Resolved", resolution_outcome: outcome, resolution_notes: $("resNotes").value.trim() || null, resolved_at: new Date().toISOString() }).eq("case_id", id);
    if (error) return toast(dbErr(error), true);
    await sb.from("fraud_alerts").update({ alert_status: outcome === "Fraudulent" ? "Confirmed fraud" : "Closed" }).eq("case_id", id);
    toast("Case resolved"); loadAll();
  };
}
$("caseDetail").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-file]"); if (!b) return;
  const { data, error } = await sb.storage.from("evidence").createSignedUrl(b.dataset.file, 120);
  if (error) return toast(error.message, true); window.open(data.signedUrl, "_blank");
});

/* ---------- boot ---------- */
(() => {
  const c = JSON.parse(localStorage.getItem("fw_cfg") || "{}"), url = c.url || DEFAULT_URL, key = c.key || DEFAULT_KEY;
  if (url && key) connect(url, key); else $("settings").showModal();
})();