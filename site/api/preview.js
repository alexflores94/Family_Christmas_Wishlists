/*
  Link preview helper (Vercel serverless function, served at /api/preview).

  Browsers are not allowed to read other websites' pages, so the site asks this function to fetch a product
  page and pull out its photo, title and price. It only ever returns those few fields.

  Safety:
   - Only signed-in people can use it (their Supabase session is checked with Supabase itself).
   - It refuses to fetch anything that is not a public web address (localhost, private networks, cloud
     metadata addresses). The check runs on the address actually connected to, so DNS tricks don't get around it.
   - Pages are limited in size and time, and redirects are followed manually (up to 4) with the same checks.

  Optional lock-down: set an environment variable SUPABASE_URL in Vercel (your project URL) so only your own
  Supabase project's sign-ins are accepted. Without it, any https://*.supabase.co sign-in is accepted.
*/
"use strict";

const dns = require("dns");
const net = require("net");
const http = require("http");
const https = require("https");

const MAX_BYTES = 1500000;
const TIMEOUT_MS = 7000;
const MAX_REDIRECTS = 4;

// Swapped out by the tests.
const deps = { allowPrivate: false, verify: verifySession };

/* ---------- address safety ---------- */
function isBlockedAddress(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return (
      p[0] === 0 || p[0] === 10 || p[0] === 127 ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 192 && p[1] === 0 && p[2] === 0) ||
      (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
      p[0] >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("::ffff:")) return isBlockedAddress(v.slice(7));
    return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") ||
      v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
  }
  return true;
}

// Used by http(s).request, so the check applies to the exact address the socket connects to.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const ok = (addresses || []).filter((a) => deps.allowPrivate || !isBlockedAddress(a.address));
    if (!ok.length) return callback(new Error("blocked address"));
    if (options && options.all) return callback(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });
}

function fetchPage(urlString, hop) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlString); } catch (e) { return reject(new Error("bad url")); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new Error("bad protocol"));
    if (u.username || u.password) return reject(new Error("bad url"));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, "")) && !deps.allowPrivate && isBlockedAddress(u.hostname.replace(/^\[|\]$/g, ""))) {
      return reject(new Error("blocked address"));
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, {
      method: "GET",
      lookup: safeLookup,
      timeout: TIMEOUT_MS,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WishlistPreview/1.0; +link preview)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.8",
        "Accept-Encoding": "identity"
      }
    }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if ((hop || 0) >= MAX_REDIRECTS) return reject(new Error("too many redirects"));
        let next;
        try { next = new URL(res.headers.location, u).href; } catch (e) { return reject(new Error("bad redirect")); }
        return resolve(fetchPage(next, (hop || 0) + 1));
      }
      const type = String(res.headers["content-type"] || "");
      if (code >= 400) { res.resume(); return resolve({ status: code, url: u.href, html: "" }); }
      if (type && !/html|xml/i.test(type)) { res.resume(); return resolve({ status: code, url: u.href, html: "" }); }
      const chunks = [];
      let size = 0;
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_BYTES) { res.destroy(); return; }
        chunks.push(c);
      });
      const done = () => resolve({ status: code, url: u.href, html: Buffer.concat(chunks).toString("utf8") });
      res.on("end", done);
      res.on("close", done);
      res.on("error", () => done());
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/* ---------- reading the page ---------- */
function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return m; } })
    .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return m; } });
}

