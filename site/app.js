(function () {
"use strict";

var CFG = window.WISHLIST_CONFIG || {};
var POLL_MS = 30000;
var app = document.getElementById("app");
var toastEl = document.getElementById("toast");

/* ---------- state ---------- */
var sb = null;
var phase = "loading";          // loading | setup | signin | name | error | ready
var session = null;
var authStep = "email";         // email | code
var authEmail = "", authCode = "", authMsg = "", authDetail = "", authBusy = false;
var loadDetail = "";
var myEmail = null, myId = null, myName = "";   // myId is only ever shown back to its owner
var dashTab = "active";          // active | archived
var joinCode = "", joinInfo = null, joinChecked = false;   // from an invite link (?join=CODE)
var groups = [], groupsSig = "";
var route = { name: "dashboard" };   // dashboard | new | join | group {id, view}
var gd = null;                  // data for the open group
var editor = null;
var ui = {};
var lastDataSig = "";
var pollTimer = null;
var toastTimer = null;
var leaveWarned = false;

/* ---------- helpers ---------- */
function h(tag, attrs) {
  var el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "value") el.value = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
  }
  for (var i = 2; i < arguments.length; i++) {
    var kids = [].concat(arguments[i]);
    for (var j = 0; j < kids.length; j++) {
      var kid = kids[j];
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
  }
  return el;
}
var ICONS = {
  lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  ext: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>'
};
function icon(name) { var s = h("span", { "aria-hidden": "true", style: "display:inline-flex" }); s.innerHTML = ICONS[name]; return s; }

function nameOf(id) {
  if (gd) { var p = gd.names.get(id); if (p) return p; }
  if (id === myId && myName) return myName;
  return "Someone";
}
function possessive(id) { return nameOf(id) + "’s"; }
function colorIndex(id) {
  var n = 0; for (var i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return n % 8;
}
function avatar(id, size) {
  return h("span", { class: "avatar s-" + size, style: "--mc:var(--m-" + colorIndex(id || "?") + ")", "aria-hidden": "true", text: (nameOf(id).charAt(0) || "?").toUpperCase() });
}
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3600);
}
function rid() { return "n" + Math.random().toString(36).slice(2, 10); }
function blank() { return { id: null, key: rid(), name: "", description: "", link: "", qty: "1", unlimited: false, price: "", asOf: "", image: "", autoPrice: false, looked: "" }; }
function normLink(s) {
  s = (s || "").trim(); if (!s) return "";
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) s = "https://" + s;
  try {
    var u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.hostname.indexOf(".") < 0) return null;
    return u.href;
  } catch (e) { return null; }
}
function host(l) { try { return new URL(l).hostname.replace(/^www\./, ""); } catch (e) { return "link"; } }
function parseDay(s) { var p = String(s).slice(0, 10).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function fmtDay(s) {
  var d = String(s).length > 10 ? new Date(s) : parseDay(s);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function todayStr() {
  var n = new Date();
  return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0");
}
function dateHasPassed(s) { return daysUntil(s) < 0; }
function daysUntil(s) {
  var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseDay(s) - today) / 864e5);
}
function countdownText(s) {
  var d = daysUntil(s);
  if (d > 1) return d + " days to go";
  if (d === 1) return "1 day to go";
  if (d === 0) return "Today!";
  return "Event has passed";
}
function toCents(n) { return Math.round(Number(n) * 100); }
function fmtMoney(cents) {
  return "$" + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
function humanize(err) {
  var m = (err && err.message) || "";
  if (/at least \d+ items|archived|only the group admin|not valid any more|can.t remove yourself|not in this group|reopen it|has passed|has already passed|person the list is for|event name|wishlist|up to 50 lists|not in this wishlist|not yours to change|up to 20 lists|can only be added|add your name|already been fully claimed|group name|item minimum|event date|name up to/i.test(m)) return m.replace(/^ERROR:\s*/, "");
  if (/jwt|expired|not authenticated/i.test(m)) return "You were signed out. Sign in again to keep going.";
  if (/fetch|network|failed to/i.test(m)) return "Couldn’t reach the server. Check your connection and try again.";
  if (/row-level security|permission denied/i.test(m)) return "That isn’t allowed. The group may have been archived.";
  return "Couldn’t save that. Try again in a moment.";
}
async function api(promise) {
  var r = await promise;
  if (r.error) throw r.error;
  return r.data;
}

/* ---------- data ---------- */
function groupInfo() { return route.id ? groups.find(function (g) { return g.group_id === route.id; }) : null; }
function minItems() { var g = groupInfo(); return g ? g.item_min : 3; }
// Can I edit this person's list? The wishlist admin can on any list in a wishlist; in a normal group, the member who made it can.
function canManageList(m) {
  return !!(gd && gd.recipients.has(m) && ((isRegistry() && isAdmin()) || gd.managedBy.get(m) === myId));
}
function editingOwner() { return route.view && route.view.indexOf("edit:") === 0 ? route.view.slice(5) : myId; }
function isArchived() { var g = groupInfo(); return !!(g && g.archived_at); }
function isAdmin() { var g = groupInfo(); return !!(g && g.is_admin); }
function isRegistry() { var g = groupInfo(); return !!(g && g.kind === "registry"); }   // a one-way wishlist

async function loadGroups() {
  // Groups whose event date has passed archive themselves; do it before reading so every screen agrees.
  try { await sb.rpc("sweep_archives"); } catch (e) { /* older database: ignore */ }
  groups = (await api(sb.rpc("my_groups"))) || [];
  var s = JSON.stringify(groups), changed = s !== groupsSig;
  groupsSig = s;
  return changed;
}
async function loadGroup() {
  var id = route.id;
  var res = await Promise.all([
    sb.from("group_members").select("member_id,is_recipient,managed_by").eq("group_id", id),
    sb.from("profiles").select("id,name"),
    sb.from("wish_lists").select("owner,submitted_at").eq("group_id", id),
    sb.from("wish_items").select("id,owner,name,description,link,image_url,price,price_as_of,quantity,position,created_at").eq("group_id", id).order("position").order("created_at"),
    sb.from("claims").select("item_id,buyer"),
    sb.from("claim_prices").select("item_id,amount"),
    isAdmin() ? sb.from("group_invites").select("code").eq("group_id", id) : Promise.resolve({ data: [] }),
    sb.from("claim_details").select("item_id,note,tracking_url,arrived")
  ]);
  for (var i = 0; i < res.length; i++) if (res[i].error) throw res[i].error;
  var names = new Map((res[1].data || []).map(function (p) { return [p.id, p.name]; }));
  var byName = function (a, b) { return (names.get(a) || a).localeCompare(names.get(b) || b); };
  var allIds = (res[0].data || []).map(function (m) { return m.member_id; }).sort(byName);
  var recipients = new Set((res[0].data || []).filter(function (m) { return m.is_recipient; }).map(function (m) { return m.member_id; }));
  // In a one-way wishlist the "members" the screens loop over are the lists (the people wishes are for);
  // everyone else is a viewer.
  var memberIds = isRegistry() ? allIds.filter(function (m) { return recipients.has(m); }) : allIds;
  var items = new Map();
  (res[3].data || []).forEach(function (it) {
    if (!items.has(it.owner)) items.set(it.owner, []);
    items.get(it.owner).push(it);
  });
  var known = new Set((res[3].data || []).map(function (it) { return it.id; }));
  var claimers = new Map();
  (res[4].data || []).forEach(function (c) {
    if (!known.has(c.item_id)) return;
    if (!claimers.has(c.item_id)) claimers.set(c.item_id, []);
    claimers.get(c.item_id).push(c.buyer);
  });
  claimers.forEach(function (list) { list.sort(function (a, b) { return nameOf2(names, a).localeCompare(nameOf2(names, b)); }); });
  var next = {
    id: id, members: memberIds, names: names, everyone: allIds, recipients: recipients,
    managedBy: new Map((res[0].data || []).filter(function (m) { return m.managed_by; }).map(function (m) { return [m.member_id, m.managed_by]; })),
    details: new Map((res[7].data || []).filter(function (r) { return known.has(r.item_id); }).map(function (r) {
      return [r.item_id, { note: r.note || "", tracking_url: r.tracking_url || "", arrived: !!r.arrived }];
    })),
    listMeta: new Map((res[2].data || []).map(function (r) { return [r.owner, r]; })),
    items: items, claimers: claimers,
    code: (res[6].data && res[6].data[0] && res[6].data[0].code) || "",
    paid: new Map((res[5].data || []).filter(function (r) { return known.has(r.item_id); }).map(function (r) { return [r.item_id, Number(r.amount)]; }))
  };
  var s = JSON.stringify([memberIds, allIds, Array.from(names), Array.from(next.listMeta), Array.from(items), Array.from(claimers), next.code, Array.from(next.paid), Array.from(next.details), Array.from(next.managedBy)]);
  var changed = s !== lastDataSig;
  lastDataSig = s;
  gd = next;
  return changed;
}
function nameOf2(names, id) { return names.get(id) || ""; }

function listFor(email) {
  var lm = gd.listMeta.get(email), items = gd.items.get(email) || [];
  if ((isRegistry() || (lm && lm.submitted_at)) && items.length) return { state: "ready", items: items };
  return { state: "pending", items: [] };
}
function claimersOf(item) { return gd.claimers.get(item.id) || []; }
function iBought(item) { return claimersOf(item).indexOf(myId) >= 0; }
function isFull(item) { return item.quantity !== null && claimersOf(item).length >= item.quantity; }

/* ---------- auth ---------- */
function detailOf(err) {
  if (!err) return "";
  var parts = [];
  if (err.message) parts.push(err.message);
  if (err.code) parts.push("code " + err.code);
  else if (err.status) parts.push("status " + err.status);
  return parts.join(" · ").slice(0, 300);
}
function sendError(err) {
  var m = (err && err.message) || "";
  if (/rate|seconds|too many/i.test(m)) return "Please wait a minute before asking for another code.";
  if (/api key|apikey/i.test(m)) return "The site’s database key looks wrong. Check SUPABASE_ANON_KEY in config.js.";
  if (/sending|smtp|mail/i.test(m)) return "The email couldn’t be sent. Check the email (SMTP) settings in Supabase.";
  if (/fetch|network|failed to/i.test(m)) return "Couldn’t reach the server. Check your connection and the project URL in config.js.";
  return "Couldn’t send the code. See the details below.";
}
function verifyError(err) {
  var m = (err && err.message) || "";
  if (/rate|seconds|too many/i.test(m)) return "Too many tries. Wait a minute, then try again.";
  if (/api key|apikey/i.test(m)) return "The site’s database key looks wrong. Check SUPABASE_ANON_KEY in config.js.";
  if (/fetch|network|failed to/i.test(m)) return "Couldn’t reach the server. Check your connection.";
  if (/invalid|expired|token/i.test(m)) return "That code didn’t work. Check it, or ask for a new one.";
  return "Couldn’t check the code. See the details below.";
}
async function sendCode() {
  var email = authEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { authMsg = "Enter a valid email address."; renderAuth(); return; }
  authEmail = email; authBusy = true; authMsg = ""; authDetail = ""; renderAuth();
  var r;
  try { r = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } }); }
  catch (e) { r = { error: { message: (e && e.message) || "Failed to fetch" } }; }
  authBusy = false;
  if (r.error) { authMsg = sendError(r.error); authDetail = detailOf(r.error); renderAuth(); return; }
  authStep = "code"; authCode = ""; authMsg = ""; authDetail = ""; renderAuth();
}
async function verifyCode() {
  var code = authCode.replace(/\s+/g, "");
  if (code.length < 6) { authMsg = "Enter the 6-digit code from the email."; renderAuth(); return; }
  authBusy = true; authMsg = ""; authDetail = ""; renderAuth();
  var r;
  try { r = await sb.auth.verifyOtp({ email: authEmail, token: code, type: "email" }); }
  catch (e) { r = { error: { message: (e && e.message) || "Failed to fetch" } }; }
  authBusy = false;
  if (r.error || !r.data || !r.data.session) {
    var failure = r.error || { message: "No session was returned" };
    authMsg = verifyError(failure); authDetail = detailOf(failure); renderAuth(); return;
  }
  session = r.data.session;
  await enter();
}
async function signOut() {
  stopPolling();
  try { await sb.auth.signOut(); } catch (e) { /* the local session is cleared either way */ }
  resetSession();
  phase = "signin"; authStep = "email"; authCode = ""; authMsg = ""; authDetail = "";
  render();
}
function resetSession() {
  session = null; myEmail = null; myId = null; myName = ""; groups = []; groupsSig = ""; gd = null;
  editor = null; route = { name: "dashboard" }; lastDataSig = "";
}

