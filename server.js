// Kafe to'lovlari — veb-sayt + Telegram bot + kunlik eslatma.
// Node.js 18+ kerak. Tashqi kutubxona yo'q: `node server.js` bilan ishga tushadi.
// Sozlamalar .env faylida (README.md ga qarang).
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

// ---------- .env ----------
try {
  for (const l of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {}

const TOKEN = process.env.BOT_TOKEN || "";
const ADMINS = (process.env.ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
const PORT = +process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const REMIND_HOUR = +(process.env.REMIND_HOUR ?? 10);
const REMIND_DAYS = +(process.env.REMIND_DAYS ?? 3);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const PREVIEW = process.argv.includes("--preview");

// ---------- Ma'lumotlar (JSON fayl, xavfsiz yozish + kunlik zaxira) ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let D = { items: {}, pays: {}, rate: 12700, rates: {}, meta: {} };
try { D = Object.assign(D, JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))); } catch (e) {}
D.meta = D.meta || {};
const ACCESS_KEY = process.env.ACCESS_KEY || D.meta.accessKey || (D.meta.accessKey = crypto.randomBytes(18).toString("hex"));

function save() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(D, null, 1));
  fs.renameSync(tmp, DATA_FILE);
  const bk = path.join(DATA_DIR, "backup-" + todayS() + ".json");
  if (!fs.existsSync(bk)) fs.copyFileSync(DATA_FILE, bk); // har kuni bitta zaxira nusxa
}

// ---------- Vaqt (Toshkent, UTC+5) ----------
const nowT = () => new Date(Date.now() + 5 * 3600e3);
const todayS = () => nowT().toISOString().slice(0, 10);
const pad = n => String(n).padStart(2, "0");
const addM = (p, k) => { let [y, m] = p.split("-").map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + "-" + pad(m); };
const dim = p => new Date(Date.UTC(+p.slice(0, 4), +p.slice(5), 0)).getUTCDate();
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
const MON = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const WD = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const mName = p => MON[+p.slice(5) - 1][0].toUpperCase() + MON[+p.slice(5) - 1].slice(1) + " " + p.slice(0, 4);
const dLabel = s => +s.slice(8) + "-" + MON[+s.slice(5, 7) - 1] + ", " + WD[new Date(s + "T00:00:00Z").getUTCDay()];

