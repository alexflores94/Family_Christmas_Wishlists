(function () {
"use strict";

var CFG = window.WISHLIST_CONFIG || {};
var MIN_ITEMS = 3;
var POLL_MS = 30000;
var app = document.getElementById("app");
var toastEl = document.getElementById("toast");

/* ---------- state ---------- */
var sb = null;
var phase = "loading";          // loading | setup | signin | denied | error | ready
var session = null;
var authStep = "email";         // email | code
var authEmail = "", authCode = "", authMsg = "", authBusy = false;
var myKey = null;
var members = [];
var listMeta = new Map();       // owner -> {submitted_at}
var itemsByOwner = new Map();   // owner -> [items], others only after they submit
var buyerByItem = new Map();    // item id -> buyer key (the database never returns your own list's rows)
var view = "my";                // my | family | purchases | member:<key>
var editor = null;
var ui = {};
var lastDataSig = "";
var pollTimer = null;
var toastTimer = null;

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
function label(key) { var m = members.find(function (x) { return x.key === key; }); return m ? m.name : "Someone"; }
function possessive(key) { return label(key) + "’s"; }
function avatar(key, size) {
  return h("span", { class: "avatar s-" + size, style: "--mc:var(--m-" + key + ")", "aria-hidden": "true", text: label(key).charAt(0) });
}
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3600);
}
function rid() { return "n" + Math.random().toString(36).slice(2, 10); }
function blank() { return { id: null, key: rid(), name: "", description: "", link: "" }; }
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
function daysToChristmas() {
  var now = new Date(), y = now.getFullYear();
  var today = new Date(y, now.getMonth(), now.getDate());
  var t = new Date(y, 11, 25);
  if (today > t) t = new Date(y + 1, 11, 25);
  return Math.round((t - today) / 864e5);
}
function humanize(err) {
  var m = (err && err.message) || "";
  if (/at least 3 items/i.test(m)) return m;
  if (/jwt|expired|not authenticated/i.test(m)) return "You were signed out. Sign in again to keep going.";
  if (/fetch|network|failed to/i.test(m)) return "Couldn’t reach the server. Check your connection and try again.";
  return "Couldn’t save that. Try again in a moment.";
}

/* ---------- data ---------- */
async function loadData() {
  var res = await Promise.all([
    sb.from("members").select("key,name,sort").order("sort"),
    sb.from("lists").select("owner,submitted_at"),
    sb.from("items").select("id,owner,name,description,link,price,price_as_of,position,created_at").order("position").order("created_at"),
    sb.from("purchases").select("item_id,buyer")
  ]);
  for (var i = 0; i < res.length; i++) if (res[i].error) throw res[i].error;
  members = res[0].data || [];
  listMeta = new Map((res[1].data || []).map(function (r) { return [r.owner, r]; }));
  itemsByOwner = new Map();
  (res[2].data || []).forEach(function (it) {
    if (!itemsByOwner.has(it.owner)) itemsByOwner.set(it.owner, []);
    itemsByOwner.get(it.owner).push(it);
  });
  buyerByItem = new Map((res[3].data || []).map(function (r) { return [r.item_id, r.buyer]; }));
  var sig = JSON.stringify([Array.from(listMeta), Array.from(itemsByOwner), Array.from(buyerByItem)]);
  var changed = sig !== lastDataSig;
  lastDataSig = sig;
  return changed;
}
function listFor(key) {
  var lm = listMeta.get(key), items = itemsByOwner.get(key) || [];
  if (lm && lm.submitted_at && items.length) return { state: "ready", items: items };
  return { state: "pending", items: [] };
}
function iBought(item) { return buyerByItem.get(item.id) === myKey; }