/* ---------- entering the app ---------- */
async function checkJoinLink() {
  if (!joinCode || joinChecked) return;
  joinChecked = true;
  try {
    var rows = await api(sb.rpc("preview_invite", { p_code: joinCode }));
    joinInfo = rows && rows[0] ? rows[0] : null;
  } catch (e) { joinInfo = null; }
}
async function enter() {
  phase = "loading"; loadDetail = ""; render();
  try {
    myEmail = await api(sb.rpc("me"));
    if (!myEmail) throw { message: "JWT expired" };
    await checkJoinLink();
    var prof = await api(sb.rpc("my_profile"));
    myId = prof && prof[0] ? prof[0].id : null;
    myName = prof && prof[0] ? prof[0].name : "";
    if (!myName) { phase = "name"; render(); return; }
    await loadGroups();
    editor = null; gd = null;
    route = joinCode ? { name: "join" } : { name: "dashboard" };
    phase = "ready";
    render();
    startPolling();
  } catch (e) {
    if (/jwt|expired|not authenticated/i.test((e && e.message) || "")) { await signOut(); return; }
    loadDetail = detailOf(e) || String(e);
    phase = "error"; render();
  }
}
function startPolling() {
  stopPolling();
  pollTimer = setInterval(poll, POLL_MS);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
async function poll() {
  if (phase !== "ready" || document.visibilityState !== "visible") return;
  try {
    var wasArchived = isArchived();
    var gch = await loadGroups();
    if (route.name === "dashboard") { if (gch) renderMain(); return; }
    if (route.name === "group") {
      if (!groupInfo()) {   // the admin removed me from this group
        editor = null; gd = null; lastDataSig = "";
        route = { name: "dashboard" }; dashTab = "active";
        renderMain(); toast("You’re no longer in that group.");
        return;
      }
      if (!wasArchived && isArchived()) {   // its event date passed (or the admin archived it)
        editor = null;
        await loadGroup(); renderMain();
        toast("This group has been archived, so it is now view-only.");
        return;
      }
      var ch = await loadGroup();
      if (!ch && !gch) return;
      updateTabs();
      var typing = document.activeElement && document.activeElement.closest && document.activeElement.closest("#d-form, #lists-card, #new-list-form, .buyitem");
      if (route.view !== "my" && route.view.indexOf("edit:") !== 0 && !typing) renderPanel();   // never rebuild the editor while someone is typing
    }
  } catch (e) { /* keep showing what we have; the next poll retries */ }
}
document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") poll(); });

/* ---------- navigation ---------- */
function leaveGuard() {
  if (route.name === "group" && editorDirty() && !leaveWarned) {
    leaveWarned = true;
    toast("You have unsaved changes. Tap again to leave without saving.");
    return false;
  }
  leaveWarned = false;
  return true;
}
async function goDashboard() {
  if (!leaveGuard()) return;
  var leaving = groupInfo();
  dashTab = leaving && leaving.archived_at ? "archived" : "active";
  editor = null; gd = null; lastDataSig = "";
  route = { name: "dashboard" };
  try { await loadGroups(); } catch (e) { /* show what we have */ }
  renderMain();
  window.scrollTo({ top: 0 });
}
async function openGroup(id, view) {
  editor = null; gd = null; lastDataSig = "";
  route = { name: "group", id: id, view: view || "my" };
  ui.loadingGroup = true; renderMain();
  try {
    await loadGroups();
    if (!groupInfo()) { route = { name: "dashboard" }; renderMain(); toast("That group isn’t available."); return; }
    // Land on my list while it still needs filling out; once it's shared, start on everyone's lists.
    if (!view) { var gi = groupInfo(); route.view = isRegistry() || (gi && gi.list_submitted) ? "members" : "my"; }
    await loadGroup();
  } catch (e) { toast(humanize(e)); route = { name: "dashboard" }; renderMain(); return; }
  ui.loadingGroup = false;
  renderMain();
  window.scrollTo({ top: 0 });
}

/* ---------- editor model ---------- */
function isBlankRow(it) { return !it.name.trim() && !it.description.trim() && !it.link.trim(); }
function parseQty(it) {
  if (it.unlimited) return { ok: true, value: null };
  var s = String(it.qty == null ? "" : it.qty).trim();
  if (s === "") return { ok: true, value: 1 };
  var n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 9999) return { ok: false, value: 1 };
  return { ok: true, value: n };
}
function cleanItems() {
  var complete = [], problems = 0;
  editor.items.forEach(function (it) {
    if (isBlankRow(it)) return;
    var n = it.name.trim(), d = it.description.trim(), nl = normLink(it.link), q = parseQty(it);
    var pr = (it.price || "").trim();
    if (n && d && nl !== null && q.ok && pr.length <= 60) complete.push({ id: it.id, name: n, description: d, link: nl, quantity: q.value, price: pr, asOf: pr ? (it.asOf || "") : "", image: it.image || "", ref: it }); else problems++;
  });
  return { complete: complete, problems: problems };
}
function sig(list) { return JSON.stringify(list.map(function (i) { return [i.id, i.name, i.description, i.link || "", i.quantity, i.price || "", i.asOf || "", i.image || ""]; })); }
function startBlanks() { return Math.min(minItems(), 3); }
function initEditor(owner) {
  owner = owner || myId;
  var reg = owner !== myId;   // a list I manage for someone else: always live, no minimum
  var mine = (gd && gd.items.get(owner)) || [];
  var lm = gd && gd.listMeta.get(owner);
  var submitted = reg || !!(lm && lm.submitted_at);
  var items = mine.map(function (i) {
    return { id: i.id, key: i.id, name: i.name, description: i.description, link: i.link || "",
      qty: i.quantity === null ? "1" : String(i.quantity), unlimited: i.quantity === null,
      price: i.price || "", asOf: i.price_as_of || "", image: i.image_url || "", autoPrice: false, looked: i.link || "" };
  });
  while (!submitted && items.length < startBlanks()) items.push(blank());
  if (items.length === 0) items.push(blank());
  editor = { owner: owner, registry: reg, items: items, submitted: submitted, saving: false, showErrors: false, baseSig: "" };
  editor.baseSig = sig(cleanItems().complete);
}
function editorDirty() {
  if (!editor || route.name !== "group") return false;
  var r = cleanItems();
  return sig(r.complete) !== editor.baseSig || r.problems > 0;
}
window.addEventListener("beforeunload", function (e) {
  if (phase === "ready" && editorDirty()) { e.preventDefault(); e.returnValue = ""; }
});