function metaMap(html) {
  const map = {};
  const re = /<meta\s+([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const ar = /([a-zA-Z_:.\-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let a;
    while ((a = ar.exec(m[1]))) attrs[a[1].toLowerCase()] = decodeEntities(a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (key && attrs.content !== undefined && !(key in map)) map[key] = attrs.content.trim();
  }
  return map;
}

function jsonLdProducts(html) {
  const found = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const walk = (node, depth) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
    if (typeof node !== "object") return;
    const t = node["@type"];
    const types = Array.isArray(t) ? t : [t];
    if (types.some((x) => /^(Product|ProductGroup|IndividualProduct)$/i.test(String(x)))) found.push(node);
    if (node["@graph"]) walk(node["@graph"], depth + 1);
    if (node.hasVariant) walk(node.hasVariant, depth + 1);
  };
  while ((m = re.exec(html))) {
    try { walk(JSON.parse(m[1].trim()), 0); } catch (e) { /* ignore broken JSON-LD */ }
  }
  return found;
}

function firstString(v) {
  if (Array.isArray(v)) return firstString(v[0]);
  if (v && typeof v === "object") return firstString(v.url || v.contentUrl || v["@id"]);
  return typeof v === "string" ? v : "";
}

function cleanPrice(v) {
  if (v === undefined || v === null) return "";
  let s = String(v).trim().replace(/[^0-9.,]/g, "");
  if (!s) return "";
  // 1.234,56 -> 1234.56 ; 1,234.56 -> 1234.56 ; 12,99 -> 12.99
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (!isFinite(n) || n <= 0 || n >= 10000000) return "";
  return n.toFixed(2);
}

function pickOffer(offers) {
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const o of list) {
    if (!o || typeof o !== "object") continue;
    const spec = o.priceSpecification && (Array.isArray(o.priceSpecification) ? o.priceSpecification[0] : o.priceSpecification);
    const price = cleanPrice(o.price !== undefined ? o.price : o.lowPrice !== undefined ? o.lowPrice : spec && spec.price);
    if (price) return { price, currency: String(o.priceCurrency || (spec && spec.priceCurrency) || "") };
    if (o.offers) { const r = pickOffer(o.offers); if (r) return r; }
  }
  return null;
}

function absolute(href, base) {
  if (!href) return "";
  try {
    const u = new URL(decodeEntities(href).trim(), base);
    if (u.protocol === "http:") u.protocol = "https:";   // the site is https, so http images would be blocked
    return u.protocol === "https:" && u.href.length <= 2000 ? u.href : "";
  } catch (e) { return ""; }
}

function parseHtml(html, baseUrl) {
  html = String(html || "");
  const meta = metaMap(html);
  const products = jsonLdProducts(html);
  const out = { title: "", image: "", price: "", currency: "" };

  const p0 = products[0];
  out.title = (meta["og:title"] || meta["twitter:title"] || (p0 && p0.name) || "").toString();
  if (!out.title) {
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (t) out.title = decodeEntities(t[1]).replace(/\s+/g, " ").trim();
  }
  out.title = out.title.slice(0, 200);

  const imgCandidates = [meta["og:image:secure_url"], meta["og:image"], meta["twitter:image"], meta["twitter:image:src"], meta["image"]];
  products.forEach((p) => imgCandidates.push(firstString(p.image)));
  const linkImg = /<link[^>]+rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(html);
  if (linkImg) imgCandidates.push(linkImg[1]);
  for (const c of imgCandidates) { const a = absolute(c, baseUrl); if (a) { out.image = a; break; } }

  // price: structured data first, then the common meta tags
  for (const p of products) {
    const o = pickOffer(p.offers);
    if (o) { out.price = o.price; out.currency = o.currency; break; }
  }
  if (!out.price) {
    const mp = cleanPrice(meta["product:price:amount"] || meta["og:price:amount"] || meta["twitter:data1"] && /[$€£¥]|\d[.,]\d/.test(meta["twitter:data1"]) && meta["twitter:data1"] || meta["price"]);
    if (mp) { out.price = mp; out.currency = meta["product:price:currency"] || meta["og:price:currency"] || meta["pricecurrency"] || ""; }
  }
  if (!out.price) {
    const ip = /<[^>]+itemprop\s*=\s*["']price["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html);
    const cp = ip && cleanPrice(decodeEntities(ip[1]));
    if (cp) {
      out.price = cp;
      const ic = /<[^>]+itemprop\s*=\s*["']priceCurrency["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html);
      out.currency = ic ? decodeEntities(ic[1]) : "";
    }
  }
  out.currency = /^[A-Za-z]{3}$/.test(out.currency) ? out.currency.toUpperCase() : "";
  return out;
}

/* ---------- who is calling ---------- */
async function verifySession(req) {
  const auth = String(req.headers.authorization || "");
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const apikey = String(req.headers.apikey || "").trim();
  if (!token || !apikey) return false;
  let base = process.env.SUPABASE_URL ? String(process.env.SUPABASE_URL).replace(/\/+$/, "") : "";
  if (!base) {
    // The token says which project issued it. Accept only a real supabase.co project.
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      const iss = new URL(String(payload.iss || ""));
      if (iss.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/i.test(iss.hostname)) return false;
      base = iss.origin;
    } catch (e) { return false; }
  }
  try {
    const r = await fetch(base + "/auth/v1/user", { headers: { Authorization: "Bearer " + token, apikey } });
    return r.ok;
  } catch (e) { return false; }
}

/* ---------- the endpoint ---------- */
async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=300");
  const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
  if (req.method !== "GET") return send(405, { error: "method" });
  if (!(await deps.verify(req))) return send(401, { error: "Sign in first." });

  let target = "";
  try { target = new URL(req.url, "http://x").searchParams.get("url") || ""; } catch (e) { /* ignore */ }
  if (!/^https?:\/\//i.test(target) || target.length > 2000) return send(400, { error: "Enter a full web address." });

  try {
    const page = await fetchPage(target, 0);
    if (!page.html) return send(200, { ok: false, reason: page.status >= 400 ? "blocked" : "empty", status: page.status });
    const info = parseHtml(page.html, page.url);
    return send(200, { ok: !!(info.image || info.price), ...info, url: page.url });
  } catch (e) {
    return send(200, { ok: false, reason: /blocked/.test(String(e.message)) ? "private" : "unreachable" });
  }
}

module.exports = handler;
module.exports.parseHtml = parseHtml;
module.exports.isBlockedAddress = isBlockedAddress;
module.exports.cleanPrice = cleanPrice;
module.exports.deps = deps;