/* ---------- auth ---------- */
function friendlyAuthError(err) {
  var m = (err && err.message) || "";
  if (/rate|seconds|too many/i.test(m)) return "Please wait a minute before asking for another code.";
  if (/database error|family|not allowed|signups/i.test(m)) return "That email isn’t on the family list. Ask Alex to add it.";
  if (/invalid|expired|token/i.test(m)) return "That code didn’t work. Check it, or ask for a new one.";
  return "Something went wrong. Check the address and try again.";
}
async function sendCode() {
  var email = authEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { authMsg = "Enter the email address you use with the family."; renderAuth(); return; }
  authEmail = email; authBusy = true; authMsg = ""; renderAuth();
  var r = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } });
  authBusy = false;
  if (r.error) { authMsg = friendlyAuthError(r.error); renderAuth(); return; }
  authStep = "code"; authCode = ""; authMsg = ""; renderAuth();
}
async function verifyCode() {
  var code = authCode.replace(/\s+/g, "");
  if (code.length < 6) { authMsg = "Enter the 6-digit code from the email."; renderAuth(); return; }
  authBusy = true; authMsg = ""; renderAuth();
  var r = await sb.auth.verifyOtp({ email: authEmail, token: code, type: "email" });
  authBusy = false;
  if (r.error || !r.data || !r.data.session) { authMsg = friendlyAuthError(r.error || { message: "invalid" }); renderAuth(); return; }
  session = r.data.session;
  await enter();
}
async function signOut() {
  stopPolling();
  try { await sb.auth.signOut(); } catch (e) { /* the local session is cleared either way */ }
  resetSession();
  phase = "signin"; authStep = "email"; authCode = ""; authMsg = "";
  render();
}
function resetSession() {
  session = null; myKey = null; members = []; listMeta = new Map(); itemsByOwner = new Map(); buyerByItem = new Map();
  editor = null; view = "my"; lastDataSig = "";
}

/* ---------- entering the app ---------- */
async function enter() {
  phase = "loading"; render();
  try {
    var who = await sb.rpc("me");
    if (who.error) throw who.error;
    myKey = who.data || null;
    if (!myKey) { phase = "denied"; render(); return; }
    await loadData();
    phase = "ready"; view = "my"; editor = null;
    render();
    startPolling();
  } catch (e) {
    if (/jwt|expired|not authenticated/i.test((e && e.message) || "")) { await signOut(); return; }
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
    var changed = await loadData();
    if (!changed) return;
    updateTabs();
    if (view !== "my") renderPanel();     // never rebuild the editor while someone is typing
  } catch (e) { /* keep showing what we have; the next poll retries */ }
}
document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") poll(); });

/* ---------- editor model ---------- */
function isBlankRow(it) { return !it.name.trim() && !it.description.trim() && !it.link.trim(); }
function cleanItems() {
  var complete = [], problems = 0;
  editor.items.forEach(function (it) {
    if (isBlankRow(it)) return;
    var n = it.name.trim(), d = it.description.trim(), nl = normLink(it.link);
    if (n && d && nl !== null) complete.push({ id: it.id, name: n, description: d, link: nl, ref: it }); else problems++;
  });
  return { complete: complete, problems: problems };
}
function sig(list) { return JSON.stringify(list.map(function (i) { return [i.id, i.name, i.description, i.link || ""]; })); }
function initEditor() {
  var mine = itemsByOwner.get(myKey) || [];
  var lm = listMeta.get(myKey);
  var submitted = !!(lm && lm.submitted_at);
  var items = mine.map(function (i) {
    return { id: i.id, key: i.id, name: i.name, description: i.description, link: i.link || "" };
  });
  while (!submitted && items.length < MIN_ITEMS) items.push(blank());
  if (items.length === 0) items.push(blank());
  editor = { items: items, submitted: submitted, saving: false, showErrors: false, baseSig: "" };
  editor.baseSig = sig(cleanItems().complete);
}
function editorDirty() {
  if (!editor) return false;
  var r = cleanItems();
  return sig(r.complete) !== editor.baseSig || r.problems > 0;
}
window.addEventListener("beforeunload", function (e) {
  if (phase === "ready" && editorDirty()) { e.preventDefault(); e.returnValue = ""; }
});