async function persistItems(complete) {
  var server = (gd.items.get(editor.owner)) || [];
  var keep = new Set(complete.filter(function (c) { return c.id; }).map(function (c) { return c.id; }));
  var r, i;
  for (i = 0; i < complete.length; i++) {
    var c = complete[i];
    if (!c.id) continue;
    r = await sb.from("wish_items").update({ name: c.name, description: c.description, link: c.link || null, quantity: c.quantity, position: i, price: c.price || null, price_as_of: c.asOf || null, image_url: c.image || null }).eq("id", c.id);
    if (r.error) throw r.error;
  }
  var fresh = [];
  complete.forEach(function (c, idx) { if (!c.id) fresh.push({ idx: idx, c: c }); });
  if (fresh.length) {
    r = await sb.from("wish_items").insert(fresh.map(function (f) {
      return { group_id: route.id, owner: editor.owner, name: f.c.name, description: f.c.description, link: f.c.link || null, quantity: f.c.quantity, position: f.idx, price: f.c.price || null, price_as_of: f.c.asOf || null, image_url: f.c.image || null };
    })).select("id,position");
    if (r.error) throw r.error;
    (r.data || []).forEach(function (row) {
      var f = fresh.find(function (x) { return x.idx === row.position; });
      if (f) f.c.ref.id = row.id;
    });
  }
  // Remove last, so a submitted list never dips below the minimum on the way.
  for (i = 0; i < server.length; i++) {
    if (!keep.has(server[i].id)) {
      r = await sb.from("wish_items").delete().eq("id", server[i].id);
      if (r.error) throw r.error;
    }
  }
}
async function afterSave() {
  await loadGroup();
  editor.items = editor.items.filter(function (it) { return !isBlankRow(it); });
  var lm = gd.listMeta.get(editor.owner);
  editor.submitted = editor.registry || !!(lm && lm.submitted_at);
  while (!editor.submitted && editor.items.length < startBlanks()) editor.items.push(blank());
  if (editor.items.length === 0) editor.items.push(blank());
  editor.baseSig = sig(cleanItems().complete);
}
async function saveDraft() {
  var r = cleanItems();
  editor.showErrors = true;
  if (r.complete.length === 0) { rebuildItems(); updateBar(); toast("Add a name and description to at least one item first."); return; }
  editor.saving = true; updateBar();
  try {
    await persistItems(r.complete);
    await afterSave();
    toast(r.problems ? "Draft saved. " + r.problems + (r.problems === 1 ? " unfinished item was" : " unfinished items were") + " left out." : "Draft saved. Nobody else can see it yet.");
  } catch (e) { toast(humanize(e)); }
  editor.saving = false;
  renderPanel(); updateTabs();
}
async function submitList() {
  var r = cleanItems();
  editor.showErrors = true;
  if (r.problems > 0 || (!editor.registry && r.complete.length < minItems())) { rebuildItems(); updateBar(); return; }
  var first = !editor.submitted;
  editor.saving = true; updateBar();
  try {
    await persistItems(r.complete);
    if (first) await api(sb.rpc("submit_list", { p_group: route.id }));
    // A list made for someone else: the first time it has items, the rest of the group is emailed once.
    var announced = false;
    if (editor.owner !== myId && !isRegistry() && r.complete.length) {
      try { announced = (await api(sb.rpc("announce_child_list", { p_group: route.id, p_member: editor.owner }))) === true; } catch (e) { announced = false; }
    }
    editor.showErrors = false;
    await afterSave();
    await loadGroups();
    toast(first ? "Your list is live. The group has been emailed." : announced ? "Saved. The group has been emailed about " + possessive(editor.owner) + " list." : "Changes saved.");
  } catch (e) { toast(humanize(e)); }
  editor.saving = false;
  renderPanel(); updateTabs();
}
// The price the owner listed ("$24.99", "€49.50 as of ...") as a number, or null when there isn't one.
function listedPrice(item) {
  var m = /\d[\d.,]*/.exec(item.price || "");
  if (!m) return null;
  var t = m[0].replace(/[.,]+$/, "");
  if (/,\d{1,2}$/.test(t) && !/\.\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  var n = Number(t);
  return isFinite(n) && n > 0 && n < 10000000 ? toCents(n) / 100 : null;
}
// What I paid: what I saved, otherwise the listed price.
function paidAmount(item) {
  if (gd.paid.has(item.id)) return gd.paid.get(item.id);
  return listedPrice(item);
}
async function savePaid(item, input) {
  var raw = input.value.trim();
  var had = gd.paid.has(item.id);
  function shown() { var v = paidAmount(item); return v === null ? "" : v.toFixed(2); }
  function revert() { input.value = shown(); }
  if (isArchived()) { toast("This group is archived, so nothing can be changed."); revert(); return; }
  try {
    if (raw === "") {
      if (!had) { input.value = shown(); return; }
      await api(sb.from("claim_prices").delete().eq("item_id", item.id).eq("buyer", myId));
      gd.paid.delete(item.id);
      input.value = shown();    // back to the listed price, if there is one
    } else {
      var n = Number(raw);
      if (!isFinite(n) || n < 0 || n >= 10000000) { toast("Enter the amount you paid, like 24.99."); revert(); return; }
      n = toCents(n) / 100;
      if (had && gd.paid.get(item.id) === n) { input.value = n.toFixed(2); return; }
      await api(sb.from("claim_prices").upsert({ item_id: item.id, buyer: myId, amount: n }));
      gd.paid.set(item.id, n);
      input.value = n.toFixed(2);
    }
    toast("Price saved. Only you can see it.");
    if (route.view === "purchases") renderPanel();
  } catch (e) { toast(humanize(e)); revert(); }
}
function paidInput(item) {
  var frozen = isArchived();
  var input = h("input", { type: "number", min: "0", step: "0.01", inputmode: "decimal", placeholder: "0.00", class: "paid-input", "data-paid": item.name,
    "aria-label": "Price you paid for " + item.name, disabled: frozen ? true : null,
    value: paidAmount(item) === null ? "" : paidAmount(item).toFixed(2) });
  if (!gd.paid.has(item.id) && listedPrice(item) !== null) input.title = "Filled in from the listed price. Change it if you paid something different.";
  input.addEventListener("change", function () { savePaid(item, input); });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  return h("label", { class: "paid", title: "Only you can see what you paid" }, "Paid $", input);
}
/* purchase details: a private note, a tracking link, and whether it has arrived */
function purchaseDetail(item) { return gd.details.get(item.id) || { note: "", tracking_url: "", arrived: false }; }
function statusOf(item) {
  var d = purchaseDetail(item);
  if (d.arrived) return { key: "arrived", label: "In hand", cls: "chip" };
  if (d.tracking_url) return { key: "shipped", label: "On its way", cls: "chip gold" };
  return { key: "ordered", label: "Purchased", cls: "chip grey" };
}
function storeOf(item) { return item.link ? host(item.link) : ""; }
async function saveDetail(item, field, value) {
  var cur = purchaseDetail(item), next = { note: cur.note, tracking_url: cur.tracking_url, arrived: cur.arrived };
  if (field === "tracking_url" && value) {
    var nl = normLink(value);
    if (nl === null) { toast("That tracking link doesn’t look right. Paste the full web address."); return false; }
    value = nl;
  }
  if (field === "note") value = value.trim();
  next[field] = value;
  if (JSON.stringify(next) === JSON.stringify(cur)) return true;
  if (isArchived()) { toast("This group is archived, so nothing can be changed."); return false; }
  try {
    var empty = !next.note && !next.tracking_url && !next.arrived;
    if (empty) {
      await api(sb.from("claim_details").delete().eq("item_id", item.id).eq("buyer", myId));
      gd.details.delete(item.id);
    } else {
      await api(sb.from("claim_details").upsert({ item_id: item.id, buyer: myId, note: next.note || null, tracking_url: next.tracking_url || null, arrived: next.arrived, updated_at: new Date().toISOString() }));
      gd.details.set(item.id, next);
    }
    return true;
  } catch (e) { toast(humanize(e)); return false; }
}
function buyCard(it) {
  var frozen = isArchived();
  var st = h("span", { class: "chip" });
  var trackLink = h("a", { class: "link", target: "_blank", rel: "noopener noreferrer", "data-track": it.name }, "Track package", icon("ext"));
  function paint() {
    var s = statusOf(it), d = purchaseDetail(it);
    st.className = s.cls; st.textContent = s.label; st.setAttribute("data-status", s.key);
    trackLink.hidden = !d.tracking_url;
    if (d.tracking_url) trackLink.href = d.tracking_url;
    paintSummary();
  }
  var note = h("textarea", { rows: "2", maxlength: "300", placeholder: "Add a note (optional), like the order number or where you’ll hide it", class: "bi-note", "data-note": it.name,
    "aria-label": "Note for " + it.name, disabled: frozen ? true : null });
  note.value = purchaseDetail(it).note;
  note.addEventListener("change", async function () {
    var ok = await saveDetail(it, "note", note.value);
    if (!ok) note.value = purchaseDetail(it).note; else toast("Note saved. Only you can see it.");
    paint();
  });
  var track = h("input", { type: "url", inputmode: "url", maxlength: "2000", placeholder: "Tracking link (optional)", class: "bi-track", "data-track-input": it.name,
    "aria-label": "Tracking link for " + it.name, disabled: frozen ? true : null, autocomplete: "off", value: purchaseDetail(it).tracking_url });
  track.addEventListener("change", async function () {
    var ok = await saveDetail(it, "tracking_url", track.value.trim());
    track.value = purchaseDetail(it).tracking_url;
    if (ok) toast(track.value ? "Tracking link saved." : "Tracking link removed.");
    paint();
  });
  var arrived = h("input", { type: "checkbox", checked: purchaseDetail(it).arrived ? true : null, disabled: frozen ? true : null, "data-arrived": it.name });
  arrived.addEventListener("change", async function () {
    var ok = await saveDetail(it, "arrived", arrived.checked);
    if (!ok) arrived.checked = purchaseDetail(it).arrived; else toast(arrived.checked ? "Marked as in hand." : "Marked as not here yet.");
    paint();
  });
  var store = storeOf(it);
  var meta = h("div", { class: "bi-meta" },
    h("span", { class: "bi-store", text: store ? "From " + store : "Store not listed" }),
    it.link ? h("a", { class: "link", href: it.link, target: "_blank", rel: "noopener noreferrer", "data-item-link": it.name }, "View item", icon("ext")) : null,
    trackLink);
  var card = h("li", { class: "buyitem", "data-bought": it.name },
    h("div", { class: "bi-head" }, h("span", { style: "display:flex;gap:10px;align-items:center;min-width:0" }, itemPhoto(it, "bi-img"), h("span", { class: "bi-name", text: it.name })), h("span", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" }, st, paidInput(it))),
    meta,
    h("div", { class: "bi-fields" }, note, track),
    h("label", { class: "chk" }, arrived, "It has arrived and I have it"));
  card._paint = paint;
  setTimeout(paint, 0);
  return card;
}
var paintSummary = function () {};
async function toggleBought(item, btn) {
  if (isArchived()) { toast("This group is archived, so nothing can be changed."); return; }
  if (btn) btn.disabled = true;
  var mine = iBought(item);
  var r = mine
    ? await sb.from("claims").delete().eq("item_id", item.id).eq("buyer", myId)
    : await sb.from("claims").insert({ item_id: item.id, buyer: myId });
  // Start the amount paid at the listed price, so it doesn't change if the owner edits the price later.
  if (!mine && !r.error && listedPrice(item) !== null) {
    try { await sb.from("claim_prices").upsert({ item_id: item.id, buyer: myId, amount: listedPrice(item) }); } catch (e) { /* the amount can be entered by hand */ }
  }
  if (r.error) {
    if (r.error.code === "23505") toast("You already marked that one.");
    else toast(humanize(r.error));
  }
  try { await loadGroup(); } catch (e) { /* ignore */ }
  try { await loadGroups(); } catch (e) { /* ignore */ }
  updateTabs(); renderPanel();
}

/* ---------- views ---------- */
function render() {
  app.replaceChildren();
  ui = {};
  if (phase === "loading") { app.append(loadingView()); return; }
  if (phase === "setup") { app.append(setupView()); return; }
  if (phase === "signin") { renderAuth(); return; }
  if (phase === "name") { app.append(nameView()); return; }
  if (phase === "error") { app.append(errorView()); return; }
  renderMain();
}
function topBar(eyebrow, countdown, title) {
  var chip = h("button", { class: "me-chip", type: "button", id: "me-chip", "aria-label": "Account menu for " + (myName || "you"), onclick: function () { ui.confirmRow.hidden = !ui.confirmRow.hidden; } },
    avatar(myId, "sm"), h("span", { class: "nm", text: myName || "Me" }));
  ui.confirmRow = h("div", { class: "confirm", hidden: true },
    h("span", { text: "Signed in as " + ((session && session.user && session.user.email) || myEmail || "you") + "." }),
    h("button", { class: "btn sm primary", type: "button", id: "sign-out", onclick: signOut, text: "Sign out" }),
    h("button", { class: "btn sm ghost", type: "button", onclick: function () { ui.confirmRow.hidden = true; }, text: "Close" }));
  var top = h("div", { class: "top" },
    h("div", { class: "brand" }, title ? null : h("span", { class: "eyebrow", text: eyebrow }), h("h1", { text: title || "Wishlist Groups" })),
    h("div", { class: "top-right" }, countdown ? h("span", { class: "countdown", text: countdown }) : null, chip));
  return top;
}
function loadingView() {
  return h("div", { class: "panel", "aria-busy": "true" },
    h("div", { class: "top" }, h("div", { class: "brand" }, h("span", { class: "eyebrow", text: "Gifts, together" }), h("h1", { text: "Wishlist Groups" }))),
    h("div", { class: "skeleton" }), h("div", { class: "skeleton" }));
}
function heroView(title, text, eyebrow) {
  return h("div", { class: "hero" },
    h("span", { class: "eyebrow", text: eyebrow || "Gifts, together" }),
    h("h1", { text: title }), text ? h("p", { text: text }) : null);
}
function setupView() {
  return h("div", { class: "panel" }, heroView("Almost ready", null),
    h("div", { class: "card" }, h("p", { text: "This site isn’t connected to its database yet. Open config.js and add the Supabase project URL and key, then reload the page." })));
}
function errorView() {
  return h("div", { class: "panel" }, heroView("Couldn’t load your wishlists", "Check your connection, then try again. If it keeps happening, the database setup may not have been run."),
    loadDetail ? h("p", { class: "muted", id: "load-detail", style: "font-size:13px;overflow-wrap:anywhere;padding:0 4px", text: "Details: " + loadDetail }) : null,
    h("div", { class: "bar", style: "position:static" }, h("span", { class: "muted", text: "Your saved lists are safe." }),
      h("button", { class: "btn primary", type: "button", onclick: enter, text: "Try again" })));
}

/* sign in */
function renderAuth() {
  app.replaceChildren();
  var wrap = h("div", { class: "panel" });
  var joining = joinCode && joinInfo;
  var title, text, eyebrow;
  if (authStep === "email") {
    title = joining ? "Join " + joinInfo.group_name : "Sign in to your wishlists";
    text = joining
      ? "Enter your email and we will send you a 6-digit code. Use this same email any time you want to come back to your lists."
      : "Enter your email and we will send you a 6-digit code. No password needed. New here? The same step creates your account.";
    eyebrow = joining ? "You’re invited" : "Gifts, together";
  } else {
    title = "Check your email";
    text = "We sent a 6-digit code to " + authEmail + ". It can take a minute to arrive. Check spam if you don’t see it.";
    eyebrow = joining ? "Joining " + joinInfo.group_name : "Gifts, together";
  }
  wrap.append(heroView(title, text, eyebrow));
  if (joinCode && joinChecked && !joinInfo) {
    wrap.append(h("div", { class: "note warn", id: "join-bad" }, icon("lock"), h("span", { text: "This invite link isn’t valid any more. You can still sign in, then ask the group admin for a new link." })));
  } else if (joining && joinInfo.archived) {
    wrap.append(h("div", { class: "note warn", id: "join-closed" }, icon("lock"), h("span", { text: "This group is archived and closed to new members." })));
  }
  var card = h("form", { class: "card item", id: "auth-form", novalidate: true });
  card.addEventListener("submit", function (e) { e.preventDefault(); if (!authBusy) (authStep === "email" ? sendCode() : verifyCode()); });
  if (authStep === "email") {
    card.append(h("div", { class: "field" }, h("label", { for: "auth-email", text: "Email" }),
      h("input", { id: "auth-email", type: "email", autocomplete: "email", inputmode: "email", placeholder: "you@example.com", value: authEmail,
        oninput: function (e) { authEmail = e.target.value; } })));
  } else {
    card.append(h("div", { class: "field" }, h("label", { for: "auth-code", text: "6-digit code" }),
      h("input", { id: "auth-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "8", placeholder: "123456", value: authCode,
        oninput: function (e) { authCode = e.target.value; } })));
  }
  if (authMsg) card.append(h("p", { class: "err", role: "alert", text: authMsg }));
  if (authMsg && authDetail) card.append(h("p", { class: "muted", id: "auth-detail", style: "font-size:13px;overflow-wrap:anywhere", text: "Details: " + authDetail }));
  var row = h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });
  row.append(h("button", { class: "btn primary", type: "submit", id: "auth-go", disabled: authBusy ? true : null,
    text: authBusy ? "One moment…" : (authStep === "email" ? "Email me a code" : "Sign in") }));
  if (authStep === "code") {
    row.append(h("button", { class: "btn ghost", type: "button", id: "auth-resend", disabled: authBusy ? true : null, onclick: sendCode, text: "Send a new code" }));
    row.append(h("button", { class: "btn ghost", type: "button", id: "auth-back", onclick: function () { authStep = "email"; authMsg = ""; authDetail = ""; renderAuth(); }, text: "Use a different email" }));
  }
  card.append(row);
  wrap.append(card);
  app.append(wrap);
  var input = document.getElementById(authStep === "email" ? "auth-email" : "auth-code");
  if (input && !authBusy) input.focus();
}

/* first sign-in: choose a display name */
function nameView() {
  var val = "", msg = h("p", { class: "err", hidden: true, role: "alert" });
  var input = h("input", { id: "name-input", type: "text", maxlength: "40", autocomplete: "given-name", placeholder: "Your first name", oninput: function (e) { val = e.target.value; } });
  var btn = h("button", { class: "btn primary", type: "submit", id: "name-go", text: "Continue" });
  var form = h("form", { class: "card item", id: "name-form", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "name-input", text: "Your name" }), input, msg), btn);
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!val.trim()) { msg.textContent = "Enter the name your group will see."; msg.hidden = false; return; }
    btn.disabled = true; btn.textContent = "One moment…";
    try {
      await api(sb.rpc("set_profile", { p_name: val.trim() }));
      myName = val.trim();
      await enter();
    } catch (err) { msg.textContent = humanize(err); msg.hidden = false; btn.disabled = false; btn.textContent = "Continue"; }
  });
  var joining = joinCode && joinInfo;
  setTimeout(function () { input.focus(); }, 0);
  return h("div", { class: "panel" },
    heroView("Welcome! What should we call you?", (joining ? "You’re joining " + joinInfo.group_name + ". " : "") + "This is the name other people in your groups will see.", "One quick thing"),
    form,
    h("div", null, h("button", { class: "btn ghost", type: "button", onclick: signOut, text: "Sign out" })));
}