// ---------- Hisob-kitob (saytdagi bilan bir xil qoidalar) ----------
function rateFor(p) { const ks = Object.keys(D.rates || {}).sort(); if (!ks.length) return D.rate; let r = D.rates[ks[0]]; for (const k of ks) if (k <= p) r = D.rates[k]; return +r; }
const toUZS = (v, c, r) => c === "USD" ? v * r : v;
function amountFor(it, p) { if (it.over && it.over[p] != null) return +it.over[p]; const h = (it.amounts || []).slice().sort((a, b) => a.from < b.from ? -1 : 1); let v = h.length ? h[0].v : 0; for (const x of h) if (x.from <= p) v = x.v; return +v; }
function paidFor(id, p) { let s = 0; for (const x of Object.values(D.pays)) if (x.itemId === id && x.period === p) s += +x.amount; return s; }
function mk(id, it, p, due) { const amt = amountFor(it, p), paid = paidFor(id, p); return { id, it, p, due, amt, paid, rem: Math.max(0, amt - paid), dd: dayDiff(due, todayS()) }; }
function inst(p) {
  const out = [];
  for (const [id, it] of Object.entries(D.items)) {
    if (it.repeat === "once") { if (!it.cancelled && it.date && it.date.slice(0, 7) === p) out.push(mk(id, it, p, it.date)); }
    else if (it.start <= p && !(it.end && p > it.end)) out.push(mk(id, it, p, p + "-" + pad(Math.min(it.day || 1, dim(p)))));
  }
  return out.sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
}
function allOpen() {
  const ps = Object.values(D.items).map(i => i.repeat === "once" ? (i.date || "").slice(0, 7) : i.start).filter(Boolean).sort();
  if (!ps.length) return [];
  let p = ps[0]; const lim = addM(todayS().slice(0, 7), 1), out = []; let g = 0;
  while (p <= lim && g++ < 60) { out.push(...inst(p).filter(x => x.rem > 0)); p = addM(p, 1); }
  return out.sort((a, b) => a.dd - b.dd);
}
const fmt = (v, c) => c === "USD" ? "$" + (+v).toLocaleString("en-US", { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString("ru-RU").replace(/[\s,]/g, " ") + " so'm";
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const sumUZS = a => a.reduce((s, x) => s + toUZS(x.rem, x.it.cur, rateFor(x.p)), 0);
const line = x => `• <b>${esc(x.it.name)}</b> — ${fmt(x.rem, x.it.cur)}${x.paid > 0 ? " (qoldiq)" : ""}${x.it.payee ? " → " + esc(x.it.payee) : ""}`;

// ---------- Bot matnlari ----------
function digestText() {
  const o = allOpen(), late = o.filter(x => x.dd < 0), today = o.filter(x => x.dd === 0), tom = o.filter(x => x.dd === 1), soon = o.filter(x => x.dd >= 2 && x.dd <= REMIND_DAYS);
  let t = `☀️ <b>Xayrli tong!</b> Bugun ${dLabel(todayS())}.\n<b>Kafe to'lovlari bo'yicha kunlik xabar</b>\n`;
  if (late.length) t += `\n⚠️ <b>Muddati o'tgan (${late.length} ta)</b>\n` + late.map(x => line(x) + ` — ${-x.dd} kun o'tdi`).join("\n") + `\nJami: <b>${fmt(sumUZS(late))}</b>\n`;
  if (today.length) t += `\n🔴 <b>Bugun to'lash kerak</b>\n` + today.map(line).join("\n") + `\nJami: <b>${fmt(sumUZS(today))}</b>\n`;
  t += `\n📅 <b>Ertangi reja (${dLabel(new Date(Date.parse(todayS()) + 864e5).toISOString().slice(0, 10))})</b>\n`;
  t += tom.length ? tom.map(line).join("\n") + `\nJami: <b>${fmt(sumUZS(tom))}</b>\n` : "Ertaga to'lov yo'q.\n";
  if (soon.length) t += `\n⏰ <b>To'lov payti kelmoqda (${REMIND_DAYS} kun ichida)</b>\n` + soon.map(x => line(x) + ` — ${x.dd} kun qoldi (${x.due.slice(8)}.${x.due.slice(5, 7)})`).join("\n") + "\n";
  if (!late.length && !today.length && !soon.length && !tom.length) t += `\n✅ Yaqin ${REMIND_DAYS} kunda to'lov yo'q.`;
  return { text: t, list: [...late, ...today, ...tom, ...soon] };
}
function monthText() {
  const p = todayS().slice(0, 7), L = inst(p);
  if (!L.length) return { text: `📋 <b>${mName(p)}</b>\nBu oyda to'lov kiritilmagan.`, list: [] };
  const st = x => x.rem <= 0 ? "✅" : x.dd < 0 ? "⚠️" : x.dd === 0 ? "🔴" : x.dd <= REMIND_DAYS ? "⏰" : "⏳";
  const due = L.reduce((s, x) => s + toUZS(x.amt, x.it.cur, rateFor(p)), 0), rem = sumUZS(L);
  return { text: `📋 <b>${mName(p)} — to'lovlar</b>\n\n` + L.map(x => `${st(x)} ${x.due.slice(8)}.${x.due.slice(5, 7)} <b>${esc(x.it.name)}</b> — ${fmt(x.amt, x.it.cur)}${x.rem > 0 && x.paid > 0 ? `, qoldi ${fmt(x.rem, x.it.cur)}` : ""}`).join("\n") +
    `\n\nJami: <b>${fmt(due)}</b>\nTo'landi: <b>${fmt(due - rem)}</b>\nQoldi: <b>${fmt(rem)}</b>\n\n✅ to'langan · ⚠️ muddati o'tgan · 🔴 bugun · ⏰ yaqin · ⏳ kutilmoqda`, list: L.filter(x => x.rem > 0) };
}
function listText(kind) {
  const o = allOpen();
  if (kind === "late") { const a = o.filter(x => x.dd < 0); return { text: a.length ? `⚠️ <b>Qarzlar — muddati o'tgan</b>\n\n` + a.map(x => line(x) + ` — ${mName(x.p)}, ${-x.dd} kun o'tdi`).join("\n") + `\n\nJami: <b>${fmt(sumUZS(a))}</b>` : "✅ Muddati o'tgan qarz yo'q.", list: a }; }
  if (kind === "soon") { const a = o.filter(x => x.dd >= 0 && x.dd <= 7); return { text: a.length ? `⏰ <b>Yaqin 7 kundagi to'lovlar</b>\n\n` + a.map(x => line(x) + ` — ${x.dd === 0 ? "bugun" : x.dd + " kun qoldi"} (${x.due.slice(8)}.${x.due.slice(5, 7)})`).join("\n") + `\n\nJami: <b>${fmt(sumUZS(a))}</b>` : "✅ Yaqin 7 kunda to'lov yo'q.", list: a }; }
  const a = o.filter(x => x.dd === 1);
  return { text: `📅 <b>Ertangi reja</b>\n\n` + (a.length ? a.map(line).join("\n") + `\n\nJami: <b>${fmt(sumUZS(a))}</b>` : "Ertaga to'lov yo'q."), list: a };
}

// ---------- Telegram ----------
async function tg(method, body) {
  if (!TOKEN) return {};
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json(); if (!j.ok) console.error("Telegram", method, j.description); return j;
  } catch (e) { console.error("Telegram ulanish xatosi:", e.message); return {}; }
}
const HTTPS = /^https:\/\//.test(PUBLIC_URL);
const MENU = { keyboard: [[{ text: "📋 Shu oy to'lovlari" }, { text: "⏰ Yaqin to'lovlar" }], [{ text: "⚠️ Qarzlar" }, { text: "📅 Ertangi reja" }], [{ text: "🌐 Saytni ochish" }]], resize_keyboard: true, is_persistent: true };
function payButtons(list) {
  return list.slice(0, 8).map(x => [{ text: `✅ To'landi: ${x.it.name.slice(0, 22)} (${x.due.slice(8)}.${x.due.slice(5, 7)})`, callback_data: `p|${x.id}|${x.p}` }]);
}
function siteButtons() {
  if (!HTTPS) return null;
  return [[{ text: "📱 Mini App'da ochish", web_app: { url: PUBLIC_URL + "/" } }], [{ text: "🌐 Brauzerda (Google) ochish", url: PUBLIC_URL + "/?key=" + ACCESS_KEY }]];
}
async function send(chat, { text, list }, withSite) {
  const kb = [...payButtons(list || []), ...((withSite && siteButtons()) || [])];
  return tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb.length ? { inline_keyboard: kb } : MENU });
}
async function onMessage(m) {
  const chat = String(m.chat.id), t = (m.text || "").trim();
  if (!ADMINS.includes(chat)) return tg("sendMessage", { chat_id: chat, text: `Bu bot faqat kafe egasi uchun. Sizning ID: ${chat}` });
  if (t.startsWith("/start") || t === "/menu") return tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text: `👋 <b>Kafe to'lovlari boti</b>\n\nHar kuni soat ${pad(REMIND_HOUR)}:00 da yaqinlashayotgan to'lovlar va ertangi reja haqida xabar yuboraman.\nPastdagi tugmalardan foydalaning.`, reply_markup: MENU });
  if (t.includes("Shu oy")) return send(chat, monthText(), true);
  if (t.includes("Yaqin")) return send(chat, listText("soon"));
  if (t.includes("Qarz")) return send(chat, listText("late"));
  if (t.includes("Ertangi")) return send(chat, listText("tom"));
  if (t.includes("Sayt") || t === "/sayt") {
    if (!HTTPS) return tg("sendMessage", { chat_id: chat, text: "Sayt hali internetga chiqarilmagan. .env faylida PUBLIC_URL ni https:// manzil bilan kiriting.", reply_markup: MENU });
    return tg("sendMessage", { chat_id: chat, text: "Saytni qayerda ochasiz?", reply_markup: { inline_keyboard: siteButtons() } });
  }
  if (t === "/xabar") return send(chat, digestText());
  return tg("sendMessage", { chat_id: chat, text: "Pastdagi tugmalardan birini tanlang.", reply_markup: MENU });
}
async function onCallback(q) {
  const chat = String(q.message?.chat?.id || q.from.id);
  if (!ADMINS.includes(String(q.from.id))) return tg("answerCallbackQuery", { callback_query_id: q.id, text: "Ruxsat yo'q" });
  const [k, id, p] = (q.data || "").split("|"), it = D.items[id];
  if (!it || !/^\d{4}-\d{2}$/.test(p || "")) return tg("answerCallbackQuery", { callback_query_id: q.id, text: "To'lov topilmadi" });
  const x = inst(p).find(y => y.id === id);
  if (!x || x.rem <= 0) return tg("answerCallbackQuery", { callback_query_id: q.id, text: "Bu to'lov allaqachon to'langan ✅", show_alert: true });
  if (k === "p") {
    await tg("answerCallbackQuery", { callback_query_id: q.id });
    return tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text: `<b>${esc(it.name)}</b> — ${mName(p)}\nQoldiq: <b>${fmt(x.rem, it.cur)}</b>\n\nTo'liq to'landi deb belgilaymi?\n<i>Qisman to'lov bo'lsa, saytdan kiriting.</i>`, reply_markup: { inline_keyboard: [[{ text: "✅ Ha, to'landi", callback_data: `c|${id}|${p}` }, { text: "❌ Yo'q", callback_data: `x|${id}|${p}` }]] } });
  }
  if (k === "x") { await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Bekor qilindi" }); return tg("deleteMessage", { chat_id: chat, message_id: q.message.message_id }); }
  if (k === "c") {
    const pid = "t" + q.id.replace(/\D/g, "").slice(-14) + id.slice(-4); // bir xil tugma ikki marta bosilsa ham bitta yozuv
    if (!D.pays[pid]) {
      D.pays[pid] = { itemId: id, period: p, amount: x.rem, cur: it.cur, rateAt: rateFor(p), date: todayS(), method: "Telegram orqali belgilandi", by: [q.from.first_name, q.from.last_name].filter(Boolean).join(" "), note: "", kind: "pay", at: new Date().toISOString() };
      save();
    }
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: "Saqlandi ✅" });
    return tg("editMessageText", { chat_id: chat, message_id: q.message.message_id, parse_mode: "HTML", text: `✅ <b>${esc(it.name)}</b> — ${mName(p)}: ${fmt(x.rem, it.cur)} to'landi deb yozildi (${todayS()}).` });
  }
}
async function poll() {
  if (!TOKEN) return console.log("BOT_TOKEN yo'q — bot o'chiq, faqat sayt ishlaydi.");
  await tg("deleteWebhook", {});
  if (HTTPS) await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Kafe to'lovlari", web_app: { url: PUBLIC_URL + "/" } } });
  await tg("setMyCommands", { commands: [{ command: "start", description: "Menyu" }, { command: "xabar", description: "Kunlik xabarni hozir ko'rish" }, { command: "sayt", description: "Saytni ochish" }] });
  let off = 0;
  for (;;) {
    const j = await tg("getUpdates", { offset: off, timeout: 50, allowed_updates: ["message", "callback_query"] });
    if (!j.ok) { await new Promise(r => setTimeout(r, 5000)); continue; }
    for (const u of j.result) {
      off = u.update_id + 1;
      try { if (u.message) await onMessage(u.message); else if (u.callback_query) await onCallback(u.callback_query); } catch (e) { console.error(e); }
    }
  }
}
// Har daqiqada tekshiradi: soat REMIND_HOUR dan keyin, kuniga bir marta yuboradi
async function tick() {
  if (!TOKEN || !ADMINS.length) return;
  const d = todayS();
  if (nowT().getUTCHours() >= REMIND_HOUR && D.meta.lastDigest !== d) {
    let ok = false;
    for (const a of ADMINS) ok = !!(await send(a, digestText())).ok || ok;
    if (ok) { D.meta.lastDigest = d; save(); console.log("Kunlik xabar yuborildi:", d); } // xato bo'lsa, keyingi daqiqada qayta urinadi
  }
}