async function persistItems(complete) {
  var server = itemsByOwner.get(myKey) || [];
  var keep = new Set(complete.filter(function (c) { return c.id; }).map(function (c) { return c.id; }));
  var r, i;
  for (i = 0; i < complete.length; i++) {
    var c = complete[i];
    if (!c.id) continue;
    r = await sb.from("items").update({ name: c.name, description: c.description, link: c.link || null, position: i }).eq("id", c.id);
    if (r.error) throw r.error;
  }
  var fresh = [];
  complete.forEach(function (c, idx) { if (!c.id) fresh.push({ idx: idx, c: c }); });
  if (fresh.length) {
    r = await sb.from("items").insert(fresh.map(function (f) {
      return { owner: myKey, name: f.c.name, description: f.c.description, link: f.c.link || null, position: f.idx };
    })).select("id,position");
    if (r.error) throw r.error;
    (r.data || []).forEach(function (row) {
      var f = fresh.find(function (x) { return x.idx === row.position; });
      if (f) f.c.ref.id = row.id;
    });
  }
  // Remove last, so a submitted list never dips below 3 items on the way.
  for (i = 0; i < server.length; i++) {
    if (!keep.has(server[i].id)) {
      r = await sb.from("items").delete().eq("id", server[i].id);
      if (r.error) throw r.error;
    }
  }
}
async function afterSave() {
  await loadData();
  editor.items = editor.items.filter(function (it) { return !isBlankRow(it); });
  var lm = listMeta.get(myKey);
  editor.submitted = !!(lm && lm.submitted_at);
  while (!editor.submitted && editor.items.length < MIN_ITEMS) editor.items.push(blank());
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
  if (r.problems > 0 || r.complete.length < MIN_ITEMS) { rebuildItems(); updateBar(); return; }
  var first = !editor.submitted;
  editor.saving = true; updateBar();
  try {
    await persistItems(r.complete);
    if (first) {
      var s = await sb.rpc("submit_list");
      if (s.error) throw s.error;
    }
    editor.showErrors = false;
    await afterSave();
    toast(first ? "Your list is live. The family has been emailed." : "Changes saved.");
  } catch (e) { toast(humanize(e)); }
  editor.saving = false;
  renderPanel(); updateTabs();
}
async function toggleBought(item, btn) {
  if (btn) btn.disabled = true;
  var mine = iBought(item);
  var r = mine
    ? await sb.from("purchases").delete().eq("item_id", item.id)
    : await sb.from("purchases").insert({ item_id: item.id, buyer: myKey });
  if (r.error) {
    if (r.error.code === "23505") toast("Someone just marked that one as purchased.");
    else toast(humanize(r.error));
    try { await loadData(); } catch (e) { /* ignore */ }
  } else if (mine) buyerByItem.delete(item.id);
  else buyerByItem.set(item.id, myKey);
  updateTabs(); renderPanel();
}

/* ---------- views ---------- */
function render() {
  app.replaceChildren();
  ui = {};
  if (phase === "loading") { app.append(loadingView()); return; }
  if (phase === "setup") { app.append(setupView()); return; }
  if (phase === "signin") { renderAuth(); return; }
  if (phase === "denied") { app.append(deniedView()); return; }
  if (phase === "error") { app.append(errorView()); return; }
  app.append(mainView());
}
function loadingView() {
  return h("div", { class: "panel", "aria-busy": "true" },
    h("div", { class: "top" }, h("div", { class: "brand" }, h("span", { class: "eyebrow", text: "Christmas " + new Date().getFullYear() }), h("h1", { text: "Family Wishlist" }))),
    h("div", { class: "skeleton" }), h("div", { class: "skeleton" }));
}
function heroView(title, text) {
  return h("div", { class: "hero" },
    h("span", { class: "eyebrow", text: "Christmas " + new Date().getFullYear() + " · " + daysToChristmas() + " days to go" }),
    h("h1", { text: title }), text ? h("p", { text: text }) : null);
}
function setupView() {
  return h("div", { class: "panel" }, heroView("Almost ready", null),
    h("div", { class: "card" }, h("p", { text: "This site isn’t connected to its database yet. Open config.js and add the Supabase project URL and key, then reload the page." })));
}
function errorView() {
  return h("div", { class: "panel" }, heroView("Couldn’t load the wishlist", "Check your connection, then try again."),
    h("div", { class: "bar", style: "position:static" }, h("span", { class: "muted", text: "Your saved lists are safe." }),
      h("button", { class: "btn primary", type: "button", onclick: enter, text: "Try again" })));
}
function deniedView() {
  return h("div", { class: "panel" },
    heroView("This email isn’t on the family list", "You signed in as " + ((session && session.user && session.user.email) || "this account") + ", which isn’t one of the five family emails. Ask Alex to add it."),
    h("div", null, h("button", { class: "btn", type: "button", onclick: signOut, text: "Sign out" })));
}
function renderAuth() {
  app.replaceChildren();
  var wrap = h("div", { class: "panel" });
  wrap.append(heroView(
    authStep === "email" ? "Sign in to the family list" : "Check your email",
    authStep === "email"
      ? "Enter your email and we will send you a 6-digit code. No password needed."
      : "We sent a 6-digit code to " + authEmail + ". It can take a minute to arrive. Check spam if you don’t see it."));
  var card = h("form", { class: "card item", id: "auth-form", novalidate: true });
  card.addEventListener("submit", function (e) { e.preventDefault(); if (!authBusy) (authStep === "email" ? sendCode() : verifyCode()); });
  if (authStep === "email") {
    var f = h("div", { class: "field" }, h("label", { for: "auth-email", text: "Email" }),
      h("input", { id: "auth-email", type: "email", autocomplete: "email", inputmode: "email", placeholder: "you@example.com", value: authEmail,
        oninput: function (e) { authEmail = e.target.value; } }));
    card.append(f);
  } else {
    var g = h("div", { class: "field" }, h("label", { for: "auth-code", text: "6-digit code" }),
      h("input", { id: "auth-code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "8", placeholder: "123456", value: authCode,
        oninput: function (e) { authCode = e.target.value; } }));
    card.append(g);
  }
  if (authMsg) card.append(h("p", { class: "err", role: "alert", text: authMsg }));
  var row = h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });
  row.append(h("button", { class: "btn primary", type: "submit", id: "auth-go", disabled: authBusy ? true : null,
    text: authBusy ? "One moment…" : (authStep === "email" ? "Email me a code" : "Sign in") }));
  if (authStep === "code") {
    row.append(h("button", { class: "btn ghost", type: "button", id: "auth-resend", disabled: authBusy ? true : null, onclick: sendCode, text: "Send a new code" }));
    row.append(h("button", { class: "btn ghost", type: "button", id: "auth-back", onclick: function () { authStep = "email"; authMsg = ""; renderAuth(); }, text: "Use a different email" }));
  }
  card.append(row);
  wrap.append(card);
  app.append(wrap);
  var input = document.getElementById(authStep === "email" ? "auth-email" : "auth-code");
  if (input && !authBusy) input.focus();
}