/* the signed-in shell */
function renderMain() {
  app.replaceChildren();
  ui = {};
  if (phase !== "ready") return;
  if (route.name === "group") { app.append(groupShell()); return; }
  var root = h("div", { class: "panel" }, topBar("Gifts, together", null));
  root.append(ui.confirmRow);
  if (route.name === "new") root.append(newGroupView());
  else if (route.name === "new-wishlist") root.append(newWishlistView());
  else if (route.name === "join") root.append(joinView());
  else root.append(dashboardView());
  app.append(root);
}

/* dashboard */
function dashboardView() {
  var active = groups.filter(function (g) { return !g.archived_at; });
  var archived = groups.filter(function (g) { return !!g.archived_at; });
  var showing = dashTab === "archived" ? archived : active;
  var wrap = h("div", { class: "panel" });
  wrap.append(h("div", { class: "dash-head" },
    h("div", { class: "page-head" }, h("h2", { text: "Your wish groups" }),
      h("p", { class: "muted", text: dashTab === "archived" ? "Archived groups and wishlists are view-only. Nothing in them can be changed." : groups.length ? "Open a group to add your wishes or shop for the people in it." : "Make a group for family, friends or a gift swap, or a wishlist to share with family." })),
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
      h("button", { class: "btn", type: "button", id: "new-wishlist", onclick: function () { route = { name: "new-wishlist" }; renderMain(); window.scrollTo({ top: 0 }); } }, icon("plus"), "New wishlist"),
      h("button", { class: "btn primary", type: "button", id: "new-group", onclick: function () { route = { name: "new" }; renderMain(); window.scrollTo({ top: 0 }); } }, icon("plus"), "New group"))));
  function tab(id, key, text, n) {
    return h("button", { class: "tab", type: "button", role: "tab", id: id, "aria-selected": dashTab === key ? "true" : "false",
      onclick: function () { dashTab = key; renderMain(); } }, text, h("span", { class: "badge", text: String(n) }));
  }
  wrap.append(h("div", { class: "tabs", role: "tablist", style: "max-width:340px" },
    tab("dtab-active", "active", "Active", active.length), tab("dtab-archived", "archived", "Archived", archived.length)));
  if (!showing.length) {
    wrap.append(dashTab === "archived"
      ? h("div", { class: "card empty", id: "no-archived" }, h("h3", { text: "No archived groups" }),
          h("p", { class: "muted", text: "When a group’s admin archives it, it moves here and becomes view-only." }))
      : h("div", { class: "card empty", id: "no-groups" }, h("h3", { text: "No groups yet" }),
          h("p", { class: "muted", text: groups.length ? "All your groups are archived. Make a new one, or open an invite link to join another." : "Create a group, then share its invite link. If someone sent you a link, open it to join their group." })));
    return wrap;
  }
  var grid = h("div", { class: "grid" });
  showing.forEach(function (g) {
    var d = daysUntil(g.event_date);
    var left = g.kind !== "registry" && g.member_count <= 1 ? "Just you so far" : g.left_to_shop === 0 ? "All shopped for" : g.left_to_shop + " to go";
    var chips = h("div", { class: "chips" });
    var isReg = g.kind === "registry";
    if (isReg) chips.append(h("span", { class: "chip", "data-chip": "wishlist", text: "Wishlist" }));
    if (g.is_admin) chips.append(h("span", { class: "chip gold", text: "Admin" }));
    if (g.archived_at) chips.append(h("span", { class: "chip grey", text: "Archived" }));
    else if (!isReg && !g.list_submitted) chips.append(h("span", { class: "chip red", text: "Your list isn’t shared" }));
    grid.append(h("button", { class: "tag gcard" + (g.archived_at ? " archived" : ""), type: "button", "data-gid": g.group_id, "aria-label": "Open " + g.name, onclick: function () { openGroup(g.group_id); } },
      h("div", null, h("h3", { text: g.name })),
      chips,
      h("dl", { class: "stats" },
        h("div", null, h("dt", { text: "Event date" }), h("dd", { class: "s-event" }, fmtDay(g.event_date), g.archived_at ? null : h("span", { class: "muted", style: "display:block;font-weight:400;font-size:13px", text: d > 1 ? "in " + d + " days" : d === 1 ? "tomorrow" : d === 0 ? "today" : "passed" }))),
        h("div", null, h("dt", { text: "Created by" }), h("dd", { class: "s-creator", text: g.admin_name || "—" })),
        h("div", null, h("dt", { text: "Created" }), h("dd", { class: "s-created", text: fmtDay(g.created_at) })),
        h("div", null, h("dt", { text: isReg ? "Lists" : "Members" }), h("dd", { class: "s-members", text: String(g.member_count) })),
        h("div", null, h("dt", { text: "Left to shop for" }), h("dd", { class: "s-left", text: left })))));
  });
  wrap.append(grid);
  return wrap;
}

/* create a one-way wishlist */
function newWishlistView() {
  var f = { name: "", date: "", who: "" };
  var err = h("p", { class: "err", hidden: true, role: "alert", id: "w-err" });
  var btn = h("button", { class: "btn primary", type: "submit", id: "w-create", text: "Create wishlist" });
  var form = h("form", { class: "card item", id: "w-form", novalidate: true },
    h("div", { class: "page-head" }, h("h2", { text: "New wishlist" }),
      h("p", { class: "muted", text: "A one-way list for an event, like a birthday or a Christmas list you write for your kids. People you share the link with can see it and mark gifts as purchased, but they can’t make lists of their own." })),
    h("div", { class: "field" }, h("label", { for: "w-name", text: "Event name" }),
      h("input", { id: "w-name", type: "text", maxlength: "60", placeholder: "Christmas 2026, Mia’s 5th birthday…", autocomplete: "off", oninput: function (e) { f.name = e.target.value; } })),
    h("div", { class: "field" }, h("label", { for: "w-date", text: "Event date" }),
      h("input", { id: "w-date", type: "date", min: todayStr(), oninput: function (e) { f.date = e.target.value; } })),
    h("div", { class: "field" }, h("label", { for: "w-who", text: "Who is the list for?" }),
      h("input", { id: "w-who", type: "text", maxlength: "40", placeholder: "Name", autocomplete: "off", oninput: function (e) { f.who = e.target.value; } }),
      h("p", { class: "muted", style: "font-size:13px", text: "You can add more lists for other people after this." })),
    err,
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, btn,
      h("button", { class: "btn ghost", type: "button", id: "w-cancel", onclick: function () { route = { name: "dashboard" }; renderMain(); }, text: "Cancel" })));
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var problem = !f.name.trim() ? "Give the event a name."
      : !f.date ? "Choose the event date."
      : dateHasPassed(f.date) ? "Choose an event date that is today or later."
      : !f.who.trim() ? "Enter the name of the person the list is for." : "";
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.textContent = "Creating…";
    try {
      var id = await api(sb.rpc("create_registry", { p_name: f.name.trim(), p_event: f.date, p_for: f.who.trim() }));
      await openGroup(id, "members");
      var first = gd && gd.members[0];
      if (first) setView("edit:" + first);
      toast("Wishlist created. Add their wishes, then share the invite link from the Manage tab.");
    } catch (ex) { err.textContent = humanize(ex); err.hidden = false; btn.disabled = false; btn.textContent = "Create wishlist"; }
  });
  return h("div", { class: "panel" }, form);
}

/* create a group */
function newGroupView() {
  var f = { name: "", date: "", min: "3" };
  var err = h("p", { class: "err", hidden: true, role: "alert", id: "g-err" });
  var btn = h("button", { class: "btn primary", type: "submit", id: "g-create", text: "Create group" });
  var form = h("form", { class: "card item", id: "g-form", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "g-name", text: "Group name" }),
      h("input", { id: "g-name", type: "text", maxlength: "60", placeholder: "Family Christmas, Office swap…", autocomplete: "off", oninput: function (e) { f.name = e.target.value; } })),
    h("div", { class: "field" }, h("label", { for: "g-date", text: "Event date" }),
      h("input", { id: "g-date", type: "date", min: todayStr(), oninput: function (e) { f.date = e.target.value; } })),
    h("div", { class: "field" }, h("label", { for: "g-min", text: "Minimum items per list" }),
      h("input", { id: "g-min", type: "number", min: "1", max: "50", step: "1", value: "3", inputmode: "numeric", oninput: function (e) { f.min = e.target.value; } }),
      h("p", { class: "muted", style: "font-size:13px", text: "Each person must add at least this many wishes before they can share their list." })),
    err,
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, btn,
      h("button", { class: "btn ghost", type: "button", id: "g-cancel", onclick: function () { route = { name: "dashboard" }; renderMain(); }, text: "Cancel" })));
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var min = Number(f.min);
    var problem = !f.name.trim() ? "Give your group a name."
      : !f.date ? "Choose the event date."
      : dateHasPassed(f.date) ? "Choose an event date that is today or later."
      : (!Number.isInteger(min) || min < 1 || min > 50) ? "The minimum must be a whole number from 1 to 50." : "";
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.textContent = "Creating…";
    try {
      var id = await api(sb.rpc("create_group", { p_name: f.name.trim(), p_event: f.date, p_min: min }));
      await openGroup(id, "manage");
      toast("Group created. Share the invite link to bring people in.");
    } catch (ex) { err.textContent = humanize(ex); err.hidden = false; btn.disabled = false; btn.textContent = "Create group"; }
  });
  setTimeout(function () { var el = document.getElementById("g-name"); if (el) el.focus(); }, 0);
  return h("div", { class: "panel" },
    h("button", { class: "btn ghost back", type: "button", id: "back-dash", onclick: function () { route = { name: "dashboard" }; renderMain(); } }, icon("back"), "All groups"),
    h("div", { class: "page-head" }, h("h2", { text: "New wish group" }),
      h("p", { class: "muted", text: "You’ll be the admin. After creating it you can copy an invite link for the people you want to join." })),
    form);
}

