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
let sb = null, accounts = [], customers = [], txs = [], alerts = [], query = "";
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
  ]);
  const bad = res.find((r) => r.error);
  if (bad) return toast(bad.error.message, true);
  [customers, accounts, txs, alerts] = res.map((r) => r.data);
  render();
}

/* ---------- render ---------- */
function render() { renderBubbles(); renderCal(); renderGauge(); renderProgress(); renderList(); renderAccounts(); renderAlerts(); }

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

/* ---------- boot ---------- */
(() => {
  const c = JSON.parse(localStorage.getItem("fw_cfg") || "{}"), url = c.url || DEFAULT_URL, key = c.key || DEFAULT_KEY;
  if (url && key) connect(url, key); else $("settings").showModal();
})();