function mainView() {
  var days = daysToChristmas();
  var chip = h("button", { class: "me-chip", type: "button", id: "me-chip", "aria-label": "Account menu for " + label(myKey), onclick: function () { ui.confirmRow.hidden = !ui.confirmRow.hidden; } },
    avatar(myKey, "sm"), h("span", { class: "nm", text: label(myKey) }));
  ui.confirmRow = h("div", { class: "confirm", hidden: true },
    h("span", { text: "Signed in as " + ((session && session.user && session.user.email) || label(myKey)) + "." }),
    h("button", { class: "btn sm primary", type: "button", id: "sign-out", onclick: signOut, text: "Sign out" }),
    h("button", { class: "btn sm ghost", type: "button", onclick: function () { ui.confirmRow.hidden = true; }, text: "Close" }));
  var top = h("div", { class: "top" },
    h("div", { class: "brand" }, h("span", { class: "eyebrow", text: "Christmas " + new Date().getFullYear() }), h("h1", { text: "Family Wishlist" })),
    h("div", { class: "top-right" },
      h("span", { class: "countdown", text: days === 0 ? "Merry Christmas" : days + (days === 1 ? " day" : " days") + " to Christmas" }), chip));
  ui.tabMy = h("button", { class: "tab", type: "button", role: "tab", id: "tab-my", onclick: function () { setView("my"); } });
  ui.tabFam = h("button", { class: "tab", type: "button", role: "tab", id: "tab-family", onclick: function () { setView("family"); } });
  ui.tabPur = h("button", { class: "tab", type: "button", role: "tab", id: "tab-purchases", onclick: function () { setView("purchases"); } });
  var tabs = h("div", { class: "tabs", role: "tablist" }, ui.tabMy, ui.tabFam, ui.tabPur);
  ui.panel = h("div", { class: "panel", id: "panel" });
  var root = h("div", { class: "panel" }, top, ui.confirmRow, tabs, ui.panel);
  setTimeout(function () { renderPanel(); updateTabs(); }, 0);
  return root;
}
function boughtCount() {
  var n = 0;
  members.forEach(function (m) {
    if (m.key === myKey) return;
    listFor(m.key).items.forEach(function (it) { if (iBought(it)) n++; });
  });
  return n;
}
function updateTabs() {
  if (!ui.tabMy) return;
  var onFam = view === "family" || view.indexOf("member:") === 0;
  ui.tabMy.setAttribute("aria-selected", view === "my" ? "true" : "false");
  ui.tabFam.setAttribute("aria-selected", onFam ? "true" : "false");
  ui.tabPur.setAttribute("aria-selected", view === "purchases" ? "true" : "false");
  ui.tabMy.replaceChildren(document.createTextNode("My list"));
  if (editor && !editor.submitted) ui.tabMy.append(h("span", { class: "badge warn", text: "Draft" }));
  var others = members.filter(function (m) { return m.key !== myKey; });
  var ready = others.filter(function (m) { return listFor(m.key).state === "ready"; }).length;
  ui.tabFam.replaceChildren(document.createTextNode("Family"), h("span", { class: "badge", title: ready + " of " + others.length + " lists ready", text: ready + "/" + others.length }));
  ui.tabPur.replaceChildren(document.createTextNode("Purchases"), h("span", { class: "badge", text: String(boughtCount()) }));
}
function setView(v) { view = v; renderPanel(); updateTabs(); window.scrollTo({ top: 0 }); }
function renderPanel() {
  if (!ui.panel) return;
  ui.panel.replaceChildren();
  if (view === "my") ui.panel.append(editorView());
  else if (view === "family") ui.panel.append(familyView());
  else if (view === "purchases") ui.panel.append(purchasesView());
  else ui.panel.append(memberView(view.slice(7)));
}