/* join a group from an invite link */
function finishJoinLink() {
  joinCode = ""; joinInfo = null;
  try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
}
function joinView() {
  var wrap = h("div", { class: "panel" });
  if (!joinInfo) {
    wrap.append(heroView("This invite link isn’t valid any more", "Ask the group admin to send you a new link.", "Invite"),
      h("div", null, h("button", { class: "btn", type: "button", id: "join-skip", onclick: function () { finishJoinLink(); route = { name: "dashboard" }; renderMain(); }, text: "Go to my groups" })));
    return wrap;
  }
  var already = groups.find(function (g) { return g.name === joinInfo.group_name && g.event_date === joinInfo.event_date; });
  var err = h("p", { class: "err", hidden: true, role: "alert", id: "join-err" });
  var wl = joinInfo.kind === "registry";
  var btn = h("button", { class: "btn primary", type: "button", id: "join-go", text: wl ? "Open wishlist" : "Join group", disabled: joinInfo.archived && !already ? true : null });
  btn.addEventListener("click", async function () {
    btn.disabled = true; btn.textContent = "Joining…";
    try {
      var id = await api(sb.rpc("join_group", { p_code: joinCode }));
      finishJoinLink();
      await loadGroups();
      await openGroup(id);
      toast(wl ? "You’re in! Open a list and mark gifts as purchased." : "You’re in! Add your wishes whenever you’re ready.");
    } catch (ex) { err.textContent = humanize(ex); err.hidden = false; btn.disabled = false; btn.textContent = wl ? "Open wishlist" : "Join group"; }
  });
  wrap.append(heroView((wl ? "Open " : "Join ") + joinInfo.group_name + "?", "You’re signed in as " + myEmail + ". You’ll sign in with this email whenever you come back." + (wl ? " You’ll be able to see the lists and mark gifts as purchased." : ""), "You’re invited"),
    h("div", { class: "card" },
      h("dl", { class: "stats" },
        h("div", null, h("dt", { text: "Event date" }), h("dd", { text: fmtDay(joinInfo.event_date) })),
        h("div", null, h("dt", { text: wl ? "Lists" : "Members so far" }), h("dd", { text: String(joinInfo.member_count) })))),
    joinInfo.archived && !already ? h("div", { class: "note warn" }, icon("lock"), h("span", { text: "This group is archived and closed to new members." })) : "",
    err,
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, btn,
      h("button", { class: "btn ghost", type: "button", id: "join-cancel", onclick: function () { finishJoinLink(); route = { name: "dashboard" }; renderMain(); }, text: "Not now" })));
  return wrap;
}

/* a group: header, tabs, panel */
function groupShell() {
  var g = groupInfo();
  if (!g || !gd) return loadingView();
  var top = topBar(null, countdownText(g.event_date), g.name);
  var reg = g.kind === "registry";
  ui.tabMy = reg ? null : h("button", { class: "tab", type: "button", role: "tab", id: "tab-my", onclick: function () { setView("my"); } });
  ui.tabFam = h("button", { class: "tab", type: "button", role: "tab", id: "tab-family", onclick: function () { setView("members"); } });
  ui.tabPur = h("button", { class: "tab", type: "button", role: "tab", id: "tab-purchases", onclick: function () { setView("purchases"); } });
  var tabList = reg ? [ui.tabFam, ui.tabPur] : g.list_submitted ? [ui.tabFam, ui.tabPur, ui.tabMy] : [ui.tabMy, ui.tabFam, ui.tabPur];
  if (g.is_admin) {
    ui.tabManage = h("button", { class: "tab", type: "button", role: "tab", id: "tab-manage", onclick: function () { setView("manage"); } }, "Manage");
    tabList.push(ui.tabManage);
  }
  var tabs = h("div", { class: "tabs", role: "tablist" }, tabList);
  ui.tabsEl = tabs;
  ui.panel = h("div", { class: "panel", id: "panel" });
  var back = h("button", { class: "btn ghost back", type: "button", id: "back-dash", onclick: goDashboard }, icon("back"), "All groups");
  var root = h("div", { class: "panel" }, top, ui.confirmRow, back, tabs, ui.panel);
  if (g.archived_at) root.insertBefore(h("div", { class: "note warn", id: "archived-note" }, icon("lock"),
    h("span", { text: (reg ? "This wishlist" : "This group") + " is archived and view-only. No one can join, and nothing can be added, edited or marked as purchased." })), tabs);
  setTimeout(function () { renderPanel(); updateTabs(); }, 0);
  return root;
}
function boughtCount() {
  var n = 0;
  gd.members.forEach(function (m) {
    if (m === myId) return;
    listFor(m).items.forEach(function (it) { if (iBought(it)) n++; });
  });
  return n;
}
function updateTabs() {
  if (!ui.tabFam || !gd) return;
  var v = route.view;
  var reg = isRegistry();
  var onFam = v === "members" || v.indexOf("member:") === 0 || v.indexOf("edit:") === 0;
  if (ui.tabMy) ui.tabMy.setAttribute("aria-selected", v === "my" ? "true" : "false");
  ui.tabFam.setAttribute("aria-selected", onFam ? "true" : "false");
  ui.tabPur.setAttribute("aria-selected", v === "purchases" ? "true" : "false");
  if (ui.tabManage) ui.tabManage.setAttribute("aria-selected", v === "manage" ? "true" : "false");
  if (ui.tabMy) {
    // Once my list is shared it moves after Purchases; until then it stays first.
    var shared = !!((gd.listMeta.get(myId) || {}).submitted_at);
    var order = shared ? [ui.tabFam, ui.tabPur, ui.tabMy] : [ui.tabMy, ui.tabFam, ui.tabPur];
    if (ui.tabManage) order.push(ui.tabManage);
    if (ui.tabsEl && order.some(function (t, i) { return ui.tabsEl.children[i] !== t; })) ui.tabsEl.append.apply(ui.tabsEl, order);
    ui.tabMy.replaceChildren(document.createTextNode("My list"));
    var lm = gd.listMeta.get(myId);
    if (!(lm && lm.submitted_at) && !isArchived()) ui.tabMy.append(h("span", { class: "badge warn", text: "Draft" }));
  }
  var others = gd.members.filter(function (m) { return m !== myId; });
  var ready = others.filter(function (m) { return listFor(m).state === "ready"; }).length;
  ui.tabFam.replaceChildren(document.createTextNode(reg ? "Lists" : "Everyone"), h("span", { class: "badge", title: ready + " of " + others.length + " lists ready", text: ready + "/" + others.length }));
  ui.tabPur.replaceChildren(document.createTextNode("Purchases"), h("span", { class: "badge", text: String(boughtCount()) }));
}
function setView(v) {
  // Unsaved edits live in the editor model, so switching tabs never loses them.
  route.view = v; renderPanel(); updateTabs(); window.scrollTo({ top: 0 });
}
function renderPanel() {
  if (!ui.panel || !gd) return;
  ui.panel.replaceChildren();
  var v = route.view;
  if (isRegistry() && v === "my") v = route.view = "members";
  if (v.indexOf("edit:") === 0 && !canManageList(v.slice(5))) v = route.view = "members";
  if (v.indexOf("edit:") === 0 && isArchived()) v = route.view = "member:" + v.slice(5);
  if (v === "my") ui.panel.append(isArchived() ? readOnlyListView() : editorView());
  else if (v.indexOf("edit:") === 0) ui.panel.append(editorView());
  else if (v === "members") ui.panel.append(membersView());
  else if (v === "purchases") ui.panel.append(purchasesView());
  else if (v === "manage") ui.panel.append(manageView());
  else ui.panel.append(memberView(v.slice(7)));
}