// ---------- Veb-server ----------
function checkInit(initData) {
  if (!initData || !TOKEN) return null;
  const p = new URLSearchParams(initData), hash = p.get("hash"); if (!hash) return null;
  p.delete("hash");
  const dcs = [...p.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => k + "=" + v).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const h = crypto.createHmac("sha256", secret).update(dcs).digest("hex");
  if (h.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - +p.get("auth_date") > 7 * 86400) return null;
  try { const u = JSON.parse(p.get("user")); return ADMINS.includes(String(u.id)) ? u : null; } catch (e) { return null; }
}
const cookieKey = req => ((req.headers.cookie || "").match(/(?:^|;\s*)k=([a-f0-9]+)/) || [])[1];
const authed = req => cookieKey(req) === ACCESS_KEY || !!checkInit(req.headers["x-tg-init"]);
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
const body = req => new Promise((ok, no) => { let s = ""; req.on("data", c => { s += c; if (s.length > 1e6) { no(new Error("katta")); req.destroy(); } }); req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch (e) { no(e); } }); });
const ID = /^[A-Za-z0-9_-]{3,60}$/, PER = /^\d{4}-\d{2}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, n = 200) => String(v ?? "").slice(0, n);

const INDEX = path.join(__dirname, "public", "index.html");
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && u.pathname === "/") {
      if (u.searchParams.get("key") === ACCESS_KEY) {
        res.writeHead(302, { "set-cookie": `k=${ACCESS_KEY}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${HTTPS ? "; Secure" : ""}`, location: "/" }); return res.end();
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      return fs.createReadStream(INDEX).pipe(res);
    }
    if (!u.pathname.startsWith("/api/")) { res.writeHead(404); return res.end("Topilmadi"); }
    if (!authed(req)) return json(res, 401, { error: "ruxsat yo'q" });

    if (req.method === "GET" && u.pathname === "/api/state") return json(res, 200, { items: D.items, pays: D.pays, rate: D.rate, rates: D.rates, remindHour: REMIND_HOUR, remindDays: REMIND_DAYS, today: todayS() });
    if (req.method === "GET" && u.pathname === "/api/backup") {
      res.writeHead(200, { "content-type": "application/json", "content-disposition": `attachment; filename="kafe-zaxira-${todayS()}.json"` });
      return res.end(JSON.stringify({ items: D.items, pays: D.pays, rate: D.rate, rates: D.rates }, null, 1));
    }
    if (req.method !== "POST") return json(res, 405, { error: "method" });
    const b = await body(req);

    if (u.pathname === "/api/item") {
      const it = b.item || {};
      if (!ID.test(b.id || "") || !str(it.name).trim() || !Array.isArray(it.amounts)) return json(res, 400, { error: "noto'g'ri ma'lumot" });
      const clean = {
        name: str(it.name, 80).trim(), cat: str(it.cat, 40), payee: str(it.payee, 80), cur: it.cur === "USD" ? "USD" : "UZS",
        repeat: it.repeat === "once" ? "once" : "monthly", remind: Math.max(0, Math.min(30, +it.remind || 0)), note: str(it.note, 300),
        amounts: it.amounts.filter(a => a && typeof a.from === "string" && +a.v >= 0).slice(0, 200).map(a => ({ from: str(a.from, 7), v: +a.v })),
        over: Object.fromEntries(Object.entries(it.over || {}).filter(([k, v]) => PER.test(k) && +v >= 0).map(([k, v]) => [k, +v])),
        createdAt: str(it.createdAt || new Date().toISOString(), 30), updatedAt: new Date().toISOString(),
      };
      if (clean.repeat === "once") { if (!DAY.test(it.date || "")) return json(res, 400, { error: "sana" }); clean.date = it.date; clean.cancelled = !!it.cancelled; }
      else { if (!PER.test(it.start || "")) return json(res, 400, { error: "boshlanish oyi" }); clean.start = it.start; clean.day = Math.max(1, Math.min(31, +it.day || 1)); if (it.end && PER.test(it.end)) clean.end = it.end; }
      D.items[b.id] = clean; save(); return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/pay") {
      const p = b.pay || {};
      if (!ID.test(b.id || "")) return json(res, 400, { error: "id" });
      if (D.pays[b.id]) return json(res, 200, { ok: true, duplicate: true }); // bir to'lov ikki marta yozilmaydi
      if (!D.items[p.itemId] || !PER.test(p.period || "") || !DAY.test(p.date || "") || !isFinite(+p.amount) || +p.amount === 0) return json(res, 400, { error: "noto'g'ri to'lov" });
      if (p.kind === "storno") { const o = D.pays[p.ref]; if (!o || o.kind === "storno" || Object.values(D.pays).some(x => x.ref === p.ref)) return json(res, 400, { error: "storno" }); }
      else if (+p.amount < 0) return json(res, 400, { error: "summa" });
      D.pays[b.id] = { itemId: p.itemId, period: p.period, amount: +p.amount, cur: p.cur === "USD" ? "USD" : "UZS", rateAt: +p.rateAt || rateFor(p.period), date: p.date, method: str(p.method, 40), by: str(p.by, 60), note: str(p.note, 300), kind: p.kind === "storno" ? "storno" : "pay", ...(p.kind === "storno" ? { ref: p.ref } : {}), at: new Date().toISOString() };
      save(); return json(res, 200, { ok: true });
    }
    if (u.pathname === "/api/rates") {
      const r = Object.fromEntries(Object.entries(b.rates || {}).filter(([k, v]) => PER.test(k) && +v > 0).map(([k, v]) => [k, +v]));
      D.rates = r; if (+b.rate > 0) D.rate = +b.rate; save(); return json(res, 200, { ok: true });
    }
    json(res, 404, { error: "topilmadi" });
  } catch (e) { console.error(e); json(res, 500, { error: "server xatosi" }); }
});

if (PREVIEW) { console.log(digestText().text.replace(/<\/?[bi]>/g, "")); process.exit(0); }
save();
server.listen(PORT, () => {
  console.log(`Sayt ishga tushdi: http://localhost:${PORT}/?key=${ACCESS_KEY}`);
  if (PUBLIC_URL) console.log(`Internetdagi manzil: ${PUBLIC_URL}/?key=${ACCESS_KEY}`);
  console.log(`Kunlik xabar: har kuni ${pad(REMIND_HOUR)}:00 (Toshkent), ${REMIND_DAYS} kun oldin. Adminlar: ${ADMINS.join(", ") || "yo'q"}`);
});
setInterval(tick, 60e3); setTimeout(tick, 5e3);
poll();