/* editor */
function editorView() {
  if (!editor) initEditor();
  var wrap = h("div", { class: "panel" });
  var pill = h("span", { class: "status-pill " + (editor.submitted ? "live" : "draft"), text: editor.submitted ? "Shared with the family" : "Draft. Nobody else can see it yet" });
  wrap.append(h("div", { class: "page-head" }, h("h2", { text: "Your list" }), pill,
    h("p", { class: "muted", text: editor.submitted
      ? "Edit anything below and save. The family sees changes right away."
      : "Add at least " + MIN_ITEMS + " things you’d love. Each needs a name and a short description. A link helps your family find the right one. Submitting emails the rest of the family." })));
  wrap.append(h("div", { class: "note" }, icon("lock"),
    h("span", { text: "Your family marks gifts as purchased so nobody doubles up. You won’t see which ones, so the surprise stays intact." })));
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
function itemCard(it, i) {
  var k = it.key;
  var errName = h("p", { class: "err", hidden: true, text: "Give this item a name." });
  var errDesc = h("p", { class: "err", hidden: true, text: "Add a short description, such as size, color or model." });
  var errLink = h("p", { class: "err", hidden: true, text: "That link doesn’t look right. Paste the full web address." });
  var fName = h("div", { class: "field" }), fDesc = h("div", { class: "field" }), fLink = h("div", { class: "field" });
  var inName = h("input", { id: "f-" + k + "-name", type: "text", maxlength: "80", value: it.name, autocomplete: "off", placeholder: "Item name",
    oninput: function (e) { it.name = e.target.value; changed(); } });
  var inDesc = h("textarea", { id: "f-" + k + "-desc", maxlength: "300", rows: "2", placeholder: "Size, color, model, or why you want it",
    oninput: function (e) { it.description = e.target.value; changed(); } });
  inDesc.value = it.description;
  var inLink = h("input", { id: "f-" + k + "-link", type: "url", inputmode: "url", maxlength: "2000", value: it.link, autocomplete: "off", placeholder: "https://",
    oninput: function (e) { it.link = e.target.value; changed(); }, onblur: function () { it._lt = true; paint(); } });
  fName.append(h("label", { for: "f-" + k + "-name", text: "Name" }), inName, errName);
  fDesc.append(h("label", { for: "f-" + k + "-desc", text: "Description" }), inDesc, errDesc);
  fLink.append(h("label", { for: "f-" + k + "-link" }, "Web link ", h("span", { class: "opt", text: "(optional)" })), inLink, errLink);
  var del = h("button", { class: "btn ghost sm danger", type: "button", "aria-label": "Remove item " + (i + 1), onclick: function () {
    editor.items = editor.items.filter(function (x) { return x !== it; });
    if (editor.items.length === 0) editor.items.push(blank());
    rebuildItems(); updateBar();
  } }, icon("trash"), "Remove");
  var card = h("div", { class: "card item" }, h("div", { class: "item-head" }, h("span", { class: "lbl", text: "Item " + (i + 1) }), del), fName, fDesc, fLink);
  function paint() {
    var n = it.name.trim(), d = it.description.trim(), l = it.link.trim();
    var touched = !!(n || d || l);
    var showAll = editor.showErrors && touched;
    var nameBad = showAll && !n, descBad = showAll && !d;
    var linkBad = l && normLink(l) === null && (editor.showErrors || it._lt);
    errName.hidden = !nameBad; errDesc.hidden = !descBad; errLink.hidden = !linkBad;
    fName.classList.toggle("bad", !!nameBad); fDesc.classList.toggle("bad", !!descBad); fLink.classList.toggle("bad", !!linkBad);
  }
  function changed() { paint(); updateBar(); }
  paint();
  return card;
}
function updateBar() {
  if (!ui.count) return;
  var r = cleanItems(), n = r.complete.length;
  var dirty = sig(r.complete) !== editor.baseSig || r.problems > 0;
  var msg, cls = "";
  if (r.problems > 0) { msg = r.problems + (r.problems === 1 ? " item needs" : " items need") + " a name and description"; cls = "bad"; }
  else if (n < MIN_ITEMS) { msg = n + " of " + MIN_ITEMS + " required items ready"; }
  else { msg = n + (n === 1 ? " item" : " items") + " ready"; cls = "ok"; }
  if (editor.submitted && !dirty && r.problems === 0 && n >= MIN_ITEMS) msg = "All changes saved · " + n + " items";
  ui.count.textContent = msg; ui.count.className = "count " + cls;
  ui.meter.replaceChildren();
  for (var i = 0; i < MIN_ITEMS; i++) ui.meter.append(h("i", { class: i < n ? "on" : "" }));
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

/* family */
function familyView() {
  var wrap = h("div", { class: "panel" });
  wrap.append(h("div", { class: "page-head" }, h("h2", { text: "Family lists" }),
    h("p", { class: "muted", text: "Open a list to see what they’d like. Mark a gift as purchased and everyone else will see it, so no one buys it twice." })));
  var grid = h("div", { class: "grid" });
  members.filter(function (m) { return m.key !== myKey; }).forEach(function (m) {
    var info = listFor(m.key), body;
    if (info.state === "ready") {
      var bought = info.items.filter(function (it) { return buyerByItem.has(it.id); }).length;
      body = h("div", null,
        h("div", { class: "prog-row" }, h("span", { text: info.items.length + (info.items.length === 1 ? " wish" : " wishes") }), h("span", { text: bought + " purchased" })),
        h("div", { class: "progress" }, h("b", { style: "width:" + Math.round(bought / info.items.length * 100) + "%" })));
    } else {
      body = h("p", { class: "meta", text: m.name + " hasn’t submitted a list yet." });
    }
    grid.append(h("button", { class: "tag", type: "button", disabled: info.state === "ready" ? null : true, onclick: function () { setView("member:" + m.key); } },
      h("div", { class: "who" }, avatar(m.key, "md"), h("h3", { text: m.name })), body));
  });
  wrap.append(grid);
  return wrap;
}
function memberView(member) {
  var info = listFor(member);
  var wrap = h("div", { class: "panel" });
  wrap.append(h("button", { class: "btn ghost back", type: "button", onclick: function () { setView("family"); } }, icon("back"), "All lists"));
  if (info.state !== "ready") {
    wrap.append(h("div", { class: "card empty" }, h("h3", { text: label(member) + " hasn’t shared a list yet" }),
      h("p", { class: "muted", text: "It will show up here as soon as they submit it." })));
    return wrap;
  }
  var items = info.items;
  var bought = items.filter(function (it) { return buyerByItem.has(it.id); }).length;
  wrap.append(h("div", { class: "who-head" }, avatar(member, "lg"),
    h("div", null, h("h2", { text: possessive(member) + " list" }), h("p", { class: "muted", text: items.length + (items.length === 1 ? " wish" : " wishes") }))));
  wrap.append(h("div", { class: "card" },
    h("div", { class: "prog-row" }, h("span", { text: "Purchased" }), h("span", { text: bought + " of " + items.length })),
    h("div", { class: "progress" }, h("b", { style: "width:" + Math.round(bought / items.length * 100) + "%" }))));
  items.forEach(function (it) {
    var buyer = buyerByItem.get(it.id), mine = buyer === myKey, side = h("div", { class: "wish-side" });
    if (mine) {
      side.append(h("button", { class: "buy mine", type: "button", "aria-pressed": "true", "aria-label": "Purchased by you. Undo for " + it.name,
        onclick: function (e) { toggleBought(it, e.currentTarget); } }, h("span", { class: "box" }, icon("check")), "Purchased by you"));
    } else if (buyer) {
      side.append(h("span", { class: "pill" }, icon("check"), "Purchased by " + label(buyer)));
    } else {
      side.append(h("button", { class: "buy", type: "button", "aria-pressed": "false", "aria-label": "Mark " + it.name + " as purchased",
        onclick: function (e) { toggleBought(it, e.currentTarget); } }, h("span", { class: "box" }), "Mark as purchased"));
    }
    var main = h("div", { class: "wish-main" }, h("h3", { text: it.name }), h("p", { class: "desc", text: it.description }));
    if (it.price) main.append(h("p", { class: "price" }, h("strong", { text: it.price }), it.price_as_of ? h("span", { class: "muted", text: " as of " + it.price_as_of }) : null));
    if (it.link) main.append(h("a", { class: "link", href: it.link, target: "_blank", rel: "noopener noreferrer" }, "View on " + host(it.link), icon("ext")));
    wrap.append(h("div", { class: "card wish" + (buyer ? " bought" : "") }, main, side));
  });
  return wrap;
}

/* purchases summary */
function purchasesView() {
  var data = [];
  members.forEach(function (m) {
    if (m.key === myKey) return;
    var info = listFor(m.key); if (info.state !== "ready") return;
    data.push({ member: m.key, total: info.items.length, bought: info.items.filter(iBought) });
  });
  var n = data.reduce(function (s, p) { return s + p.bought.length; }, 0);
  var withGifts = data.filter(function (p) { return p.bought.length; });
  var without = data.filter(function (p) { return !p.bought.length; });
  var wrap = h("div", { class: "panel" });
  wrap.append(h("div", { class: "page-head" }, h("h2", { text: "Your purchases" }),
    h("p", { class: "muted", text: n ? n + (n === 1 ? " gift" : " gifts") + " bought for " + withGifts.length + (withGifts.length === 1 ? " person" : " people") + "." : "Nothing marked yet." })));
  if (!n) {
    wrap.append(h("div", { class: "card empty" }, h("h3", { text: "No purchases yet" }),
      h("p", { class: "muted", text: "Open a family list and tap Mark as purchased. The gift will show up here." }),
      h("button", { class: "btn sm", type: "button", onclick: function () { setView("family"); }, text: "Browse family lists" })));
    return wrap;
  }
  withGifts.forEach(function (p) {
    var rows = p.bought.map(function (it) {
      return h("li", { class: "buyrow" }, h("span", { class: "bn", text: it.name }), h("span", { class: "muted bp", text: it.price || "" }));
    });
    wrap.append(h("div", { class: "card" },
      h("div", { class: "who-head" }, avatar(p.member, "md"),
        h("div", { style: "flex:1;min-width:0" }, h("h3", { text: label(p.member) }), h("p", { class: "muted", text: p.bought.length + " of " + p.total + " bought" }))),
      h("ul", { class: "buylist" }, rows),
      h("button", { class: "btn sm ghost", type: "button", onclick: function () { setView("member:" + p.member); }, text: "Open " + possessive(p.member) + " list" })));
  });
  if (without.length) {
    wrap.append(h("div", { class: "note warn" }, icon("lock"),
      h("span", { text: "Still to shop for: " + without.map(function (p) { return label(p.member) + " (" + p.total + (p.total === 1 ? " item" : " items") + ")"; }).join(", ") + "." })));
  }
  return wrap;
}

/* ---------- boot ---------- */
async function boot() {
  var configured = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_URL.indexOf("YOUR-") < 0 && CFG.SUPABASE_ANON_KEY.indexOf("YOUR-") < 0;
  if (!configured || !window.supabase || !window.supabase.createClient) { phase = "setup"; render(); return; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  sb.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_OUT" && phase === "ready") { resetSession(); stopPolling(); phase = "signin"; authStep = "email"; render(); }
  });
  render();
  var s = await sb.auth.getSession();
  if (s && s.data && s.data.session) { session = s.data.session; await enter(); }
  else { phase = "signin"; render(); }
}
window.__wishlist = { boot: boot };
boot();
})();