/* editor */
function qtyText(q) { return q === null ? "Unlimited" : String(q); }
function readOnlyListView() {
  var items = (gd.items.get(myId)) || [];
  var wrap = h("div", { class: "panel" });
  wrap.append(h("div", { class: "page-head" }, h("h2", { text: "Your list" }),
    h("p", { class: "muted", text: items.length ? "This group is archived, so your list is now read-only." : "This group is archived, so lists can no longer be added." })));
  items.forEach(function (it) {
    var main = h("div", { class: "wish-main" }, h("h3", { text: it.name }), h("p", { class: "desc", text: it.description }));
    if (it.quantity !== 1) main.append(h("p", { class: "wanted" }, "Quantity: ", h("b", { text: qtyText(it.quantity) })));
    if (it.link) main.append(h("a", { class: "link", href: it.link, target: "_blank", rel: "noopener noreferrer" }, "View on " + host(it.link), icon("ext")));
    wrap.append(h("div", { class: "card wish" }, main));
  });
  return wrap;
}
function registryEditorView(owner) {
  var wrap = h("div", { class: "panel" });
  wrap.append(h("button", { class: "btn ghost back", type: "button", id: "back-lists", onclick: function () { setView("members"); } }, icon("back"), "All lists"));
  wrap.append(h("div", { class: "page-head" }, h("h2", { text: possessive(owner) + " wishlist" }),
    h("p", { class: "muted", text: isRegistry()
      ? "Add as many wishes as you like. Anyone with the invite link sees changes right away and can mark gifts as purchased. As the admin, you can also see who has marked what."
      : "You made this list, so you can edit it. Everyone in the group sees changes right away and can mark gifts as purchased, and you can see who has marked what. Anything you buy from it is marked as bought by you." })));
  ui.items = h("div", { class: "items" });
  wrap.append(ui.items);
  wrap.append(h("button", { class: "btn", type: "button", id: "add-item", onclick: function () {
    var it = blank(); editor.items.push(it); rebuildItems(); updateBar();
    var f = document.getElementById("f-" + it.key + "-name"); if (f) f.focus();
  } }, icon("plus"), "Add another item"));
  ui.count = h("span", { class: "count" });
  ui.meter = h("div", { class: "meter", hidden: true });
  ui.submit = h("button", { class: "btn primary", type: "button", id: "submit-list", onclick: submitList });
  wrap.append(h("div", { class: "bar" }, h("div", null, ui.count, ui.meter), h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, ui.submit)));
  rebuildItems(); updateBar();
  return wrap;
}
function editorView() {
  if (editingOwner() !== myId) {
    var owner = editingOwner();
    if (!editor || editor.owner !== owner) initEditor(owner);
    return registryEditorView(owner);
  }
  if (!editor || editor.owner !== myId) initEditor();
  var min = minItems();
  var wrap = h("div", { class: "panel" });
  var pill = h("span", { class: "status-pill " + (editor.submitted ? "live" : "draft"), text: editor.submitted ? "Shared with the group" : "Draft. Nobody else can see it yet" });
  wrap.append(h("div", { class: "page-head" }, h("h2", { text: "Your list" }), pill,
    h("p", { class: "muted", text: editor.submitted
      ? "Edit anything below and save. The group sees changes right away."
      : "Add at least " + min + (min === 1 ? " thing" : " things") + " you’d love. Each needs a name and a short description. A link helps people find the right one, and quantity is optional. Submitting emails the rest of the group." })));
  wrap.append(h("div", { class: "note" }, icon("lock"),
    h("span", { text: "Others mark gifts as purchased so nobody doubles up. You won’t see which ones, so the surprise stays intact." })));
  ui.items = h("div", { class: "items" });
  wrap.append(ui.items);
  wrap.append(h("button", { class: "btn", type: "button", id: "add-item", onclick: function () {
    var it = blank(); editor.items.push(it); rebuildItems(); updateBar();
    var f = document.getElementById("f-" + it.key + "-name"); if (f) f.focus();
  } }, icon("plus"), "Add another item"));
  ui.count = h("span", { class: "count" });
  ui.meter = h("div", { class: "meter" });
  ui.draft = h("button", { class: "btn", type: "button", id: "save-draft", onclick: saveDraft, text: "Save draft" });
  ui.submit = h("button", { class: "btn primary", type: "button", id: "submit-list", onclick: submitList });
  wrap.append(h("div", { class: "bar" }, h("div", null, ui.count, ui.meter),
    h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, editor.submitted ? null : ui.draft, ui.submit)));
  rebuildItems(); updateBar();
  return wrap;
}
function rebuildItems() {
  ui.items.replaceChildren();
  editor.items.forEach(function (it, i) { ui.items.append(itemCard(it, i)); });
}
/* photo and price from the item's link, via the /api/preview helper */
var CURRENCY_SIGNS = { USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$", JPY: "¥" };
function priceText(price, currency) {
  var sign = !currency ? "$" : CURRENCY_SIGNS[currency];
  return sign ? sign + price : price + " " + currency;
}
async function lookupLink(link) {
  var ses = await sb.auth.getSession();
  var token = ses && ses.data && ses.data.session && ses.data.session.access_token;
  var r = await fetch("/api/preview?url=" + encodeURIComponent(link), { headers: { Authorization: "Bearer " + (token || ""), apikey: CFG.SUPABASE_ANON_KEY } });
  if (!r.ok) throw new Error("lookup " + r.status);
  return r.json();
}
function itemCard(it, i) {
  var k = it.key;
  var errName = h("p", { class: "err", hidden: true, text: "Give this item a name." });
  var errDesc = h("p", { class: "err", hidden: true, text: "Add a short description, such as size, color or model." });
  var errLink = h("p", { class: "err", hidden: true, text: "That link doesn’t look right. Paste the full web address." });
  var errQty = h("p", { class: "err", hidden: true, text: "Quantity must be a whole number, 1 or more." });
  var fName = h("div", { class: "field" }), fDesc = h("div", { class: "field" }), fLink = h("div", { class: "field" }), fQty = h("div", { class: "field" }), fPrice = h("div", { class: "field" });
  var errPrice = h("p", { class: "err", hidden: true, text: "Keep the price under 60 characters." });
  var inName = h("input", { id: "f-" + k + "-name", type: "text", maxlength: "80", value: it.name, autocomplete: "off", placeholder: "Item name",
    oninput: function (e) { it.name = e.target.value; changed(); } });
  var inDesc = h("textarea", { id: "f-" + k + "-desc", maxlength: "300", rows: "2", placeholder: "Size, color, model, or why you want it",
    oninput: function (e) { it.description = e.target.value; changed(); } });
  inDesc.value = it.description;
  var inLink = h("input", { id: "f-" + k + "-link", type: "url", inputmode: "url", maxlength: "2000", value: it.link, autocomplete: "off", placeholder: "https://",
    oninput: function (e) { it.link = e.target.value; changed(); }, onblur: function () { it._lt = true; paint(); autoLookup(); } });
  var inQty = h("input", { id: "f-" + k + "-qty", type: "number", min: "1", max: "9999", step: "1", inputmode: "numeric", value: it.qty, "aria-label": "Quantity",
    disabled: it.unlimited ? true : null,
    oninput: function (e) { it.qty = e.target.value; changed(); } });
  var inUnl = h("input", { id: "f-" + k + "-unl", type: "checkbox", checked: it.unlimited ? true : null,
    onchange: function (e) { it.unlimited = e.target.checked; inQty.disabled = it.unlimited; changed(); } });
  fName.append(h("label", { for: "f-" + k + "-name", text: "Name" }), inName, errName);
  fDesc.append(h("label", { for: "f-" + k + "-desc", text: "Description" }), inDesc, errDesc);
  fLink.append(h("label", { for: "f-" + k + "-link" }, "Web link ", h("span", { class: "opt", text: "(optional)" })), inLink, errLink);
  fQty.append(h("label", { for: "f-" + k + "-qty" }, "Quantity ", h("span", { class: "opt", text: "(optional)" })),
    h("div", { class: "qty" }, inQty, h("label", { class: "chk", for: "f-" + k + "-unl" }, inUnl, "Unlimited")), errQty);
  // price (optional, editable) and the photo found from the link
  var inPrice = h("input", { id: "f-" + k + "-price", type: "text", maxlength: "60", value: it.price, autocomplete: "off", placeholder: "$24.99",
    oninput: function (e) { it.price = e.target.value; it.asOf = ""; it.autoPrice = false; changed(); } });
  fPrice.append(h("label", { for: "f-" + k + "-price" }, "Price ", h("span", { class: "opt", text: "(optional)" })), inPrice, errPrice);
  var thumb = h("img", { class: "pv-img", alt: "", referrerpolicy: "no-referrer", hidden: true });
  thumb.addEventListener("error", function () { thumb.hidden = true; });
  var pvMsg = h("span", { class: "pv-msg muted" });
  var pvBtn = h("button", { class: "btn sm", type: "button", id: "f-" + k + "-lookup", text: "Get photo and price from link", onclick: function () { lookup(true); } });
  var pvRm = h("button", { class: "btn sm ghost", type: "button", text: "Remove photo", hidden: true, onclick: function () { it.image = ""; paintPv(); changed(); } });
  var pv = h("div", { class: "pv" }, thumb, h("div", { class: "pv-body" }, pvMsg, h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, pvBtn, pvRm)));
  function paintPv() {
    var ok = normLink(it.link);
    pvBtn.hidden = !ok;
    pvBtn.disabled = !!it._busy;
    thumb.hidden = !it.image;
    if (it.image) { thumb.src = it.image; thumb.alt = it.name || "Item photo"; }
    pvRm.hidden = !it.image;
    pv.hidden = !ok && !it.image;
  }
  function autoLookup() {
    var nl = normLink(it.link);
    if (nl && nl !== it.looked) lookup(false);
  }
  async function lookup(force) {
    var nl = normLink(it.link);
    if (!nl || it._busy) return;
    it._busy = true; it.looked = nl; pvMsg.textContent = "Looking up the photo and price…"; paintPv();
    try {
      var r = await lookupLink(nl);
      var gotImg = false, gotPrice = false;
      if (r && r.image && (force || !it.image)) { it.image = r.image; gotImg = true; }
      if (r && r.price && (force || !it.price.trim() || it.autoPrice)) {
        it.price = priceText(r.price, r.currency); it.asOf = fmtDay(todayStr()); it.autoPrice = true; inPrice.value = it.price; gotPrice = true;
      }
      pvMsg.textContent = gotImg && gotPrice ? "Found a photo and price. Check them before saving."
        : gotImg ? "Found a photo. This site didn’t share a price, so you can type one in."
        : gotPrice ? "Found a price. This site didn’t share a photo."
        : r && r.reason === "blocked" ? "That store doesn’t let us read its page, so you’ll need to add the price yourself."
        : "Couldn’t read a photo or price from that link. You can still type the price in.";
    } catch (e) { pvMsg.textContent = "Couldn’t look that link up right now. You can still type the price in."; }
    it._busy = false; paintPv(); changed();
  }
  var del = h("button", { class: "btn ghost sm danger", type: "button", "aria-label": "Remove item " + (i + 1), onclick: function () {
    editor.items = editor.items.filter(function (x) { return x !== it; });
    if (editor.items.length === 0) editor.items.push(blank());
    rebuildItems(); updateBar();
  } }, icon("trash"), "Remove");
  var card = h("div", { class: "card item" }, h("div", { class: "item-head" }, h("span", { class: "lbl", text: "Item " + (i + 1) }), del), fName, fDesc, h("div", { class: "row2" }, fLink, fQty), h("div", { class: "row2" }, fPrice, h("div", null)), pv);
  function paint() {
    var n = it.name.trim(), d = it.description.trim(), l = it.link.trim();
    var touched = !!(n || d || l);
    var showAll = editor.showErrors && touched;
    var nameBad = showAll && !n, descBad = showAll && !d;
    var linkBad = l && normLink(l) === null && (editor.showErrors || it._lt);
    var qtyBad = touched && !parseQty(it).ok;
    errName.hidden = !nameBad; errDesc.hidden = !descBad; errLink.hidden = !linkBad; errQty.hidden = !qtyBad;
    errPrice.hidden = it.price.trim().length <= 60;
    fName.classList.toggle("bad", !!nameBad); fDesc.classList.toggle("bad", !!descBad); fLink.classList.toggle("bad", !!linkBad); fQty.classList.toggle("bad", !!qtyBad);
  }
  function changed() { paint(); updateBar(); paintPv(); }
  paint(); paintPv();
  return card;
}
function updateBar() {
  if (!ui.count) return;
  if (editor.registry) {
    var rr = cleanItems(), nn = rr.complete.length;
    var dirtyR = sig(rr.complete) !== editor.baseSig || rr.problems > 0;
    ui.count.textContent = rr.problems > 0 ? plural(rr.problems, "item needs", "items need") + " fixing"
      : !dirtyR ? (nn ? "All changes saved · " + plural(nn, "item", "items") : "No items yet") : plural(nn, "item", "items") + " ready to save";
    ui.count.className = "count " + (rr.problems > 0 ? "bad" : !dirtyR && nn ? "ok" : "");
    ui.submit.textContent = editor.saving ? "Saving…" : "Save changes";
    ui.submit.disabled = editor.saving || !dirtyR;
    return;
  }
  var min = minItems();
  var r = cleanItems(), n = r.complete.length;
  var dirty = sig(r.complete) !== editor.baseSig || r.problems > 0;
  var msg, cls = "";
  if (r.problems > 0) { msg = plural(r.problems, "item needs", "items need") + " fixing"; cls = "bad"; }
  else if (n < min) { msg = n + " of " + min + " required items ready"; }
  else { msg = plural(n, "item", "items") + " ready"; cls = "ok"; }
  if (editor.submitted && !dirty && r.problems === 0 && n >= min) msg = "All changes saved · " + plural(n, "item", "items");
  ui.count.textContent = msg; ui.count.className = "count " + cls;
  ui.meter.replaceChildren();
  var segs = Math.min(min, 10), on = Math.round(Math.min(n, min) / min * segs);
  for (var i = 0; i < segs; i++) ui.meter.append(h("i", { class: i < on ? "on" : "" }));
  var busy = editor.saving;
  if (editor.submitted) {
    ui.submit.textContent = busy ? "Saving…" : "Save changes";
    ui.submit.disabled = busy || !dirty;
  } else {
    ui.submit.textContent = busy ? "Submitting…" : "Submit my list";
    ui.submit.disabled = busy;
    ui.draft.disabled = busy || !dirty;
  }
}

/* everyone */
function membersView() {
  var wrap = h("div", { class: "panel" });
  var reg = isRegistry();
  wrap.append(h("div", { class: "page-head" }, h("h2", { text: reg ? "Wishlists" : "Everyone’s lists" }),
    h("p", { class: "muted", text: "Open a list to see what they’d like. Mark a gift as purchased and everyone else will see it, so no one buys it twice." })));
  var others = gd.members.filter(function (m) { return m !== myId; });
  if (!others.length) {
    wrap.append(h("div", { class: "card empty", id: "alone" }, h("h3", { text: reg ? "No lists yet" : "It’s just you so far" }),
      h("p", { class: "muted", text: reg ? (isAdmin() ? "Add a list for someone below." : "The admin hasn’t added any lists yet.")
        : isAdmin() ? "Open the Manage tab to copy the invite link and bring people in." : "Ask the group admin for the invite link to share." })));
    if (reg && isAdmin() && !isArchived()) wrap.append(addListCard());
    if (!reg && !isArchived()) wrap.append(addListCard());
    return wrap;
  }
  // How many items I have picked from each list, and which shared lists I haven't touched yet.
  var mineBy = new Map(), toShop = [], waiting = [];
  others.forEach(function (m) {
    var info = listFor(m);
    if (info.state !== "ready") { waiting.push(m); return; }
    var n = info.items.filter(iBought).length;
    mineBy.set(m, n);
    if (n === 0) toShop.push(m);
  });
  var names = function (list) { return list.map(nameOf).join(", "); };
  if (toShop.length) {
    wrap.append(h("div", { class: "note warn", id: "shop-note" }, icon("lock"),
      h("span", { text: "Still to shop for: " + names(toShop) + "." + (waiting.length ? " Waiting on a list from " + names(waiting) + "." : "") })));
  } else if (mineBy.size) {
    wrap.append(h("div", { class: "note", id: "shop-note" }, icon("check"),
      h("span", { text: "You’ve picked something from every shared list." + (waiting.length ? " Waiting on a list from " + names(waiting) + "." : "") })));
  } else {
    wrap.append(h("div", { class: "note", id: "shop-note" }, icon("lock"), h("span", { text: "No one has shared a list yet. Waiting on " + names(waiting) + "." })));
  }
  var grid = h("div", { class: "grid" });
  others.forEach(function (m) {
    var info = listFor(m), body, chip;
    if (info.state === "ready") {
      var bought = info.items.filter(function (it) { return claimersOf(it).length > 0; }).length;
      var mine = mineBy.get(m);
      chip = mine > 0
        ? h("span", { class: "chip", "data-chip": "picked", text: "You’ve picked " + mine + (mine === 1 ? " item" : " items") })
        : h("span", { class: "chip gold", "data-chip": "to-shop", text: "Not shopped yet" });
      body = h("div", null,
        h("div", { class: "prog-row" }, h("span", { text: plural(info.items.length, "wish", "wishes") }), h("span", { text: bought + " purchased" })),
        h("div", { class: "progress" }, h("b", { style: "width:" + Math.round(bought / info.items.length * 100) + "%" })));
    } else {
      chip = h("span", { class: "chip grey", "data-chip": "waiting", text: reg ? "No items yet" : "No list yet" });
      body = h("p", { class: "meta", text: reg ? "Nothing has been added to this list yet." : nameOf(m) + " hasn’t submitted a list yet." });
    }
    var madeBy = gd.managedBy.get(m);
    if (madeBy) chip = h("span", { class: "chips" }, chip, h("span", { class: "chip grey", "data-chip": "managed", text: madeBy === myId ? "You manage this list" : "Made by " + nameOf(madeBy) }));
    var canOpen = info.state === "ready" || (canManageList(m) && !isArchived());
    grid.append(h("button", { class: "tag", type: "button", "data-member": m, disabled: canOpen ? null : true, onclick: function () { setView(info.state === "ready" ? "member:" + m : "edit:" + m); } },
      h("div", { class: "who" }, avatar(m, "md"), h("h3", { text: nameOf(m) })), h("div", { class: "chips" }, chip), body));
  });
  wrap.append(grid);
  if (reg && isAdmin() && !isArchived()) wrap.append(addListCard());
  if (!reg) {
    var mineKids = gd.members.filter(function (m) { return gd.managedBy.get(m) === myId; });
    if (mineKids.length) wrap.append(listsCard(isArchived(), mineKids, "Lists you made for others"));
    if (!isArchived()) wrap.append(addListCard());
  }
  return wrap;
}
function addListCard() {
  var reg = isRegistry();
  var input = h("input", { id: "new-list-name", type: "text", maxlength: "40", placeholder: "Who is this list for?", autocomplete: "off", "aria-label": "Name of the person the list is for" });
  var btn = h("button", { class: "btn primary", type: "submit", id: "new-list-go", text: "Add list" });
  var err = h("p", { class: "err", hidden: true, role: "alert", id: "new-list-err" });
  var form = h("form", { class: "card stack", id: "new-list-form", novalidate: true }, h("h3", { text: reg ? "Add another list" : "Make a list for someone else" }),
    reg ? null : h("p", { class: "muted", style: "font-size:13px", text: "For a child, or anyone who doesn’t use this site. You can edit their list, and anything you buy from it is marked as bought by you." }),
    h("div", { class: "linkbox" }, input, btn), err);
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = input.value.trim();
    if (!name) { err.textContent = "Enter the name of the person the list is for."; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true;
    try {
      var before = new Set(gd.members);
      await api(sb.rpc(reg ? "add_list" : "add_child_list", { p_group: route.id, p_name: name }));
      await loadGroup();
      var added = gd.members.find(function (m) { return !before.has(m); });
      editor = null;
      setView(added ? "edit:" + added : "members");
      toast("List added. Add their wishes below.");
    } catch (ex) { err.textContent = humanize(ex); err.hidden = false; btn.disabled = false; }
  });
  return form;
}
function claimSide(it) {
  var cl = claimersOf(it), mine = cl.indexOf(myId) >= 0, full = isFull(it);
  var others = cl.filter(function (e) { return e !== myId; });
  var frozen = isArchived();          // an archived group is view-only: buttons stay visible but greyed out
  var side = h("div", { class: "wish-side" });
  function onclick(e) { toggleBought(it, e.currentTarget); }
  if (mine) {
    side.append(h("button", { class: "buy mine", type: "button", "aria-pressed": "true", "aria-label": "Purchased by you. Undo for " + it.name,
      disabled: frozen ? true : null, title: frozen ? "This group is archived" : null, onclick: onclick }, h("span", { class: "box" }, icon("check")), "Purchased by you"), paidInput(it));
  } else if (full) {
    side.append(h("span", { class: "pill" }, icon("check"), it.quantity === 1 ? "Purchased by " + nameOf(cl[0]) : "All " + it.quantity + " claimed"));
  } else {
    side.append(h("button", { class: "buy", type: "button", "aria-pressed": "false", "aria-label": "Mark " + it.name + " as purchased",
      disabled: frozen ? true : null, title: frozen ? "This group is archived" : null, onclick: onclick }, h("span", { class: "box" }), "Mark as purchased"));
  }
  // Who else picked it up (only worth saying when more than one is wanted, or you're one of several).
  var show = others.filter(function () { return !(full && !mine && it.quantity === 1); });
  if (show.length) side.append(h("p", { class: "also", text: (mine ? "Also selected by " : full ? "Claimed by " : "Selected by ") + show.map(nameOf).join(", ") }));
  return side;
}
function memberView(member) {
  var info = listFor(member);
  var wrap = h("div", { class: "panel" });
  var canEdit = canManageList(member) && !isArchived();
  wrap.append(h("button", { class: "btn ghost back", type: "button", onclick: function () { setView("members"); } }, icon("back"), "All lists"));
  if (info.state !== "ready") {
    wrap.append(h("div", { class: "card empty" }, h("h3", { text: nameOf(member) + " hasn’t shared a list yet" }),
      h("p", { class: "muted", text: "It will show up here as soon as they submit it." })));
    return wrap;
  }
  var items = info.items;
  var bought = items.filter(function (it) { return claimersOf(it).length > 0; }).length;
  wrap.append(h("div", { class: "who-head" }, avatar(member, "lg"),
    h("div", null, h("h2", { text: possessive(member) + " list" }), h("p", { class: "muted", text: plural(items.length, "wish", "wishes") })),
    canEdit ? h("button", { class: "btn sm", type: "button", id: "edit-list", style: "margin-left:auto", onclick: function () { setView("edit:" + member); } }, "Edit list") : null));
  wrap.append(h("div", { class: "card" },
    h("div", { class: "prog-row" }, h("span", { text: "Purchased" }), h("span", { text: bought + " of " + items.length })),
    h("div", { class: "progress" }, h("b", { style: "width:" + Math.round(bought / items.length * 100) + "%" }))));
  items.forEach(function (it) {
    var cl = claimersOf(it);
    var main = h("div", { class: "wish-main" }, h("h3", { text: it.name }), h("p", { class: "desc", text: it.description }));
    if (it.quantity !== 1) {
      main.append(h("p", { class: "wanted" }, "Wants ", h("b", { text: it.quantity === null ? "as many as you like" : String(it.quantity) }),
        it.quantity === null ? (cl.length ? " · " + cl.length + " selected" : "") : " · " + cl.length + " of " + it.quantity + " claimed"));
    }
    if (it.price) main.append(h("p", { class: "price" }, h("strong", { text: it.price }), it.price_as_of ? h("span", { class: "muted", text: " as of " + it.price_as_of }) : null));
    if (it.link) main.append(h("a", { class: "link", href: it.link, target: "_blank", rel: "noopener noreferrer" }, "View on " + host(it.link), icon("ext")));
    wrap.append(h("div", { class: "card wish" + (isFull(it) ? " bought" : ""), "data-item": it.name }, itemPhoto(it, "wish-img"), main, claimSide(it)));
  });
  return wrap;
}

function itemPhoto(it, cls) {
  if (!it.image_url) return null;
  var img = h("img", { class: cls, src: it.image_url, alt: it.name, loading: "lazy", referrerpolicy: "no-referrer", "data-photo": it.name });
  img.addEventListener("error", function () { img.remove(); });
  return img;
}

/* purchases summary */
function purchasesView() {
  var data = [];
  gd.members.forEach(function (m) {
    if (m === myId) return;
    var info = listFor(m); if (info.state !== "ready") return;
    var bought = info.items.filter(iBought);
    var cents = 0, priced = 0;
    bought.forEach(function (it) { var v = paidAmount(it); if (v !== null) { cents += toCents(v); priced++; } });
    data.push({ member: m, total: info.items.length, bought: bought, cents: cents, priced: priced });
  });
  var n = data.reduce(function (s, p) { return s + p.bought.length; }, 0);
  var grand = data.reduce(function (s, p) { return s + p.cents; }, 0);
  var unpriced = data.reduce(function (s, p) { return s + p.bought.length - p.priced; }, 0);
  var withGifts = data.filter(function (p) { return p.bought.length; });
  var without = data.filter(function (p) { return !p.bought.length; });
  var wrap = h("div", { class: "panel" });
  wrap.append(h("div", { class: "page-head" }, h("h2", { text: "Your purchases" }),
    h("p", { class: "muted", text: n ? plural(n, "gift", "gifts") + " bought for " + plural(withGifts.length, "person", "people") + "." : "Nothing marked yet." })));
  if (!n) {
    wrap.append(h("div", { class: "card empty" }, h("h3", { text: "No purchases yet" }),
      h("p", { class: "muted", text: "Open someone’s list and tap Mark as purchased. The gift will show up here." }),
      h("button", { class: "btn sm", type: "button", onclick: function () { setView("members"); }, text: "Browse lists" })));
    return wrap;
  }
  // status overview: where everything stands, and which stores the gifts come from
  var mineAll = [];
  data.forEach(function (p) { p.bought.forEach(function (it) { mineAll.push(it); }); });
  var counts = h("dl", { class: "stats3" });
  var storeLine = h("div", { class: "chips", id: "store-chips" });
  paintSummary = function () {
    var c = { ordered: 0, shipped: 0, arrived: 0 }, st = new Map();
    mineAll.forEach(function (it) { c[statusOf(it).key]++; var k = storeOf(it) || "No link"; st.set(k, (st.get(k) || 0) + 1); });
    counts.replaceChildren(
      h("div", null, h("dt", { text: "Purchased" }), h("dd", { id: "cnt-ordered", text: String(c.ordered) })),
      h("div", null, h("dt", { text: "On its way" }), h("dd", { id: "cnt-shipped", text: String(c.shipped) })),
      h("div", null, h("dt", { text: "In hand" }), h("dd", { id: "cnt-arrived", text: String(c.arrived) })));
    storeLine.replaceChildren();
    Array.from(st.entries()).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); }).forEach(function (e) {
      storeLine.append(h("span", { class: "chip grey", "data-store": e[0], text: e[0] + " · " + e[1] }));
    });
  };
  wrap.append(h("div", { class: "card stack", id: "status-summary" }, h("h3", { text: "Where everything stands" }), counts,
    h("div", null, h("p", { class: "muted", style: "font-size:13px;margin-bottom:6px", text: "Stores" }), storeLine),
    h("p", { class: "muted", style: "font-size:13px", text: "Notes, tracking links and arrival are private to you." })));
  paintSummary();
  wrap.append(h("div", { class: "card", id: "grand-total" },
    h("div", { class: "prog-row" }, h("span", { text: "Total spent on all lists" }), h("span", { text: plural(withGifts.length, "list", "lists") })),
    h("div", { class: "total", id: "grand-amount", text: fmtMoney(grand) }),
    h("p", { class: "muted", style: "font-size:13px;margin-top:4px", text: unpriced
      ? plural(unpriced, "purchase doesn’t", "purchases don’t") + " have a price yet. Add what you paid below. Only you can see these amounts."
      : "Only you can see these amounts." })));
  withGifts.forEach(function (p) {
    var rows = p.bought.map(function (it) { return buyCard(it); });
    wrap.append(h("div", { class: "card", "data-list": p.member },
      h("div", { class: "who-head" }, avatar(p.member, "md"),
        h("div", { style: "flex:1;min-width:0" }, h("h3", { text: nameOf(p.member) }), h("p", { class: "muted", text: p.bought.length + " of " + p.total + " bought" })),
        h("div", { class: "list-total", "data-total": "list", text: fmtMoney(p.cents) })),
      h("ul", { class: "buylist" }, rows),
      h("button", { class: "btn sm ghost", type: "button", onclick: function () { setView("member:" + p.member); }, text: "Open " + possessive(p.member) + " list" })));
  });
  if (without.length) {
    wrap.append(h("div", { class: "note warn" }, icon("lock"),
      h("span", { text: "Still to shop for: " + without.map(function (p) { return nameOf(p.member) + " (" + plural(p.total, "item", "items") + ")"; }).join(", ") + "." })));
  }
  return wrap;
}

/* admin: invite link, members, archive */
function inviteUrl() {
  return location.origin + location.pathname + "?join=" + gd.code;
}
async function copyText(text, input) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try { input.focus(); input.select(); return document.execCommand("copy"); } catch (e2) { return false; }
  }
}
function manageView() {
  var g = groupInfo();
  var wrap = h("div", { class: "panel" });
  wrap.append(h("div", { class: "page-head" }, h("h2", { text: "Manage group" }),
    h("p", { class: "muted", text: "Only you, the admin, can see this tab." })));

  // invite link
  var linkCard = h("div", { class: "card stack", id: "invite-card" }, h("h3", { text: "Invite link" }));
  if (g.archived_at) {
    linkCard.append(h("p", { class: "muted", text: "This group is archived and view-only, so the invite link no longer lets anyone join. Reopen the group to use it again." }));
  } else {
    linkCard.append(h("p", { class: "muted", text: g.kind === "registry" ? "Anyone with this link can view the lists and mark gifts as purchased after confirming their email. They can’t make lists of their own. Send it by text or email." : "Anyone with this link can join the group after confirming their email. Send it by text or email." }));
  }
  if (gd.code) {
    var input = h("input", { id: "invite-link", type: "text", readonly: true, disabled: g.archived_at ? true : null, value: inviteUrl(), "aria-label": "Invite link", onfocus: function (e) { e.target.select(); } });
    var copy = h("button", { class: "btn primary", type: "button", id: "copy-link", text: "Copy link", disabled: g.archived_at ? true : null });
    copy.addEventListener("click", async function () {
      var ok = await copyText(input.value, input);
      toast(ok ? "Link copied." : "Press and hold the link to copy it.");
    });
    linkCard.append(h("div", { class: "linkbox" }, input, copy));
  } else {
    linkCard.append(h("p", { class: "muted", text: "No link yet." }));
  }
  var newLink = h("button", { class: "btn sm", type: "button", id: "new-link", text: gd.code ? "Make a new link" : "Create link", disabled: g.archived_at ? true : null });
  newLink.addEventListener("click", async function () {
    newLink.disabled = true;
    try {
      await api(sb.rpc("generate_invite", { p_group: route.id }));
      await loadGroup(); renderPanel();
      toast(gd.code ? "New link ready. The old one no longer works." : "Link ready.");
    } catch (e) { toast(humanize(e)); newLink.disabled = false; }
  });
  linkCard.append(h("div", null, newLink));
  if (gd.code) linkCard.append(h("p", { class: "muted", style: "font-size:13px", text: "Making a new link switches the old one off. People already in the group stay in." }));
  wrap.append(linkCard);

  // name and event date
  wrap.append(detailsCard(g));

  // members
  var reg = g.kind === "registry";
  var people = h("div", { id: "member-list" });
  var frozen = !!g.archived_at;
  var peopleIds = gd.everyone.filter(function (m) { return !gd.recipients.has(m); });
  if (reg) wrap.append(listsCard(frozen));
  peopleIds.forEach(function (m) {
    var row = h("div", { class: "person", "data-member": nameOf(m) }, avatar(m, "sm"),
      h("span", { class: "pn", text: nameOf(m) + (m === myId ? " (you)" : "") }),
      m === myId ? h("span", { class: "chip gold", text: "Admin" }) : null,
      reg ? null : listFor(m).state === "ready" ? h("span", { class: "chip", text: "List shared" }) : h("span", { class: "chip grey", text: "No list yet" }));
    if (m !== myId) {
      var rm = h("button", { class: "btn sm danger rm-btn", type: "button", text: "Remove", "aria-label": "Remove " + nameOf(m),
        disabled: frozen ? true : null, title: frozen ? "This group is archived" : null });
      var conf = h("div", { class: "confirm rm-confirm", hidden: true },
        h("span", { text: "Remove " + nameOf(m) + "? Their list and everything they picked will be deleted. They can only come back with an invite link." }),
        h("button", { class: "btn sm primary rm-yes", type: "button", text: "Yes, remove", onclick: function () { removeMember(m, conf); } }),
        h("button", { class: "btn sm ghost", type: "button", text: "Cancel", onclick: function () { conf.hidden = true; rm.hidden = false; } }));
      rm.addEventListener("click", function () { conf.hidden = false; rm.hidden = true; });
      row.append(rm, conf);
    }
    people.append(row);
  });
  wrap.append(h("div", { class: "card" }, h("h3", { style: "margin-bottom:6px", text: reg ? plural(peopleIds.length, "person", "people") + " with access" : plural(peopleIds.length, "member", "members") }),
    reg && peopleIds.length <= 1 ? h("p", { class: "muted", text: "Nobody has opened the invite link yet." }) : null, people));

  // settings + archive
  var settings = h("div", { class: "card stack", id: "archive-card" }, h("h3", { text: "Group settings" }),
    h("dl", { class: "stats" },
      h("div", null, h("dt", { text: "Event date" }), h("dd", { text: fmtDay(g.event_date) })),
      h("div", null, h("dt", { text: "Minimum items" }), h("dd", { text: String(g.item_min) }))));
  if (!g.archived_at) {
    settings.append(h("p", { class: "muted", text: "Archiving freezes the group. No one can join, add or edit lists, or mark purchases. People can still view everything, and the group moves to the Archived tab. You can reopen it later." }));
    var arch = h("button", { class: "btn danger", type: "button", id: "archive-btn", text: "Archive group" });
    var conf = h("div", { class: "confirm", id: "archive-confirm", hidden: true },
      h("span", { text: "Archive " + g.name + "?" }),
      h("button", { class: "btn sm primary", type: "button", id: "archive-yes", onclick: function () { setArchived(true); }, text: "Yes, archive" }),
      h("button", { class: "btn sm ghost", type: "button", onclick: function () { conf.hidden = true; arch.hidden = false; }, text: "Cancel" }));
    arch.addEventListener("click", function () { conf.hidden = false; arch.hidden = true; });
    settings.append(h("div", null, arch), conf);
  } else {
    var datePassed = dateHasPassed(g.event_date);
    settings.append(h("p", { class: "muted", text: datePassed
        ? "This group is archived and view-only because its event date passed. To reopen it, choose a new date under Name and date."
        : "This group is archived. Everything is view-only. Reopening it turns joining, editing and purchases back on." }),
      h("div", null, h("button", { class: "btn", type: "button", id: "reopen-btn", disabled: datePassed ? true : null, onclick: function () { setArchived(false); }, text: "Reopen group" })));
  }
  wrap.append(settings);
  return wrap;
}
function detailsCard(g) {
  var passed = dateHasPassed(g.event_date);
  var locked = !!g.archived_at && !passed;     // archived by hand: reopen first. Archived by its date: a new date reopens it.
  var f = { name: g.name, date: String(g.event_date).slice(0, 10) };
  var err = h("p", { class: "err", hidden: true, role: "alert", id: "d-err" });
  var save = h("button", { class: "btn primary", type: "submit", id: "d-save", text: passed && g.archived_at ? "Save and reopen" : "Save changes", disabled: locked ? true : null });
  var form = h("form", { class: "stack", id: "d-form", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "d-name", text: g.kind === "registry" ? "Event name" : "Group name" }),
      h("input", { id: "d-name", type: "text", maxlength: "60", value: f.name, disabled: locked ? true : null, autocomplete: "off", oninput: function (e) { f.name = e.target.value; } })),
    h("div", { class: "field" }, h("label", { for: "d-date", text: "Event date" }),
      h("input", { id: "d-date", type: "date", min: todayStr(), value: f.date, disabled: locked ? true : null, oninput: function (e) { f.date = e.target.value; } })),
    err, h("div", null, save));
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var problem = !f.name.trim() ? "Give your group a name."
      : !f.date ? "Choose the event date."
      : dateHasPassed(f.date) ? "Choose an event date that is today or later." : "";
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true; save.disabled = true;
    var wasArchived = !!g.archived_at;
    try {
      await api(sb.rpc("edit_group", { p_group: route.id, p_name: f.name.trim(), p_event: f.date }));
      await loadGroups(); await loadGroup();
      renderMain();
      toast(wasArchived ? "Group reopened with the new date." : "Group updated.");
    } catch (ex) { err.textContent = humanize(ex); err.hidden = false; save.disabled = false; }
  });
  var card = h("div", { class: "card stack", id: "details-card" }, h("h3", { text: "Name and date" }));
  if (g.archived_at && passed) card.append(h("p", { class: "muted", id: "auto-note", text: "This group archived itself because its event date passed. Choose a new date to reopen it." }));
  else if (locked) card.append(h("p", { class: "muted", text: "This group is archived. Reopen it below to change its name or date." }));
  else card.append(h("p", { class: "muted", text: "When the event date passes, the group archives itself and becomes view-only." }));
  card.append(form);
  return card;
}
function listsCard(frozen, ids, title) {
  ids = ids || gd.members;
  var card = h("div", { class: "card", id: "lists-card" }, h("h3", { style: "margin-bottom:6px", text: title || plural(ids.length, "list", "lists") }));
  ids.forEach(function (m) {
    var n = (gd.items.get(m) || []).length;
    var input = h("input", { type: "text", maxlength: "40", value: nameOf(m), "aria-label": "Name for this list", class: "rename-input", disabled: frozen ? true : null });
    var save = h("button", { class: "btn sm", type: "button", text: "Rename", disabled: true });
    input.addEventListener("input", function () { save.disabled = frozen || !input.value.trim() || input.value.trim() === nameOf(m); });
    save.addEventListener("click", async function () {
      save.disabled = true;
      try {
        await api(sb.rpc("rename_list", { p_group: route.id, p_member: m, p_name: input.value.trim() }));
        await loadGroup(); renderPanel(); updateTabs(); toast("List renamed.");
      } catch (e) { toast(humanize(e)); save.disabled = false; }
    });
    var edit = h("button", { class: "btn sm", type: "button", text: "Edit items", disabled: frozen ? true : null, onclick: function () { setView("edit:" + m); } });
    var del = h("button", { class: "btn sm danger rm-btn", type: "button", text: "Delete", "aria-label": "Delete " + nameOf(m) + "’s list", disabled: frozen ? true : null });
    var conf = h("div", { class: "confirm rm-confirm", hidden: true },
      h("span", { text: "Delete " + nameOf(m) + "’s list and its " + plural(n, "wish", "wishes") + "? Anything people marked as purchased on it is cleared too." }),
      h("button", { class: "btn sm primary rm-yes", type: "button", text: "Yes, delete", onclick: function () { removeMember(m, conf, "list"); } }),
      h("button", { class: "btn sm ghost", type: "button", text: "Cancel", onclick: function () { conf.hidden = true; del.hidden = false; } }));
    del.addEventListener("click", function () { conf.hidden = false; del.hidden = true; });
    card.append(h("div", { class: "person", "data-list": nameOf(m) }, input, save, h("span", { class: "chip grey", text: plural(n, "wish", "wishes") }), edit, del, conf));
  });
  if (!ids.length) card.append(h("p", { class: "muted", text: "No lists yet. Add one from the Lists tab." }));
  return card;
}
async function removeMember(m, conf, what) {
  var who = nameOf(m);
  conf.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
  try {
    await api(what === "list" ? sb.rpc("delete_child_list", { p_group: route.id, p_member: m }) : sb.rpc("remove_member", { p_group: route.id, p_member: m }));
    await loadGroup(); renderPanel(); updateTabs();
    toast(what === "list" ? who + "’s list was deleted." : who + " was removed from the group.");
  } catch (e) {
    toast(humanize(e));
    conf.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
  }
}
async function setArchived(flag) {
  try {
    await api(sb.rpc("set_group_archived", { p_group: route.id, p_archived: flag }));
    await loadGroups(); await loadGroup();
    if (flag) editor = null;
    renderMain();
    toast(flag ? "Group archived. It now lives under Archived on your dashboard." : "Group reopened.");
  } catch (e) { toast(humanize(e)); }
}

/* ---------- boot ---------- */
async function boot() {
  var configured = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_URL.indexOf("YOUR-") < 0 && CFG.SUPABASE_ANON_KEY.indexOf("YOUR-") < 0;
  if (!configured || !window.supabase || !window.supabase.createClient) { phase = "setup"; render(); return; }
  try { joinCode = (new URLSearchParams(location.search).get("join") || "").trim(); } catch (e) { joinCode = ""; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  sb.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_OUT" && phase === "ready") { resetSession(); stopPolling(); phase = "signin"; authStep = "email"; render(); }
  });
  render();
  var s = await sb.auth.getSession();
  if (s && s.data && s.data.session) { session = s.data.session; await enter(); }
  else { await checkJoinLink(); phase = "signin"; render(); }
}
window.__wishlist = { boot: boot };
boot();
})();
