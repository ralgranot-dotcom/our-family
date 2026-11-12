// "המשפחה שלנו" — האפליקציה
// תוכנן ויוצר ע״י איתן נוה
import { html, render, useState, useEffect, useMemo, useRef } from "https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js";
import { APP, SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, AUTH_DOMAIN, EVENT_TYPES } from "./config.js";

// ================== חיבור לשרת ==================
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "our-family-auth" },
  realtime: { params: { eventsPerSecond: 5 } },
});
const FN_URL = `${SUPABASE_URL}/functions/v1/family-api`;

async function api(action, payload = {}) {
  const { data: s } = await sb.auth.getSession();
  const token = s?.session?.access_token || SUPABASE_ANON_KEY;
  let res;
  try {
    res = await fetch(FN_URL, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, ...payload }) });
  } catch (e) { throw new Error("אין חיבור לשרת. בדוק את חיבור האינטרנט ונסה שוב"); }
  let body = {};
  try { body = await res.json(); } catch (_) { body = {}; }
  if (!res.ok || body.ok === false) throw new Error(body.error || `השרת החזיר שגיאה (${res.status})`);
  return body;
}

// ================== עזרים ==================
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};
export function normalizeLogin(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  const digits = s.replace(/[\s\-()+.]/g, "");
  if (/^\d{9,15}$/.test(digits)) { let d = digits; if (d.startsWith("972")) d = "0" + d.slice(3); return { kind: "phone", value: d }; }
  return { kind: "email", value: s };
}
export async function authEmailFor(login) {
  const n = normalizeLogin(login);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("our-family:" + n.value));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  return `u${hex}@${AUTH_DOMAIN}`;
}
export function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function friendlyError(e) {
  const m = String(e?.message || e || "");
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return "אין חיבור לאינטרנט. נסה שוב כשהחיבור יחזור";
  if (/Invalid login credentials/i.test(m)) return "פרטי הכניסה שגויים. בדוק את המייל/הטלפון ואת הסיסמה";
  if (/row-level security|permission denied|violates row/i.test(m)) return "אין לך הרשאה לבצע פעולה זו";
  if (/JWT expired|invalid JWT|refresh token/i.test(m)) return "פג תוקף ההתחברות. יש להתחבר מחדש";
  if (/duplicate key/i.test(m)) return "הפריט כבר קיים";
  if (/ends_at/i.test(m)) return "שעת הסיום חייבת להיות אחרי שעת ההתחלה";
  return m || "אירעה שגיאה לא צפויה";
}
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = (iso, o = {}) => new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", ...o }).format(new Date(iso));
const fmtTime = (iso) => new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const fmtShort = (iso) => new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export function gematria(n) {
  n = Number(n) % 1000; if (!n) return "";
  const H = [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"], [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"], [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]];
  let out = "";
  while (n >= 400) { out += "ת"; n -= 400; }
  if (n === 15 || n === 16 || n % 100 === 15 || n % 100 === 16) { const h = n - (n % 100); for (const [v, l] of H) if (h >= v && v >= 100) { out += l; break; } out += n % 100 === 15 ? "טו" : "טז"; n = 0; }
  for (const [v, l] of H) while (n >= v) { out += l; n -= v; }
  return out.length > 1 ? out.slice(0, -1) + "״" + out.slice(-1) : out + "׳";
}
function hebDate(d, withYear = true) {
  try {
    const parts = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", withYear ? { day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "long" }).formatToParts(new Date(d));
    return parts.map((p) => ((p.type === "day" || p.type === "year") && /^\d+$/.test(p.value) ? gematria(p.value) : p.value)).join("");
  } catch (_) { return ""; }
}
function relTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "עכשיו";
  if (diff < 3600) return `לפני ${Math.floor(diff / 60)} דק׳`;
  if (diff < 86400) return `לפני ${Math.floor(diff / 3600)} שע׳`;
  return fmtShort(iso);
}
function typeInfo(t) {
  if (t && t.startsWith("custom:")) return { key: t, label: t.slice(7) || "אירוע", emoji: "✏️", color: "#7b8794" };
  return EVENT_TYPES.find((x) => x.key === t) || EVENT_TYPES.find((x) => x.key === "gathering");
}
function nameOf(p) { if (!p) return "בן משפחה"; return (p.nickname || `${p.first_name || ""} ${p.last_name || ""}`).trim() || "בן משפחה"; }
function fullName(p) { if (!p) return "בן משפחה"; return `${p.first_name || ""} ${p.last_name || ""}`.trim() || "בן משפחה"; }
const ROLE_LABEL = { owner: "מנהל ראשי", admin: "מנהל", member: "משתתף", junior: "משתתף צעיר" };
const STATUS_LABEL = { yes: "מגיע", no: "לא מגיע", maybe: "עדיין לא יודע" };
const STATUS_EMOJI = { yes: "🟢", no: "🔴", maybe: "🟡" };
function colorFor(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 55% 50%)`; }
function initials(p) {
  const a = (p?.first_name || "").trim(), b = (p?.last_name || "").trim();
  return ((a[0] || "") + (b[0] || "")) || "?";
}
function nextBirthday(bday) {
  if (!bday) return null;
  const [, m, d] = bday.split("-").map(Number);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let n = new Date(now.getFullYear(), m - 1, d);
  if (n < now) n = new Date(now.getFullYear() + 1, m - 1, d);
  return { date: n, days: Math.round((n - now) / 86400000) };
}
async function resizeImage(file, max = 400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
  } finally { URL.revokeObjectURL(url); }
}
function downloadText(name, text, type = "application/json") {
  const blob = new Blob([text], { type }); const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (_) { return false; } }
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

// ================== מאגר מצב גלובלי ==================
const store = {
  s: {
    boot: true, session: null, me: null, myMemberships: [], families: [], members: [], profiles: {}, events: [], rsvps: [], invitees: [],
    notifications: [], avatars: {}, familyId: LS.get("fam-current", null), online: navigator.onLine, syncing: false, lastSync: null,
    toast: null, update: null, queue: LS.get("fam-queue", []), loadError: null,
  },
  subs: new Set(),
  set(patch) { this.s = { ...this.s, ...(typeof patch === "function" ? patch(this.s) : patch) }; this.subs.forEach((f) => f(this.s)); },
};
function useStore() {
  const [s, setS] = useState(store.s);
  useEffect(() => { store.subs.add(setS); setS(store.s); return () => { store.subs.delete(setS); }; }, []);
  return s;
}
let toastTimer;
function toast(msg, kind = "") { clearTimeout(toastTimer); store.set({ toast: { msg, kind } }); toastTimer = setTimeout(() => store.set({ toast: null }), kind === "err" ? 5000 : 3000); }
const toastErr = (e) => toast(friendlyError(e), "err");

// ================== טעינת נתונים וסנכרון ==================
let loading = null, reloadTimer = null, channel = null;
function scheduleReload(ms = 400) { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => loadAll().catch(() => {}), ms); }

async function loadAll() {
  if (loading) return loading;
  loading = (async () => {
    const uid = store.s.session?.user?.id; if (!uid) return;
    store.set({ syncing: true });
    try {
      const { data: me, error: e1 } = await sb.from("fam_profiles").select("*").eq("id", uid).maybeSingle();
      if (e1) throw e1;
      const { data: mine, error: e2 } = await sb.from("fam_members").select("*").eq("user_id", uid);
      if (e2) throw e2;
      const famIds = (mine || []).map((m) => m.family_id);
      const activeIds = (mine || []).filter((m) => m.status === "active").map((m) => m.family_id);
      const [{ data: families }, { data: members }] = await Promise.all([
        famIds.length ? sb.from("fam_families").select("*").in("id", famIds) : { data: [] },
        activeIds.length ? sb.from("fam_members").select("*").in("family_id", activeIds) : { data: [] },
      ]);
      const ids = [...new Set([uid, ...(members || []).map((m) => m.user_id)])];
      const since = new Date(Date.now() - 120 * 86400000).toISOString();
      const [{ data: profs }, { data: events }, { data: notifs }] = await Promise.all([
        sb.from("fam_profiles").select("*").in("id", ids),
        activeIds.length ? sb.from("fam_events").select("*").in("family_id", activeIds).gte("starts_at", since).order("starts_at") : { data: [] },
        sb.from("fam_notifications").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(100),
      ]);
      const evIds = (events || []).map((e) => e.id);
      const [{ data: rsvps }, { data: invitees }] = await Promise.all([
        evIds.length ? sb.from("fam_rsvps").select("*").in("event_id", evIds) : { data: [] },
        evIds.length ? sb.from("fam_event_invitees").select("*").in("event_id", evIds) : { data: [] },
      ]);
      const profiles = {}; (profs || []).forEach((p) => (profiles[p.id] = p));
      let familyId = store.s.familyId;
      if (!activeIds.includes(familyId)) familyId = activeIds[0] || null;
      const next = { me: me || null, myMemberships: mine || [], families: families || [], members: members || [], profiles, events: events || [], rsvps: rsvps || [], invitees: invitees || [], notifications: notifs || [], familyId, lastSync: new Date().toISOString(), loadError: null };
      store.set(next); LS.set("fam-current", familyId);
      LS.set("fam-cache-" + uid, next);
      loadAvatars(profs || []);
    } catch (e) {
      store.set({ loadError: friendlyError(e) });
      throw e;
    } finally { store.set({ syncing: false }); loading = null; }
  })();
  return loading;
}
async function loadAvatars(profs) {
  const paths = profs.filter((p) => p.avatar_path).map((p) => p.avatar_path);
  if (!paths.length) return;
  const { data } = await sb.storage.from("fam-media").createSignedUrls(paths, 3600 * 6);
  const map = { ...store.s.avatars };
  (data || []).forEach((d) => { const p = profs.find((x) => x.avatar_path === d.path); if (p && d.signedUrl) map[p.id] = d.signedUrl; });
  store.set({ avatars: map });
}
function startRealtime(uid) {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("fam-live-" + uid);
  for (const t of ["fam_events", "fam_rsvps", "fam_members", "fam_profiles", "fam_event_invitees"]) channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => scheduleReload());
  channel.on("postgres_changes", { event: "*", schema: "public", table: "fam_notifications", filter: `user_id=eq.${uid}` }, () => scheduleReload(200));
  channel.subscribe();
}

// תור פעולות שנשמרו בזמן ניתוק (אישורי הגעה)
async function flushQueue() {
  const q = LS.get("fam-queue", []); if (!q.length || !navigator.onLine) return;
  const rest = [];
  for (const item of q) {
    try {
      if (item.type === "rsvp") {
        const { error } = await sb.from("fam_rsvps").upsert(item.row, { onConflict: "event_id,user_id" });
        if (error) throw error;
        api("notify", { kind: "rsvp", event_id: item.row.event_id }).catch(() => {});
      }
    } catch (e) { if (/fetch|network/i.test(String(e.message))) rest.push(item); }
  }
  LS.set("fam-queue", rest); store.set({ queue: rest });
  if (q.length !== rest.length) { toast(`סונכרנו ${q.length - rest.length} פעולות שנשמרו בזמן הניתוק`, "ok"); scheduleReload(100); }
}

// ================== התראות דחיפה ==================
function urlB64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function pushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIOS() && !isStandalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub ? "on" : "off";
}
async function enablePush() {
  const st = await pushStatus();
  if (st === "ios-install") throw new Error("באייפון: יש קודם להוסיף את האפליקציה למסך הבית (שיתוף ← הוסף למסך הבית), לפתוח אותה משם ואז להפעיל התראות");
  if (st === "unsupported") throw new Error("הדפדפן הזה לא תומך בהתראות. נסה לפתוח ב-Chrome או ב-Safari");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("לא ניתנה הרשאה להתראות. אפשר לאשר בהגדרות הדפדפן של האתר");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await sb.from("fam_push_subs").upsert({ endpoint: j.endpoint, user_id: store.s.session.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
  if (error) throw error;
}

// ================== עדכוני גרסה ==================
async function checkForUpdate(manual = false) {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    const v = await res.json();
    const info = { latest: v.version, min: v.min_supported, notes: v.notes || {}, available: cmpVer(v.version, APP.version) > 0, required: cmpVer(APP.version, v.min_supported || "0.0.0") < 0 };
    store.set({ update: info });
    if (manual) toast(info.available ? `קיימת גרסה חדשה: ${v.version}` : `האפליקציה מעודכנת (גרסה ${APP.version})`, info.available ? "" : "ok");
    return info;
  } catch (e) { if (manual) toast("לא ניתן לבדוק עדכונים כרגע. בדוק את החיבור לאינטרנט", "err"); return null; }
}
async function applyUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) { await reg.update(); if (reg.waiting) reg.waiting.postMessage("skipWaiting"); }
  } catch (_) {}
  setTimeout(() => location.reload(), 600);
}

// ================== רכיבי בסיס ==================
function Avatar({ id, size = 40 }) {
  const s = useStore(); const p = s.profiles[id]; const url = s.avatars[id];
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:${colorFor(id)}`;
  return url ? html`<img class="avatar" style=${st} src=${url} alt=${nameOf(p)} />` : html`<span class="avatar" style=${st} aria-label=${nameOf(p)}>${initials(p)}</span>`;
}
function Modal({ title, onClose, children }) {
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal" role="dialog" aria-label=${title}>
      <div class="row spread"><h2>${title}</h2><button class="icon-btn" onClick=${onClose} aria-label="סגירה">✕</button></div>
      ${children}
    </div></div>`;
}
function Field({ label, children, hint }) {
  return html`<div class="field"><label>${label}</label>${children}${hint ? html`<div class="small muted" style="margin-top:4px">${hint}</div>` : null}</div>`;
}
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { if (busy) return; setBusy(true); try { return await fn(); } catch (e) { toastErr(e); } finally { setBusy(false); } };
  return [busy, run];
}
function Confirm({ text, yes = "אישור", danger, onYes, onClose }) {
  const [busy, run] = useBusy();
  return html`<${Modal} title="אישור פעולה" onClose=${onClose}>
    <p>${text}</p>
    <div class="btn-grid"><button class=${"btn " + (danger ? "danger" : "primary")} disabled=${busy} onClick=${() => run(async () => { await onYes(); onClose(); })}>${busy ? "מבצע…" : yes}</button>
    <button class="btn" onClick=${onClose}>ביטול</button></div>
  <//>`;
}

// ================== מסך פתיחה ==================
function Splash() {
  return html`<div class="splash">
    <div class="logo">❤️</div>
    <h1>${APP.name}</h1>
    <div class="muted">${APP.tagline}</div>
    <div class="credit">${APP.credit}</div>
    <div class="small muted">גרסה ${APP.version}</div>
  </div>`;
}

// ================== התחברות והרשמה ==================
function AuthScreen() {
  const [tab, setTab] = useState("login");
  const [f, setF] = useState({ login: "", password: "", first: "", last: "" });
  const [busy, run] = useBusy();
  const [err, setErr] = useState("");
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const doLogin = () => run(async () => {
    setErr("");
    if (!f.login.trim() || !f.password) { setErr("יש למלא מייל/טלפון וסיסמה"); return; }
    const email = await authEmailFor(f.login);
    const { error } = await sb.auth.signInWithPassword({ email, password: f.password });
    if (error) setErr(friendlyError(error));
  });
  const doSignup = () => run(async () => {
    setErr("");
    if (!f.first.trim()) { setErr("יש להזין שם פרטי"); return; }
    if (!f.login.trim()) { setErr("יש להזין מייל או מספר טלפון"); return; }
    if (f.password.length < 6) { setErr("הסיסמה צריכה להכיל לפחות 6 תווים"); return; }
    try {
      await api("signup", { login: f.login, password: f.password, first_name: f.first, last_name: f.last });
    } catch (e) { setErr(e.message); return; }
    const email = await authEmailFor(f.login);
    const { error } = await sb.auth.signInWithPassword({ email, password: f.password });
    if (error) setErr(friendlyError(error)); else toast("ברוך הבא! החשבון נוצר בהצלחה", "ok");
  });
  const joinCode = LS.get("fam-pending-join", null);
  return html`<div class="splash" style="justify-content:flex-start;padding-top:48px">
    <div class="logo">❤️</div><h1>${APP.name}</h1><div class="muted" style="margin-bottom:18px">${APP.tagline}</div>
    <div class="card" style="width:100%;max-width:440px;text-align:start">
      ${joinCode ? html`<div class="ok-box small">הוזמנת להצטרף למשפחה 🎉 היכנס או הירשם, וההצטרפות תתבצע אוטומטית.</div>` : null}
      <div class="tabs"><button class=${tab === "login" ? "on" : ""} onClick=${() => { setTab("login"); setErr(""); }}>כניסה</button><button class=${tab === "signup" ? "on" : ""} onClick=${() => { setTab("signup"); setErr(""); }}>הרשמה</button></div>
      ${tab === "signup" ? html`
        <${Field} label="שם פרטי"><input class="input" value=${f.first} onInput=${up("first")} autocomplete="given-name" /><//>
        <${Field} label="שם משפחה"><input class="input" value=${f.last} onInput=${up("last")} autocomplete="family-name" /><//>` : null}
      <${Field} label="מייל או מספר טלפון" hint=${tab === "signup" ? "זה מה שתקליד בכל כניסה. אפשר מייל או טלפון — מה שנוח לך." : null}>
        <input class="input ltr" value=${f.login} onInput=${up("login")} inputmode="email" autocomplete="username" placeholder="050-1234567 / name@mail.com" />
      <//>
      <${Field} label="סיסמה"><input class="input ltr" type="password" value=${f.password} onInput=${up("password")} autocomplete=${tab === "login" ? "current-password" : "new-password"} onKeyDown=${(e) => e.key === "Enter" && (tab === "login" ? doLogin() : doSignup())} /><//>
      ${err ? html`<div class="err-box small">${err}</div>` : null}
      <button class="btn primary block big" disabled=${busy} onClick=${tab === "login" ? doLogin : doSignup}>${busy ? "רגע…" : tab === "login" ? "כניסה" : "יצירת חשבון"}</button>
      ${tab === "login" ? html`<p class="small muted center">שכחת סיסמה? מנהל המשפחה יכול לאפס לך סיסמה מתוך מסך "המשפחה".</p>` : null}
    </div>
    <div class="credit">${APP.credit} · גרסה ${APP.version}</div>
  </div>`;
}

// ================== הקמת משפחה / הצטרפות ==================
function Onboarding({ embedded, onDone }) {
  const s = useStore();
  const [name, setName] = useState("");
  const [code, setCode] = useState(LS.get("fam-pending-join", "") || "");
  const [busy, run] = useBusy();
  const pending = s.myMemberships.filter((m) => m.status === "pending");
  const create = () => run(async () => {
    if (!name.trim()) throw new Error("יש להזין שם למשפחה");
    const { data, error } = await sb.rpc("fam_create_family", { p_name: name });
    if (error) throw error;
    store.set({ familyId: data }); LS.set("fam-current", data);
    await loadAll(); toast("המשפחה נוצרה! עכשיו אפשר להזמין בני משפחה", "ok"); onDone && onDone();
  });
  const join = () => run(async () => {
    if (!code.trim()) throw new Error("יש להזין קוד הזמנה");
    await joinWithCode(code); onDone && onDone();
  });
  return html`<div class=${embedded ? "" : "page"}>
    ${!embedded ? html`<div class="hello">שלום, ${nameOf(s.me)} 👋</div><p class="muted">כדי להתחיל — הקם משפחה חדשה, או הצטרף למשפחה קיימת עם קוד הזמנה.</p>` : null}
    ${pending.length ? html`<div class="warn">⏳ בקשת ההצטרפות שלך ל${pending.map((p) => s.families.find((f) => f.id === p.family_id)?.name || "משפחה").join(", ")} ממתינה לאישור מנהל. תקבל התראה כשתאושר.</div>` : null}
    <div class="card"><h2>🔑 הצטרפות עם קוד הזמנה</h2>
      <${Field} label="קוד הזמנה (8 תווים)"><input class="input ltr" value=${code} onInput=${(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD2345" maxlength="12" /><//>
      <button class="btn green block" disabled=${busy} onClick=${join}>הצטרפות</button>
    </div>
    <div class="card"><h2>🏠 הקמת משפחה חדשה</h2>
      <${Field} label="שם המשפחה" hint="למשל: משפחת כהן, האחים, בני הדודים"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} maxlength="60" /><//>
      <button class="btn primary block" disabled=${busy} onClick=${create}>הקמת המשפחה</button>
      <p class="small muted">מי שמקים את המשפחה הופך למנהל הראשי שלה.</p>
    </div>
  </div>`;
}
async function joinWithCode(code) {
  const { data, error } = await sb.rpc("fam_join_with_code", { p_code: code });
  LS.del("fam-pending-join");
  if (error) throw error;
  if (data.status === "pending") {
    if (!data.already) api("notify", { kind: "join_request", family_id: data.family_id }).catch(() => {});
    toast(`הבקשה להצטרף ל${data.family_name} נשלחה למנהל לאישור`, "ok");
  } else { store.set({ familyId: data.family_id }); LS.set("fam-current", data.family_id); toast(`הצטרפת ל${data.family_name} 🎉`, "ok"); }
  await loadAll();
}

// ================== חישובי אירועים ==================
function familyMembers(s, fid) { return s.members.filter((m) => m.family_id === fid && m.status === "active"); }
function myRole(s, fid) { return s.myMemberships.find((m) => m.family_id === fid && m.status === "active")?.role; }
function isAdmin(s, fid) { return ["owner", "admin"].includes(myRole(s, fid)); }
function eventInvitees(s, ev) {
  const active = familyMembers(s, ev.family_id).map((m) => m.user_id);
  if (ev.invite_all) return active;
  const set = new Set(s.invitees.filter((i) => i.event_id === ev.id).map((i) => i.user_id)); set.add(ev.created_by);
  return active.filter((u) => set.has(u));
}
function eventStats(s, ev) {
  const inv = eventInvitees(s, ev); const rs = s.rsvps.filter((r) => r.event_id === ev.id && inv.includes(r.user_id));
  const yes = rs.filter((r) => r.status === "yes"), no = rs.filter((r) => r.status === "no"), maybe = rs.filter((r) => r.status === "maybe");
  const guests = yes.reduce((a, r) => a + (r.guests || 0), 0);
  return { invited: inv.length, yes: yes.length, no: no.length, maybe: maybe.length, pending: inv.length - rs.length, total: yes.length + guests, guests, inv, rs };
}
function myRsvp(s, ev) { return s.rsvps.find((r) => r.event_id === ev.id && r.user_id === s.session.user.id); }
const famEvents = (s) => s.events.filter((e) => e.family_id === s.familyId);
const upcoming = (s) => famEvents(s).filter((e) => e.status === "active" && new Date(e.ends_at || e.starts_at) >= new Date(Date.now() - 3 * 3600000));
function needsMyAnswer(s, ev) {
  return ev.status === "active" && ev.rsvp_required && new Date(ev.starts_at) > new Date() && eventInvitees(s, ev).includes(s.session.user.id) && !myRsvp(s, ev) && ev.created_by !== s.session.user.id;
}
function canRsvpNow(ev) { return ev.status === "active" && (!ev.rsvp_deadline || new Date(ev.rsvp_deadline) >= new Date()); }

function EventItem({ ev }) {
  const s = useStore(); const t = typeInfo(ev.event_type); const st = eventStats(s, ev); const mine = myRsvp(s, ev);
  return html`<div class=${"event-item" + (ev.status === "cancelled" ? " cancelled" : "")} onClick=${() => go("event-" + ev.id)}>
    <div class="bar" style=${"background:" + t.color}></div>
    <div class="emo">${t.emoji}</div>
    <div class="grow">
      <div class="t" style="font-weight:700">${ev.title}</div>
      <div class="small muted">${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}${ev.location ? " · " + ev.location : ""}</div>
      <div class="row wrap" style="gap:6px;margin-top:4px">
        ${ev.status === "cancelled" ? html`<span class="chip red">בוטל</span>` : null}
        ${ev.rsvp_required ? html`<span class="chip green">${st.yes} מגיעים${st.guests ? ` (+${st.guests})` : ""}</span>` : null}
        ${mine ? html`<span class="chip gray">${STATUS_EMOJI[mine.status]} ${STATUS_LABEL[mine.status]}</span>` : needsMyAnswer(s, ev) ? html`<span class="chip amber">ממתין לתשובתך</span>` : null}
      </div>
    </div>
  </div>`;
}

// ================== ניווט ==================
function go(route) { if (location.hash !== "#" + route) location.hash = route; else window.dispatchEvent(new HashChangeEvent("hashchange")); }
function useRoute() {
  const [r, setR] = useState(location.hash.slice(1) || "home");
  useEffect(() => { const f = () => { setR(location.hash.slice(1) || "home"); window.scrollTo(0, 0); }; window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return r;
}

// ================== מסך הבית ==================
function FamilySwitcher() {
  const s = useStore();
  const active = s.families.filter((f) => s.myMemberships.some((m) => m.family_id === f.id && m.status === "active"));
  if (active.length < 2) return null;
  return html`<select class="input" style="margin-bottom:12px" value=${s.familyId} onChange=${(e) => { store.set({ familyId: e.target.value }); LS.set("fam-current", e.target.value); }}>
    ${active.map((f) => html`<option value=${f.id}>${f.name}</option>`)}
  </select>`;
}
function Home() {
  const s = useStore(); const uid = s.session.user.id;
  const up = upcoming(s); const next = up[0];
  const waiting = up.filter((e) => needsMyAnswer(s, e));
  const unread = s.notifications.filter((n) => !n.read_at).length;
  const mine = up.filter((e) => e.created_by === uid);
  const fam = s.families.find((f) => f.id === s.familyId);
  const bdays = familyMembers(s, s.familyId).map((m) => ({ p: s.profiles[m.user_id], nb: nextBirthday(s.profiles[m.user_id]?.birthday) })).filter((x) => x.nb && x.nb.days <= 30).sort((a, b) => a.nb.days - b.nb.days);
  const pendingReq = isAdmin(s, s.familyId) ? s.members.filter((m) => m.family_id === s.familyId && m.status === "pending") : [];
  const nextStats = next ? eventStats(s, next) : null;
  return html`<div class="page">
    <${FamilySwitcher} />
    <div class="hello">שלום, ${nameOf(s.me)} 👋</div>
    <div class="muted" style="margin-bottom:14px">${fam?.name || ""} · ${hebDate(new Date())}</div>
    ${pendingReq.length ? html`<div class="warn row spread" onClick=${() => go("family")} style="cursor:pointer"><span>👤 ${pendingReq.length} בקשות הצטרפות ממתינות לאישורך</span><span>←</span></div>` : null}
    ${next ? html`<div class="card" onClick=${() => go("event-" + next.id)} style="cursor:pointer">
      <div class="small muted">האירוע המשפחתי הקרוב</div>
      <div class="row" style="margin:6px 0"><span style="font-size:2rem">${typeInfo(next.event_type).emoji}</span>
        <div class="grow"><div style="font-weight:800;font-size:1.15rem">${next.title}</div>
        <div class="muted small">${fmtDate(next.starts_at)} · ${fmtTime(next.starts_at)}${next.location ? " · " + next.location : ""}</div></div></div>
      ${nextStats.yes ? html`<div class="row"><div class="avatars">${nextStats.rs.filter((r) => r.status === "yes").slice(0, 7).map((r) => html`<${Avatar} id=${r.user_id} size=${32} />`)}</div><span class="small muted">${nextStats.total} מגיעים</span></div>` : html`<div class="small muted">עדיין אין אישורי הגעה</div>`}
    </div>` : html`<div class="card center"><div style="font-size:2rem">📅</div><p>אין אירועים מתוכננים כרגע.</p></div>`}
    <div class="stats">
      <button class="stat" onClick=${() => go("calendar")}><div class="n">${up.length}</div><div class="l">אירועים מתוכננים</div></button>
      <button class="stat" onClick=${() => waiting[0] && go("event-" + waiting[0].id)}><div class="n" style=${waiting.length ? "color:var(--amber)" : ""}>${waiting.length}</div><div class="l">הזמנות שממתינות לתשובתך</div></button>
      <button class="stat" onClick=${() => go("notifications")}><div class="n" style=${unread ? "color:var(--blue)" : ""}>${unread}</div><div class="l">התראות חדשות</div></button>
      <button class="stat" onClick=${() => go("calendar")}><div class="n">${mine.length}</div><div class="l">אירועים שאני מארגן</div></button>
    </div>
    <button class="btn warm block big" style="margin-bottom:16px" onClick=${() => go("new")}>➕ יצירת אירוע משפחתי</button>
    ${waiting.length ? html`<div class="card"><h2>🟡 ממתינים לתשובה שלך</h2>${waiting.map((e) => html`<${EventItem} ev=${e} />`)}</div>` : null}
    ${bdays.length ? html`<div class="card hide-simple"><h2>🎂 ימי הולדת קרובים</h2>${bdays.map((b) => html`<div class="list-item"><${Avatar} id=${b.p.id} size=${36} /><div class="grow"><div style="font-weight:600">${nameOf(b.p)}</div><div class="small muted">${fmtDate(b.nb.date, { weekday: undefined })} · ${hebDate(b.p.birthday, false)}</div></div><span class=${"chip " + (b.nb.days === 0 ? "warm" : "")}>${b.nb.days === 0 ? "היום! 🎉" : b.nb.days === 1 ? "מחר" : `בעוד ${b.nb.days} ימים`}</span></div>`)}</div>` : null}
    ${up.length > 1 ? html`<div class="card hide-simple"><h2>📅 בהמשך</h2>${up.slice(1, 6).map((e) => html`<${EventItem} ev=${e} />`)}</div>` : null}
  </div>`;
}

// ================== לוח שנה ==================
function CalendarScreen() {
  const s = useStore(); const uid = s.session.user.id;
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [sel, setSel] = useState(ymd(new Date()));
  const [view, setView] = useState("month");
  const [filter, setFilter] = useState("all");
  const [type, setType] = useState("all");
  const evs = famEvents(s).filter((e) => {
    if (type !== "all" && (type === "custom" ? !e.event_type.startsWith("custom:") : e.event_type !== type)) return false;
    if (filter === "invited") return eventInvitees(s, e).includes(uid);
    if (filter === "yes") return myRsvp(s, e)?.status === "yes";
    if (filter === "mine") return e.created_by === uid;
    return true;
  });
  const byDay = {}; evs.forEach((e) => { const k = ymd(new Date(e.starts_at)); (byDay[k] = byDay[k] || []).push(e); });
  const first = new Date(cursor); const start = new Date(first); start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const today = ymd(new Date());
  const monthName = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(cursor);
  const move = (n) => { const d = new Date(cursor); d.setMonth(d.getMonth() + n); setCursor(d); };
  const list = view === "list" ? evs.filter((e) => new Date(e.starts_at) >= new Date(Date.now() - 86400000)) : byDay[sel] || [];
  return html`<div class="page">
    <${FamilySwitcher} />
    <div class="tabs"><button class=${view === "month" ? "on" : ""} onClick=${() => setView("month")}>חודש</button><button class=${view === "list" ? "on" : ""} onClick=${() => setView("list")}>אירועים קרובים</button></div>
    <div class="row" style="margin-bottom:12px">
      <select class="input grow" value=${filter} onChange=${(e) => setFilter(e.target.value)}>
        <option value="all">כל האירועים</option><option value="invited">אירועים שהוזמנתי</option><option value="yes">אירועים שאישרתי</option><option value="mine">אירועים שאני מארגן</option>
      </select>
      <select class="input grow" value=${type} onChange=${(e) => setType(e.target.value)}>
        <option value="all">כל הסוגים</option>${EVENT_TYPES.map((t) => html`<option value=${t.key}>${t.emoji} ${t.label}</option>`)}<option value="custom">✏️ מותאם אישית</option>
      </select>
    </div>
    ${view === "month" ? html`<div class="card">
      <div class="cal-head"><button class="icon-btn" onClick=${() => move(-1)} aria-label="חודש קודם">→</button><div class="center"><div style="font-weight:800">${monthName}</div><div class="small muted">${hebDate(new Date(cursor.getFullYear(), cursor.getMonth(), 15), true).replace(/^\S+\s/, "")}</div></div><button class="icon-btn" onClick=${() => move(1)} aria-label="חודש הבא">←</button></div>
      <div class="cal-grid">
        ${["א", "ב", "ג", "ד", "ה", "ו", "ש"].map((d) => html`<div class="dow">${d}</div>`)}
        ${days.map((d) => { const k = ymd(d); const list = byDay[k] || []; return html`<div class=${"cal-day" + (d.getMonth() !== cursor.getMonth() ? " other" : "") + (k === today ? " today" : "") + (k === sel ? " sel" : "")} onClick=${() => setSel(k)}>
          <span>${d.getDate()}</span><span class="hd hide-simple">${hebDate(d, false).split(" ")[0]}</span>
          <div class="dots">${list.slice(0, 4).map((e) => html`<span class="dot" style=${"background:" + typeInfo(e.event_type).color}></span>`)}</div></div>`; })}
      </div></div>
      <h3>${fmtDate(sel + "T12:00")} · ${hebDate(sel + "T12:00")}</h3>` : null}
    ${list.length ? list.map((e) => html`<${EventItem} ev=${e} />`) : html`<p class="muted center">אין אירועים ${view === "month" ? "ביום זה" : "קרובים"}.</p>`}
    ${view === "month" ? html`<button class="btn block" onClick=${() => go("new?date=" + sel)}>➕ אירוע חדש ביום זה</button>` : null}
  </div>`;
}

// ================== יצירת/עריכת אירוע ==================
function EventForm({ editId, presetDate }) {
  const s = useStore(); const uid = s.session.user.id;
  const ev = editId ? s.events.find((e) => e.id === editId) : null;
  const fid = ev?.family_id || s.familyId;
  const members = familyMembers(s, fid);
  const role = myRole(s, fid);
  const customTypes = [...new Set(s.events.filter((e) => e.event_type.startsWith("custom:")).map((e) => e.event_type))];
  const init = () => {
    if (ev) { const st = new Date(ev.starts_at), en = ev.ends_at ? new Date(ev.ends_at) : null, dl = ev.rsvp_deadline ? new Date(ev.rsvp_deadline) : null;
      return { title: ev.title, type: ev.event_type.startsWith("custom:") ? "custom" : ev.event_type, customLabel: ev.event_type.startsWith("custom:") ? ev.event_type.slice(7) : "", date: ymd(st), start: hm(st), end: en ? hm(en) : "", location: ev.location || "", address: ev.address || "", description: ev.description || "", desired: ev.desired_count || "", rsvp: ev.rsvp_required, deadline: dl ? ymd(dl) : "", deadlineTime: dl ? hm(dl) : "20:00", suggest: ev.allow_suggestions, inviteAll: ev.invite_all, invitees: s.invitees.filter((i) => i.event_id === ev.id).map((i) => i.user_id) };
    }
    return { title: "", type: "shabbat", customLabel: "", date: presetDate || ymd(new Date(Date.now() + 86400000)), start: "19:00", end: "", location: "", address: "", description: "", desired: "", rsvp: true, deadline: "", deadlineTime: "20:00", suggest: true, inviteAll: true, invitees: [] };
  };
  const [f, setF] = useState(init);
  const [busy, run] = useBusy();
  const up = (k, isCheck) => (e) => setF({ ...f, [k]: isCheck ? e.target.checked : e.target.value });
  if (!fid) return html`<div class="page"><p>יש להצטרף למשפחה קודם.</p></div>`;
  if (!ev && role === "junior") return html`<div class="page"><div class="warn">למשתתף צעיר אין הרשאה ליצור אירועים. אפשר לבקש ממנהל המשפחה.</div></div>`;
  if (ev && !(ev.created_by === uid || isAdmin(s, fid))) return html`<div class="page"><div class="warn">רק מארגן האירוע או מנהל יכולים לערוך אותו.</div></div>`;

  const startDT = f.date && f.start ? new Date(`${f.date}T${f.start}`) : null;
  let endDT = f.date && f.end ? new Date(`${f.date}T${f.end}`) : null;
  if (endDT && startDT && endDT < startDT) endDT = new Date(endDT.getTime() + 86400000); // מסתיים אחרי חצות
  const conflicts = startDT ? s.events.filter((e) => e.family_id === fid && e.status === "active" && e.id !== editId && (() => {
    const a1 = new Date(e.starts_at).getTime(), a2 = e.ends_at ? new Date(e.ends_at).getTime() : a1 + 3 * 3600000;
    const b1 = startDT.getTime(), b2 = endDT ? endDT.getTime() : b1 + 3 * 3600000; return a1 < b2 && b1 < a2;
  })()) : [];

  const save = () => run(async () => {
    if (!f.title.trim()) throw new Error("יש להזין שם לאירוע");
    if (!startDT || isNaN(startDT)) throw new Error("יש לבחור תאריך ושעת התחלה");
    if (f.type === "custom" && !f.customLabel.trim()) throw new Error("יש להזין שם לסוג האירוע המותאם");
    if (!f.inviteAll && !f.invitees.length) throw new Error("יש לבחור לפחות מוזמן אחד, או לסמן 'כל המשפחה'");
    const deadline = f.rsvp && f.deadline ? new Date(`${f.deadline}T${f.deadlineTime || "20:00"}`) : null;
    if (deadline && deadline > startDT) throw new Error("המועד האחרון למענה צריך להיות לפני האירוע");
    const row = { title: f.title.trim(), event_type: f.type === "custom" ? "custom:" + f.customLabel.trim().slice(0, 30) : f.type, starts_at: startDT.toISOString(), ends_at: endDT ? endDT.toISOString() : null, location: f.location.trim() || null, address: f.address.trim() || null, description: f.description.trim() || null, desired_count: f.desired ? Number(f.desired) : null, rsvp_required: f.rsvp, rsvp_deadline: deadline ? deadline.toISOString() : null, allow_suggestions: f.suggest, invite_all: f.inviteAll };
    let id = editId;
    if (ev) {
      const { error } = await sb.from("fam_events").update(row).eq("id", editId); if (error) throw error;
    } else {
      const { data, error } = await sb.from("fam_events").insert({ ...row, family_id: fid, created_by: uid }).select("id").single(); if (error) throw error; id = data.id;
    }
    if (!f.inviteAll) {
      const cur = ev ? s.invitees.filter((i) => i.event_id === id).map((i) => i.user_id) : [];
      const add = f.invitees.filter((u) => !cur.includes(u)), del = cur.filter((u) => !f.invitees.includes(u));
      if (add.length) { const { error } = await sb.from("fam_event_invitees").insert(add.map((u) => ({ event_id: id, user_id: u }))); if (error) throw error; }
      if (del.length) { const { error } = await sb.from("fam_event_invitees").delete().eq("event_id", id).in("user_id", del); if (error) throw error; }
    }
    let notified = 0;
    try {
      if (!ev) notified = (await api("notify", { kind: "event_new", event_id: id })).recipients || 0;
      else {
        const ch = [];
        if (ev.starts_at !== row.starts_at) ch.push(`מועד חדש: ${fmtDate(row.starts_at)} ${fmtTime(row.starts_at)}`);
        if ((ev.location || null) !== row.location || (ev.address || null) !== row.address) ch.push(`מיקום חדש: ${row.location || row.address || "—"}`);
        if (ch.length) notified = (await api("notify", { kind: "event_changed", event_id: id, changes: ch.join("\n") })).recipients || 0;
      }
    } catch (e) { toast("האירוע נשמר, אבל שליחת ההתראות נכשלה: " + friendlyError(e), "err"); }
    await loadAll();
    toast(ev ? `האירוע עודכן${notified ? ` · נשלחה התראה ל-${notified}` : ""}` : `האירוע נוצר${notified ? ` · נשלחה הזמנה ל-${notified} בני משפחה` : ""}`, "ok");
    go("event-" + id);
  });

  return html`<div class="page">
    <h2 style="margin-top:0">${ev ? "עריכת אירוע" : "אירוע משפחתי חדש"}</h2>
    <div class="card">
      <${Field} label="שם האירוע"><input class="input" value=${f.title} onInput=${up("title")} maxlength="80" placeholder="למשל: ארוחת שבת אצל סבתא" /><//>
      <${Field} label="סוג האירוע"><select class="input" value=${f.type} onChange=${(e) => { const v = e.target.value; setF(v.startsWith("pick:") ? { ...f, type: "custom", customLabel: v.slice(12) } : { ...f, type: v }); }}>
        ${EVENT_TYPES.map((t) => html`<option value=${t.key}>${t.emoji} ${t.label}</option>`)}
        ${customTypes.map((t) => html`<option value=${"pick:" + t}>✏️ ${t.slice(7)}</option>`)}
        <option value="custom">✏️ סוג חדש / מותאם אישית…</option></select><//>
      ${f.type === "custom" ? html`<${Field} label="שם הקטגוריה"><input class="input" value=${f.customLabel} onInput=${up("customLabel")} maxlength="30" placeholder="למשל: חנוכת בית" /><//>` : null}
      <div class="row"><div class="grow"><${Field} label="תאריך"><input class="input" type="date" value=${f.date} onInput=${up("date")} /><//></div></div>
      ${f.date ? html`<div class="small muted" style="margin:-8px 0 12px">${hebDate(f.date + "T12:00")}</div>` : null}
      <div class="row"><div class="grow"><${Field} label="שעת התחלה"><input class="input" type="time" value=${f.start} onInput=${up("start")} /><//></div>
        <div class="grow"><${Field} label="שעת סיום משוערת"><input class="input" type="time" value=${f.end} onInput=${up("end")} /><//></div></div>
    </div>
    ${conflicts.length ? html`<div class="warn">⚠️ שים לב, קיים אירוע משפחתי נוסף במועד זה:${conflicts.map((c) => html`<div class="small" style="margin-top:4px">• ${c.title} — ${fmtTime(c.starts_at)}</div>`)}<div class="small muted" style="margin-top:6px">אפשר להמשיך בכל זאת או לבחור מועד אחר.</div></div>` : null}
    <div class="card">
      <${Field} label="מיקום"><input class="input" value=${f.location} onInput=${up("location")} placeholder="למשל: אצל סבא וסבתא" /><//>
      <${Field} label="כתובת מדויקת" hint="משמשת לכפתור הניווט (Waze / מפות)"><input class="input" value=${f.address} onInput=${up("address")} placeholder="רחוב, מספר, עיר" /><//>
      <${Field} label="תיאור"><textarea class="input" value=${f.description} onInput=${up("description")} maxlength="1000"></textarea><//>
    </div>
    <div class="card">
      <h3>👥 מוזמנים</h3>
      <label class="check"><input type="checkbox" checked=${f.inviteAll} onChange=${up("inviteAll", true)} /> כל המשפחה (${members.length})</label>
      ${!f.inviteAll ? members.filter((m) => m.user_id !== uid).map((m) => html`<label class="check"><input type="checkbox" checked=${f.invitees.includes(m.user_id)} onChange=${(e) => setF({ ...f, invitees: e.target.checked ? [...f.invitees, m.user_id] : f.invitees.filter((x) => x !== m.user_id) })} /><${Avatar} id=${m.user_id} size=${30} /> ${nameOf(s.profiles[m.user_id])}</label>`) : null}
      <div class="hr"></div>
      <label class="check"><input type="checkbox" checked=${f.rsvp} onChange=${up("rsvp", true)} /> נדרש אישור הגעה</label>
      ${f.rsvp ? html`<div class="row"><div class="grow"><${Field} label="מועד אחרון למענה (רשות)"><input class="input" type="date" value=${f.deadline} onInput=${up("deadline")} /><//></div>
        ${f.deadline ? html`<div class="grow"><${Field} label="שעה"><input class="input" type="time" value=${f.deadlineTime} onInput=${up("deadlineTime")} /><//></div>` : null}</div>` : null}
      <${Field} label="מספר משתתפים רצוי (רשות)"><input class="input" type="number" min="1" max="500" value=${f.desired} onInput=${up("desired")} /><//>
      <label class="check"><input type="checkbox" checked=${f.suggest} onChange=${up("suggest", true)} /> מותר למוזמנים להציע שינוי (בהודעה למארגן)</label>
    </div>
    <button class="btn primary block big" disabled=${busy} onClick=${save}>${busy ? "שומר…" : ev ? "💾 שמירת שינויים" : "✅ יצירת האירוע ושליחת הזמנות"}</button>
    <p class="small muted center">אירועים חוזרים, תמונת אירוע ותיאום מועדים בהצבעה — יתווספו בשלב הבא.</p>
  </div>`;
}

// ================== פרטי אירוע ==================
function mapsLinks(ev) {
  const q = encodeURIComponent(ev.address || ev.location || "");
  return { waze: `https://waze.com/ul?q=${q}&navigate=yes`, google: `https://www.google.com/maps/search/?api=1&query=${q}`, apple: `https://maps.apple.com/?q=${q}` };
}
function calLinks(ev) {
  const st = new Date(ev.starts_at), en = ev.ends_at ? new Date(ev.ends_at) : new Date(st.getTime() + 3 * 3600000);
  const z = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const g = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(ev.title)}&dates=${z(st)}/${z(en)}&details=${encodeURIComponent((ev.description || "") + "\n— " + APP.name)}&location=${encodeURIComponent(ev.address || ev.location || "")}`;
  const esc = (t) => String(t || "").replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Our Family//HE", "BEGIN:VEVENT", `UID:${ev.id}@our-family`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(st)}`, `DTEND:${z(en)}`, `SUMMARY:${esc(ev.title)}`, `LOCATION:${esc(ev.address || ev.location)}`, `DESCRIPTION:${esc(ev.description)}`, "BEGIN:VALARM", "TRIGGER:-PT3H", "ACTION:DISPLAY", `DESCRIPTION:${esc(ev.title)}`, "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  return { google: g, ics };
}
function EventScreen({ id }) {
  const s = useStore(); const uid = s.session.user.id;
  const ev = s.events.find((e) => e.id === id);
  const [modal, setModal] = useState(null);
  const mine = ev ? myRsvp(s, ev) : null;
  const [draft, setDraft] = useState(null);
  const [busy, run] = useBusy();
  useEffect(() => { setDraft(mine ? { status: mine.status, guests: mine.guests, note: mine.note || "" } : { status: null, guests: 0, note: "" }); }, [id, mine?.status, mine?.guests, mine?.note]);
  if (!ev) return html`<div class="page"><div class="card center"><p>האירוע לא נמצא, או שאין לך הרשאה לצפות בו.</p><button class="btn" onClick=${() => go("home")}>חזרה לבית</button></div></div>`;
  const t = typeInfo(ev.event_type); const st = eventStats(s, ev);
  const manager = ev.created_by === uid || isAdmin(s, ev.family_id);
  const invited = st.inv.includes(uid);
  const canAnswer = canRsvpNow(ev) && invited;
  const queued = s.queue.some((q) => q.type === "rsvp" && q.row.event_id === ev.id);
  const maps = mapsLinks(ev); const cal = calLinks(ev);
  const pct = (n) => (st.invited ? (n / st.invited) * 100 : 0);

  const saveRsvp = (status) => run(async () => {
    const d = { ...draft, status: status || draft.status };
    if (!d.status) throw new Error("יש לבחור מגיע / לא מגיע / עדיין לא יודע");
    setDraft(d);
    const row = { event_id: ev.id, user_id: uid, status: d.status, guests: d.status === "yes" ? Math.max(0, Math.min(30, Number(d.guests) || 0)) : 0, note: d.note.trim().slice(0, 200) || null };
    if (!navigator.onLine) {
      const q = LS.get("fam-queue", []).filter((x) => !(x.type === "rsvp" && x.row.event_id === ev.id)); q.push({ type: "rsvp", row, at: Date.now() });
      LS.set("fam-queue", q); store.set({ queue: q }); toast("אין חיבור — התשובה נשמרה ותישלח אוטומטית כשהחיבור יחזור"); return;
    }
    const { error } = await sb.from("fam_rsvps").upsert(row, { onConflict: "event_id,user_id" });
    if (error) throw error;
    api("notify", { kind: "rsvp", event_id: ev.id }).catch(() => {});
    await loadAll(); toast(`התשובה נשמרה: ${STATUS_LABEL[row.status]}`, "ok");
  });
  const share = async () => {
    const text = `${t.emoji} ${ev.title}\n${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}${ev.location ? "\n📍 " + ev.location : ""}\n\nפרטים ואישור הגעה באפליקציה "${APP.name}":\n${location.origin + location.pathname}#event-${ev.id}`;
    if (navigator.share) { try { await navigator.share({ title: ev.title, text }); return; } catch (_) { return; } }
    location.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  };
  const people = st.inv.map((u) => ({ u, r: st.rs.find((r) => r.user_id === u) })).sort((a, b) => ({ yes: 0, maybe: 1, no: 2 }[a.r?.status] ?? 3) - ({ yes: 0, maybe: 1, no: 2 }[b.r?.status] ?? 3));

  return html`<div class="page">
    <div class="card" style=${"border-top:6px solid " + t.color}>
      <div class="row"><span style="font-size:2.4rem">${t.emoji}</span><div class="grow">
        <div class="small muted">${t.label}</div>
        <div style="font-size:1.35rem;font-weight:800">${ev.title}</div></div></div>
      ${ev.status === "cancelled" ? html`<div class="err-box" style="margin-top:10px">❌ האירוע בוטל</div>` : null}
      <div style="margin-top:10px">📅 ${fmtDate(ev.starts_at)} <span class="muted small">(${hebDate(ev.starts_at)})</span></div>
      <div>🕐 ${fmtTime(ev.starts_at)}${ev.ends_at ? " – " + fmtTime(ev.ends_at) : ""}</div>
      ${ev.location || ev.address ? html`<div>📍 ${ev.location || ""}${ev.address ? html` <span class="muted small">${ev.address}</span>` : null}</div>` : null}
      <div class="row small muted" style="margin-top:6px"><${Avatar} id=${ev.created_by} size=${24} /> מארגן/ת: ${nameOf(s.profiles[ev.created_by])}</div>
      ${ev.description ? html`<p style="white-space:pre-wrap">${ev.description}</p>` : null}
      ${ev.rsvp_deadline ? html`<div class="small ${new Date(ev.rsvp_deadline) < new Date() ? "" : "muted"}">⏰ מועד אחרון למענה: ${fmtDate(ev.rsvp_deadline)} ${fmtTime(ev.rsvp_deadline)}${new Date(ev.rsvp_deadline) < new Date() ? " (עבר)" : ""}</div>` : null}
    </div>

    ${ev.rsvp_required && invited ? html`<div class="card"><h2>האם תגיע/י?</h2>
      ${!canAnswer ? html`<div class="warn small">${ev.status === "cancelled" ? "האירוע בוטל." : "המועד האחרון למענה עבר. לשינוי — פנה למארגן."}</div>` : null}
      ${queued ? html`<div class="warn small">⏳ התשובה שלך נשמרה במכשיר ותישלח כשהחיבור יחזור.</div>` : null}
      <div class="rsvp-btns">
        ${["yes", "no", "maybe"].map((k) => html`<button class=${k + (draft?.status === k ? " on" : "")} disabled=${!canAnswer || busy} onClick=${() => saveRsvp(k)}><span class="e">${STATUS_EMOJI[k]}</span>${STATUS_LABEL[k]}</button>`)}
      </div>
      ${draft?.status === "yes" ? html`<div class="row spread" style="margin-top:14px"><span>כמה נלווים יגיעו איתך?</span>
        <div class="stepper"><button disabled=${!canAnswer} onClick=${() => setDraft({ ...draft, guests: Math.min(30, (draft.guests || 0) + 1) })}>+</button><span class="v">${draft.guests || 0}</span><button disabled=${!canAnswer} onClick=${() => setDraft({ ...draft, guests: Math.max(0, (draft.guests || 0) - 1) })}>−</button></div></div>` : null}
      ${draft?.status ? html`<div class="field" style="margin-top:12px"><input class="input" value=${draft.note} onInput=${(e) => setDraft({ ...draft, note: e.target.value })} maxlength="200" placeholder=${ev.allow_suggestions ? "הערה אישית / הצעה לשינוי (רשות)" : "הערה אישית (רשות)"} disabled=${!canAnswer} /></div>
        ${mine && (mine.guests !== (draft.status === "yes" ? draft.guests : 0) || (mine.note || "") !== draft.note) || (!mine && draft.status) ? html`<button class="btn primary block" disabled=${!canAnswer || busy} onClick=${() => saveRsvp()}>שמירת התשובה</button>` : null}` : null}
      ${mine ? html`<div class="small muted" style="margin-top:8px">ענית ${relTime(mine.updated_at)}. אפשר לשנות בכל עת${ev.rsvp_deadline ? " עד המועד האחרון" : ""}.</div>` : null}
    </div>` : null}

    ${ev.rsvp_required ? html`<div class="card"><h2>📊 מצב אישורי הגעה</h2>
      <div class="countbar"><div style=${`width:${pct(st.yes)}%;background:var(--green)`}></div><div style=${`width:${pct(st.maybe)}%;background:var(--amber)`}></div><div style=${`width:${pct(st.no)}%;background:var(--red)`}></div></div>
      <div class="counts">
        <div><div class="n" style="color:var(--green)">${st.yes}</div><div class="l">🟢 מגיעים</div></div>
        <div><div class="n" style="color:var(--amber)">${st.maybe}</div><div class="l">🟡 מתלבטים</div></div>
        <div><div class="n" style="color:var(--red)">${st.no}</div><div class="l">🔴 לא מגיעים</div></div>
        <div><div class="n">${st.pending}</div><div class="l">⚪ טרם השיבו</div></div>
        <div><div class="n">${st.invited}</div><div class="l">מוזמנים</div></div>
        <div><div class="n" style="color:var(--blue)">${st.total}</div><div class="l">סה״כ משתתפים כולל נלווים</div></div>
      </div>
      ${ev.desired_count ? html`<div class="small muted center" style="margin-top:6px">יעד: ${ev.desired_count} משתתפים</div>` : null}
      <div class="hr"></div>
      ${people.map(({ u, r }) => html`<div class="list-item"><${Avatar} id=${u} size=${40} /><div class="grow">
        <div style="font-weight:600">${nameOf(s.profiles[u])}${u === uid ? " (אני)" : ""}</div>
        ${r?.note ? html`<div class="small">💬 ${r.note}</div>` : null}
        <div class="small muted">${r ? `ענה ${relTime(r.updated_at)}` : "טרם השיב"}${r?.status === "yes" && r.guests ? ` · +${r.guests} נלווים` : ""}</div></div>
        <span class=${"chip " + (r ? { yes: "green", no: "red", maybe: "amber" }[r.status] : "gray")}>${r ? STATUS_EMOJI[r.status] + " " + STATUS_LABEL[r.status] : "⚪ ממתין"}</span></div>`)}
    </div>` : null}

    <div class="card"><h2>🧭 הגעה והוספה ליומן</h2>
      ${ev.location || ev.address ? html`<div class="btn-grid" style="margin-bottom:10px">
        <a class="btn" href=${maps.waze} target="_blank" rel="noopener">🚗 Waze</a>
        <a class="btn" href=${maps.google} target="_blank" rel="noopener">🗺️ Google Maps</a>
        <a class="btn" href=${maps.apple} target="_blank" rel="noopener">🍎 Apple Maps</a></div>` : null}
      <div class="btn-grid">
        <a class="btn" href=${cal.google} target="_blank" rel="noopener">📅 Google Calendar</a>
        <button class="btn" onClick=${() => downloadText(`event-${ev.id.slice(0, 8)}.ics`, cal.ics, "text/calendar")}>📆 יומן אפל / אחר</button>
        <button class="btn" onClick=${share}>📤 שיתוף</button>
      </div>
    </div>

    ${manager && ev.status === "active" ? html`<div class="card"><h2>🛠️ כלי מארגן</h2>
      <div class="btn-grid">
        ${ev.rsvp_required ? html`<button class="btn warm" disabled=${!st.pending || busy} onClick=${() => run(async () => { const r = await api("notify", { kind: "rsvp_reminder", event_id: ev.id }); toast(`נשלחה תזכורת ל-${r.recipients} שטרם השיבו`, "ok"); })}>🔔 שליחת תזכורת לממתינים (${st.pending})</button>` : null}
        <button class="btn" onClick=${() => setModal("msg")}>✉️ הודעה למוזמנים</button>
        <button class="btn" onClick=${() => go("edit-" + ev.id)}>✏️ עריכת האירוע</button>
        <button class="btn danger" onClick=${() => setModal("cancel")}>❌ ביטול האירוע</button>
      </div></div>` : null}
    ${manager && ev.status === "cancelled" ? html`<div class="card"><div class="btn-grid">
      <button class="btn" onClick=${() => run(async () => { const { error } = await sb.from("fam_events").update({ status: "active" }).eq("id", ev.id); if (error) throw error; await loadAll(); toast("האירוע שוחזר", "ok"); })}>↩️ שחזור האירוע</button>
      <button class="btn danger" onClick=${() => setModal("delete")}>🗑️ מחיקה לצמיתות</button></div></div>` : null}

    ${modal === "msg" ? html`<${MessageModal} ev=${ev} onClose=${() => setModal(null)} />` : null}
    ${modal === "cancel" ? html`<${Confirm} text=${`לבטל את "${ev.title}"? כל המוזמנים יקבלו הודעה על הביטול.`} yes="כן, לבטל" danger onClose=${() => setModal(null)} onYes=${async () => {
      const { error } = await sb.from("fam_events").update({ status: "cancelled" }).eq("id", ev.id); if (error) throw error;
      try { await api("notify", { kind: "event_cancelled", event_id: ev.id }); } catch (e) { toast("האירוע בוטל, אבל ההודעה למוזמנים לא נשלחה: " + friendlyError(e), "err"); }
      await loadAll(); toast("האירוע בוטל והמוזמנים עודכנו", "ok"); }} />` : null}
    ${modal === "delete" ? html`<${Confirm} text="למחוק את האירוע לצמיתות, כולל כל אישורי ההגעה? אי אפשר לבטל פעולה זו." yes="מחיקה" danger onClose=${() => setModal(null)} onYes=${async () => {
      const { error } = await sb.from("fam_events").delete().eq("id", ev.id); if (error) throw error; await loadAll(); go("home"); toast("האירוע נמחק", "ok"); }} />` : null}
  </div>`;
}
function MessageModal({ ev, onClose }) {
  const [text, setText] = useState(""); const [aud, setAud] = useState("all"); const [busy, run] = useBusy();
  return html`<${Modal} title="הודעה למוזמנים" onClose=${onClose}>
    <div class="tabs"><button class=${aud === "all" ? "on" : ""} onClick=${() => setAud("all")}>לכל המוזמנים</button><button class=${aud === "yes" ? "on" : ""} onClick=${() => setAud("yes")}>רק למי שאישר</button></div>
    <textarea class="input" value=${text} onInput=${(e) => setText(e.target.value)} maxlength="300" placeholder="למשל: מי שיכול — להביא כיסאות 🙂"></textarea>
    <div class="small muted" style="margin:4px 0 12px">${text.length}/300</div>
    <button class="btn primary block" disabled=${busy || !text.trim()} onClick=${() => run(async () => { const r = await api("notify", { kind: "organizer_message", event_id: ev.id, message: text, audience: aud }); toast(`ההודעה נשלחה ל-${r.recipients}`, "ok"); onClose(); })}>${busy ? "שולח…" : "שליחה"}</button>
  <//>`;
}

// ================== המשפחה ==================
function FamilyScreen() {
  const s = useStore(); const uid = s.session.user.id; const fid = s.familyId;
  const fam = s.families.find((f) => f.id === fid);
  const admin = isAdmin(s, fid); const role = myRole(s, fid);
  const [modal, setModal] = useState(null);
  const [busy, run] = useBusy();
  const [audit, setAudit] = useState(null);
  if (!fam) return html`<div class="page"><${Onboarding} embedded /></div>`;
  const members = familyMembers(s, fid).sort((a, b) => ["owner", "admin", "member", "junior"].indexOf(a.role) - ["owner", "admin", "member", "junior"].indexOf(b.role));
  const pending = s.members.filter((m) => m.family_id === fid && m.status === "pending");
  const approve = (u, yes) => run(async () => {
    const { error } = await sb.rpc("fam_approve_member", { p_family: fid, p_user: u, p_approve: yes }); if (error) throw error;
    if (yes) api("notify", { kind: "member_approved", family_id: fid, target_user: u }).catch(() => {});
    await loadAll(); toast(yes ? "המשתתף אושר והצטרף למשפחה" : "הבקשה נדחתה", "ok");
  });
  const loadAudit = () => run(async () => { const { data, error } = await sb.from("fam_audit").select("*").eq("family_id", fid).order("at", { ascending: false }).limit(40); if (error) throw error; setAudit(data); });
  const AUDIT = { family_created: "הקים את המשפחה", invite_created: "יצר קוד הזמנה", joined_with_code: "הצטרף עם קוד", member_approved: "אישר הצטרפות", member_rejected: "דחה בקשת הצטרפות", role_changed: "שינה הרשאות", member_removed: "הסיר משתתף", member_left: "עזב את המשפחה", password_reset: "איפס סיסמה" };
  return html`<div class="page">
    <${FamilySwitcher} />
    <div class="card"><div class="row"><span style="font-size:2.2rem">👨‍👩‍👧‍👦</span><div class="grow"><div style="font-size:1.3rem;font-weight:800">${fam.name}</div><div class="small muted">${members.length} בני משפחה · התפקיד שלך: ${ROLE_LABEL[role]}</div></div>
      ${admin ? html`<button class="icon-btn" onClick=${() => setModal("rename")} aria-label="שינוי שם">✏️</button>` : null}</div></div>
    ${admin ? html`<button class="btn green block big" style="margin-bottom:14px" onClick=${() => setModal("invite")}>➕ הזמנת בני משפחה</button>` : null}
    ${admin && pending.length ? html`<div class="card"><h2>⏳ בקשות הצטרפות (${pending.length})</h2>${pending.map((m) => html`<div class="list-item"><${Avatar} id=${m.user_id} size=${40} /><div class="grow"><div style="font-weight:600">${fullName(s.profiles[m.user_id])}</div><div class="small muted ltr" style="text-align:end">${s.profiles[m.user_id]?.login_id || ""}</div></div>
      <button class="btn green" disabled=${busy} onClick=${() => approve(m.user_id, true)}>אישור</button><button class="btn danger" disabled=${busy} onClick=${() => approve(m.user_id, false)}>דחייה</button></div>`)}</div>` : null}
    <div class="card"><h2>בני המשפחה</h2>
      ${members.map((m) => { const p = s.profiles[m.user_id]; return html`<div class="list-item" style="cursor:pointer" onClick=${() => setModal({ member: m.user_id })}><${Avatar} id=${m.user_id} size=${44} />
        <div class="grow"><div style="font-weight:600">${nameOf(p)}${m.user_id === uid ? " (אני)" : ""}</div><div class="small muted">${[p?.family_role, p?.availability].filter(Boolean).join(" · ") || fullName(p)}</div></div>
        <span class=${"chip " + (m.role === "owner" ? "warm" : m.role === "admin" ? "" : "gray")}>${ROLE_LABEL[m.role]}</span></div>`; })}
    </div>
    <div class="card"><h2>משפחות נוספות</h2><p class="small muted">אפשר להשתייך לכמה קבוצות — למשל המשפחה המורחבת, האחים, בני הדודים. לכל קבוצה אירועים ולוח שנה משלה.</p>
      <button class="btn block" onClick=${() => setModal("another")}>➕ הקמה או הצטרפות למשפחה נוספת</button></div>
    ${admin ? html`<div class="card hide-simple"><h2>📜 יומן פעולות ניהול</h2>
      ${audit ? audit.map((a) => html`<div class="small list-item"><div class="grow">${nameOf(s.profiles[a.actor])} ${AUDIT[a.action] || a.action}${a.details?.user ? ` (${nameOf(s.profiles[a.details.user])})` : ""}</div><span class="muted">${fmtShort(a.at)}</span></div>`) : html`<button class="btn block" onClick=${loadAudit}>הצגת היומן</button>`}</div>` : null}
    ${role !== "owner" ? html`<button class="btn danger block" onClick=${() => setModal("leave")}>יציאה מהמשפחה</button>` : null}

    ${modal === "invite" ? html`<${InviteModal} fid=${fid} famName=${fam.name} onClose=${() => setModal(null)} />` : null}
    ${modal === "rename" ? html`<${RenameModal} fam=${fam} onClose=${() => setModal(null)} />` : null}
    ${modal === "another" ? html`<${Modal} title="משפחה נוספת" onClose=${() => setModal(null)}><${Onboarding} embedded onDone=${() => setModal(null)} /><//>` : null}
    ${modal === "leave" ? html`<${Confirm} text=${`לצאת מ${fam.name}? לא תראה יותר את האירועים של המשפחה הזו.`} yes="יציאה" danger onClose=${() => setModal(null)} onYes=${async () => { const { error } = await sb.rpc("fam_remove_member", { p_family: fid, p_user: uid }); if (error) throw error; store.set({ familyId: null }); await loadAll(); go("home"); }} />` : null}
    ${modal?.member ? html`<${MemberModal} fid=${fid} userId=${modal.member} onClose=${() => setModal(null)} />` : null}
  </div>`;
}
function RenameModal({ fam, onClose }) {
  const [name, setName] = useState(fam.name); const [busy, run] = useBusy();
  return html`<${Modal} title="שם המשפחה" onClose=${onClose}><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} maxlength="60" />
    <button class="btn primary block" style="margin-top:12px" disabled=${busy} onClick=${() => run(async () => { if (!name.trim()) throw new Error("יש להזין שם"); const { error } = await sb.from("fam_families").update({ name: name.trim() }).eq("id", fam.id); if (error) throw error; await loadAll(); toast("השם עודכן", "ok"); onClose(); })}>שמירה</button><//>`;
}
function InviteModal({ fid, famName, onClose }) {
  const [code, setCode] = useState(null); const [approval, setApproval] = useState(true); const [busy, run] = useBusy();
  const link = code ? `${location.origin}${location.pathname}?join=${code}` : "";
  const msg = code ? `הוזמנת להצטרף ל"${famName}" באפליקציה המשפחתית "${APP.name}" ❤️\n\nלהצטרפות לחץ על הקישור:\n${link}\n\nאו הזן את הקוד: ${code}` : "";
  const create = () => run(async () => { const { data, error } = await sb.rpc("fam_create_invite", { p_family: fid, p_requires_approval: approval, p_days: 7 }); if (error) throw error; setCode(data); });
  return html`<${Modal} title="הזמנת בני משפחה" onClose=${onClose}>
    ${!code ? html`
      <label class="check"><input type="checkbox" checked=${approval} onChange=${(e) => setApproval(e.target.checked)} /> כל מצטרף יחכה לאישור שלי (מומלץ)</label>
      <p class="small muted">הקוד תקף ל-7 ימים ולעד 20 מצטרפים. אדם שאין לו את הקוד לא יכול להצטרף.</p>
      <button class="btn primary block big" disabled=${busy} onClick=${create}>${busy ? "יוצר…" : "יצירת קוד הזמנה"}</button>` : html`
      <div class="code-box">${code}</div>
      <p class="small muted center">תקף ל-7 ימים${approval ? " · כל הצטרפות תחכה לאישורך" : ""}</p>
      <div class="btn-grid">
        <a class="btn green" href=${"https://wa.me/?text=" + encodeURIComponent(msg)} target="_blank" rel="noopener">💬 WhatsApp</a>
        <a class="btn" href=${"sms:?&body=" + encodeURIComponent(msg)}>📱 SMS</a>
        <a class="btn" href=${"mailto:?subject=" + encodeURIComponent("הזמנה ל" + famName) + "&body=" + encodeURIComponent(msg)}>✉️ מייל</a>
        ${navigator.share ? html`<button class="btn" onClick=${() => navigator.share({ title: APP.name, text: msg }).catch(() => {})}>📤 שיתוף…</button>` : null}
        <button class="btn" onClick=${async () => toast((await copyText(msg)) ? "ההזמנה הועתקה" : "לא ניתן להעתיק — סמן את הקוד והעתק ידנית", "ok")}>📋 העתקה</button>
      </div>`}
  <//>`;
}
function MemberModal({ fid, userId, onClose }) {
  const s = useStore(); const uid = s.session.user.id; const p = s.profiles[userId];
  const m = s.members.find((x) => x.family_id === fid && x.user_id === userId);
  const admin = isAdmin(s, fid); const myR = myRole(s, fid);
  const [busy, run] = useBusy(); const [pw, setPw] = useState(""); const [confirm, setConfirm] = useState(false);
  if (!m) return null;
  const canManage = admin && userId !== uid && m.role !== "owner" && !(m.role === "admin" && myR !== "owner");
  const nb = nextBirthday(p?.birthday);
  return html`<${Modal} title=${nameOf(p)} onClose=${onClose}>
    <div class="center"><${Avatar} id=${userId} size=${96} /><div style="font-weight:800;font-size:1.2rem;margin-top:8px">${fullName(p)}</div>${p?.nickname ? html`<div class="muted">"${p.nickname}"</div>` : null}<span class="chip" style="margin-top:6px">${ROLE_LABEL[m.role]}</span></div>
    <div class="card" style="margin-top:14px">
      ${p?.family_role ? html`<div>👪 ${p.family_role}</div>` : null}
      ${p?.phone ? html`<div>📞 <a href=${"tel:" + p.phone} class="ltr">${p.phone}</a></div>` : null}
      ${p?.email ? html`<div>✉️ <a href=${"mailto:" + p.email} class="ltr">${p.email}</a></div>` : null}
      ${p?.birthday ? html`<div>🎂 ${fmtDate(p.birthday + "T12:00", { weekday: undefined })} · ${hebDate(p.birthday + "T12:00", false)}${nb ? html` <span class="muted small">(${nb.days === 0 ? "היום!" : `בעוד ${nb.days} ימים`})</span>` : null}</div>` : null}
      ${p?.availability ? html`<div>🗓️ ${p.availability}</div>` : null}
      ${!p?.phone && !p?.email && !p?.birthday && !p?.family_role ? html`<div class="muted small">לא הוזנו פרטים נוספים.</div>` : null}
    </div>
    ${canManage ? html`<div class="card"><h3>ניהול</h3>
      <${Field} label="הרשאה"><select class="input" value=${m.role} disabled=${busy} onChange=${(e) => run(async () => { const { error } = await sb.rpc("fam_set_role", { p_family: fid, p_user: userId, p_role: e.target.value }); if (error) throw error; await loadAll(); toast("ההרשאה עודכנה", "ok"); })}>
        ${myR === "owner" || m.role === "admin" ? html`<option value="admin">מנהל — יכול להזמין, לאשר ולנהל</option>` : null}
        <option value="member">משתתף — יוצר אירועים ומאשר הגעה</option><option value="junior">משתתף צעיר — רק צפייה ואישור הגעה</option></select><//>
      <${Field} label="איפוס סיסמה" hint="השתמש בזה אם בן המשפחה שכח את הסיסמה. מסור לו את הסיסמה החדשה."><div class="row"><input class="input grow ltr" value=${pw} onInput=${(e) => setPw(e.target.value)} placeholder="סיסמה חדשה (6+ תווים)" /><button class="btn" disabled=${busy || pw.length < 6} onClick=${() => run(async () => { await api("reset_password", { family_id: fid, user_id: userId, new_password: pw }); toast("הסיסמה אופסה. מסור אותה לבן המשפחה", "ok"); setPw(""); })}>איפוס</button></div><//>
      <button class="btn danger block" onClick=${() => setConfirm(true)}>הסרה מהמשפחה</button></div>` : null}
    ${confirm ? html`<${Confirm} text=${`להסיר את ${nameOf(p)} מהמשפחה?`} yes="הסרה" danger onClose=${() => setConfirm(false)} onYes=${async () => { const { error } = await sb.rpc("fam_remove_member", { p_family: fid, p_user: userId }); if (error) throw error; await loadAll(); toast("המשתתף הוסר", "ok"); onClose(); }} />` : null}
  <//>`;
}

// ================== התראות ==================
function NotificationsScreen() {
  const s = useStore(); const [busy, run] = useBusy(); const [ps, setPs] = useState(null);
  useEffect(() => { pushStatus().then(setPs); }, []);
  const unread = s.notifications.filter((n) => !n.read_at);
  const open = async (n) => { if (!n.read_at) sb.from("fam_notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id).then(() => scheduleReload(100)); if (n.event_id) go("event-" + n.event_id); else if (n.kind === "join_request" || n.kind === "member_approved") go("family"); };
  return html`<div class="page">
    ${ps && ps !== "on" ? html`<${PushCard} status=${ps} onDone=${() => pushStatus().then(setPs)} />` : null}
    <div class="row spread" style="margin-bottom:10px"><h2 style="margin:0">🔔 התראות</h2>
      ${unread.length ? html`<button class="btn ghost" disabled=${busy} onClick=${() => run(async () => { const { error } = await sb.from("fam_notifications").update({ read_at: new Date().toISOString() }).in("id", unread.map((n) => n.id)); if (error) throw error; await loadAll(); })}>סמן הכל כנקרא</button>` : null}</div>
    ${s.notifications.length ? s.notifications.map((n) => html`<div class=${"notif" + (n.read_at ? "" : " unread")} onClick=${() => open(n)}>
      <div style="font-weight:700">${n.title}</div>${n.body ? html`<div class="small" style="white-space:pre-wrap">${n.body}</div>` : null}<div class="small muted">${relTime(n.created_at)}</div></div>`) : html`<p class="muted center">אין התראות עדיין.</p>`}
  </div>`;
}
function PushCard({ status, onDone }) {
  const [busy, run] = useBusy();
  if (status === "denied") return html`<div class="warn small">🔕 ההתראות חסומות בדפדפן. כדי לקבל התראות: לחץ על סמל המנעול ליד כתובת האתר ← הרשאות ← התראות ← אפשר.</div>`;
  if (status === "unsupported") return html`<div class="warn small">הדפדפן הזה לא תומך בהתראות דחיפה. ההתראות יופיעו כאן בתוך האפליקציה.</div>`;
  if (status === "ios-install") return html`<div class="warn small">📱 באייפון: כדי לקבל התראות יש להוסיף את האפליקציה למסך הבית — לחץ על כפתור השיתוף ⬆️ ← "הוסף למסך הבית", ופתח את האפליקציה מהאייקון.</div>`;
  return html`<div class="card"><h3>🔔 הפעלת התראות לטלפון</h3><p class="small muted">כדי לדעת מיד על הזמנות, שינויים ותזכורות — גם כשהאפליקציה סגורה.</p>
    <button class="btn primary block" disabled=${busy} onClick=${() => run(async () => { await enablePush(); toast("ההתראות הופעלו ✅", "ok"); onDone(); })}>${busy ? "מפעיל…" : "הפעלת התראות"}</button></div>`;
}

// ================== הגדרות ופרופיל ==================
function SettingsScreen() {
  const s = useStore(); const me = s.me || {}; const st = me.settings || {};
  const [p, setP] = useState({ first_name: me.first_name || "", last_name: me.last_name || "", nickname: me.nickname || "", phone: me.phone || "", email: me.email || "", birthday: me.birthday || "", family_role: me.family_role || "", availability: me.availability || "" });
  const [busy, run] = useBusy(); const [modal, setModal] = useState(null); const [ps, setPs] = useState(null);
  const [disp, setDisp] = useState(LS.get("fam-display", { theme: "auto", scale: 1, simple: false }));
  useEffect(() => { pushStatus().then(setPs); }, []);
  const up = (k) => (e) => setP({ ...p, [k]: e.target.value });
  const saveProfile = () => run(async () => {
    if (!p.first_name.trim()) throw new Error("יש להזין שם פרטי");
    const row = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v]));
    row.first_name = p.first_name.trim(); row.last_name = p.last_name.trim();
    const { error } = await sb.from("fam_profiles").update(row).eq("id", s.session.user.id); if (error) throw error;
    await loadAll(); toast("הפרופיל נשמר", "ok");
  });
  const saveSettings = (patch) => run(async () => {
    const next = { ...st, ...patch };
    const { error } = await sb.from("fam_profiles").update({ settings: next }).eq("id", s.session.user.id); if (error) throw error;
    await loadAll(); toast("ההגדרה נשמרה", "ok");
  });
  const uploadPhoto = (file) => run(async () => {
    if (!file) return;
    const blob = await resizeImage(file, 400);
    const path = `${s.session.user.id}/avatar-${Date.now()}.jpg`;
    const { error } = await sb.storage.from("fam-media").upload(path, blob, { contentType: "image/jpeg" }); if (error) throw error;
    const old = me.avatar_path;
    const { error: e2 } = await sb.from("fam_profiles").update({ avatar_path: path }).eq("id", s.session.user.id); if (e2) throw e2;
    if (old) sb.storage.from("fam-media").remove([old]).catch(() => {});
    await loadAll(); toast("התמונה עודכנה", "ok");
  });
  const removePhoto = () => run(async () => {
    const old = me.avatar_path; const { error } = await sb.from("fam_profiles").update({ avatar_path: null }).eq("id", s.session.user.id); if (error) throw error;
    if (old) await sb.storage.from("fam-media").remove([old]);
    const av = { ...store.s.avatars }; delete av[s.session.user.id]; store.set({ avatars: av }); await loadAll(); toast("התמונה הוסרה", "ok");
  });
  const setDisplay = (patch) => { const d = { ...disp, ...patch }; setDisp(d); LS.set("fam-display", d); applyDisplay(); };
  const notify = st.notify || {}; const hours = Array.isArray(st.remind_hours) ? st.remind_hours : [24, 3]; const quiet = st.quiet || { on: false, from: "22:00", to: "07:00" };
  const exportData = () => run(async () => {
    const uid = s.session.user.id;
    const [{ data: prof }, { data: mem }, { data: rs }, { data: evs }, { data: nts }] = await Promise.all([
      sb.from("fam_profiles").select("*").eq("id", uid), sb.from("fam_members").select("*").eq("user_id", uid), sb.from("fam_rsvps").select("*").eq("user_id", uid),
      sb.from("fam_events").select("*").eq("created_by", uid), sb.from("fam_notifications").select("*").eq("user_id", uid)]);
    downloadText(`our-family-my-data-${ymd(new Date())}.json`, JSON.stringify({ exported_at: new Date().toISOString(), app: APP.name, version: APP.version, profile: prof, memberships: mem, rsvps: rs, events_i_created: evs, notifications: nts }, null, 2));
    toast("הקובץ ירד למכשיר", "ok");
  });
  return html`<div class="page">
    <div class="card center"><${Avatar} id=${s.session.user.id} size=${110} />
      <div class="btn-grid" style="margin-top:12px">
        <label class="btn">🖼️ מהגלריה<input type="file" accept="image/*" style="display:none" onChange=${(e) => uploadPhoto(e.target.files[0])} /></label>
        <label class="btn">📷 צילום<input type="file" accept="image/*" capture="user" style="display:none" onChange=${(e) => uploadPhoto(e.target.files[0])} /></label>
        ${me.avatar_path ? html`<button class="btn danger" onClick=${removePhoto}>הסרת תמונה</button>` : null}
      </div>${busy ? html`<div class="small muted" style="margin-top:6px">שומר…</div>` : null}</div>
    <div class="card"><h2>👤 הפרופיל שלי</h2>
      <div class="row"><div class="grow"><${Field} label="שם פרטי"><input class="input" value=${p.first_name} onInput=${up("first_name")} /><//></div><div class="grow"><${Field} label="שם משפחה"><input class="input" value=${p.last_name} onInput=${up("last_name")} /><//></div></div>
      <${Field} label="כינוי משפחתי (רשות)" hint="יוצג במקום השם — למשל: סבא שמוליק"><input class="input" value=${p.nickname} onInput=${up("nickname")} /><//>
      <${Field} label="תפקיד במשפחה (רשות)"><input class="input" value=${p.family_role} onInput=${up("family_role")} placeholder="למשל: סבתא, בן דוד, נכדה" /><//>
      <${Field} label="תאריך יום הולדת (רשות)" hint=${p.birthday ? "תאריך עברי: " + hebDate(p.birthday + "T12:00") : null}><input class="input" type="date" value=${p.birthday} onInput=${up("birthday")} /><//>
      <${Field} label="טלפון (רשות)"><input class="input ltr" type="tel" value=${p.phone} onInput=${up("phone")} /><//>
      <${Field} label="מייל (רשות)"><input class="input ltr" type="email" value=${p.email} onInput=${up("email")} /><//>
      <${Field} label="זמינות כללית (רשות)"><input class="input" value=${p.availability} onInput=${up("availability")} placeholder="למשל: פנוי בעיקר בסופי שבוע" /><//>
      <p class="small muted">פרטי הכניסה שלך: <span class="ltr">${me.login_id}</span></p>
      <button class="btn primary block" disabled=${busy} onClick=${saveProfile}>💾 שמירת הפרופיל</button>
    </div>
    <div class="card"><h2>🔔 התראות</h2>
      ${ps === "on" ? html`<div class="ok-box small">✅ התראות לטלפון פעילות במכשיר הזה</div>` : ps ? html`<${PushCard} status=${ps} onDone=${() => pushStatus().then(setPs)} />` : null}
      ${[["events", "הזמנות, שינויים וביטולים"], ["reminders", "תזכורות"], ["messages", "הודעות ממארגנים"], ["rsvp", "תשובות לאירועים שאני מארגן"], ["family", "בקשות הצטרפות"], ["birthdays", "ימי הולדת"]].map(([k, l]) => html`<label class="check"><input type="checkbox" checked=${notify[k] !== false} onChange=${(e) => saveSettings({ notify: { ...notify, [k]: e.target.checked } })} /> ${l}</label>`)}
      <div class="hr"></div><div style="font-weight:600;margin-bottom:6px">תזכורת לפני אירוע:</div>
      <div class="row wrap">${[[24, "24 שעות"], [12, "12 שעות"], [3, "3 שעות"], [1, "שעה"]].map(([h, l]) => html`<label class="check" style="min-width:45%"><input type="checkbox" checked=${hours.includes(h)} onChange=${(e) => saveSettings({ remind_hours: e.target.checked ? [...new Set([...hours, h])] : hours.filter((x) => x !== h) })} /> ${l} לפני</label>`)}</div>
      <div class="hr"></div>
      <label class="check"><input type="checkbox" checked=${quiet.on} onChange=${(e) => saveSettings({ quiet: { ...quiet, on: e.target.checked } })} /> שעות שקטות</label>
      ${quiet.on ? html`<div class="row"><div class="grow"><${Field} label="מ־"><input class="input" type="time" value=${quiet.from} onChange=${(e) => saveSettings({ quiet: { ...quiet, from: e.target.value } })} /><//></div><div class="grow"><${Field} label="עד"><input class="input" type="time" value=${quiet.to} onChange=${(e) => saveSettings({ quiet: { ...quiet, to: e.target.value } })} /><//></div></div>` : null}
      <label class="check"><input type="checkbox" checked=${!!st.shabbat_quiet} onChange=${(e) => saveSettings({ shabbat_quiet: e.target.checked })} /> 🕯️ שמירת שבת — בלי התראות מיום שישי 15:00 ועד מוצאי שבת 21:00</label>
      <p class="small muted">התראות שמגיעות בזמן השקט נשמרות ויישלחו אוטומטית אחרי שהוא נגמר. כל ההתראות מופיעות תמיד גם בתוך האפליקציה.</p>
    </div>
    <div class="card"><h2>🎨 תצוגה</h2>
      <${Field} label="ערכת צבעים"><select class="input" value=${disp.theme} onChange=${(e) => setDisplay({ theme: e.target.value })}><option value="auto">אוטומטי (לפי הטלפון)</option><option value="light">בהיר</option><option value="dark">כהה</option></select><//>
      <${Field} label="גודל טקסט"><select class="input" value=${String(disp.scale)} onChange=${(e) => setDisplay({ scale: Number(e.target.value) })}><option value="1">רגיל</option><option value="1.15">גדול</option><option value="1.3">גדול מאוד</option></select><//>
      <label class="check"><input type="checkbox" checked=${disp.simple} onChange=${(e) => setDisplay({ simple: e.target.checked })} /> תצוגה פשוטה (מומלץ למבוגרים — פחות פרטים, כפתורים גדולים)</label>
    </div>
    <div class="card"><h2>🛡️ המידע שלי</h2><div class="btn-grid">
      <button class="btn" disabled=${busy} onClick=${exportData}>📥 ייצוא המידע שלי</button>
      <button class="btn" onClick=${() => setModal("health")}>🔧 בדיקת תקינות האפליקציה</button>
      <button class="btn" onClick=${() => go("about")}>ℹ️ אודות האפליקציה</button>
      <button class="btn" onClick=${() => setModal("logout")}>🚪 התנתקות</button>
      <button class="btn danger" onClick=${() => setModal("delete")}>🗑️ מחיקת החשבון</button></div></div>
    <p class="small muted center">${APP.name} · גרסה ${APP.version}<br />${APP.credit}</p>
    ${modal === "health" ? html`<${HealthModal} onClose=${() => setModal(null)} />` : null}
    ${modal === "logout" ? html`<${Confirm} text="להתנתק מהאפליקציה במכשיר הזה?" yes="התנתקות" onClose=${() => setModal(null)} onYes=${logout} />` : null}
    ${modal === "delete" ? html`<${Confirm} text="למחוק את החשבון ואת כל המידע שלך באפליקציה (פרופיל, תמונה, אישורי הגעה, התראות)? אי אפשר לשחזר. מומלץ לייצא את המידע קודם." yes="מחיקה לצמיתות" danger onClose=${() => setModal(null)} onYes=${async () => { await api("delete_account"); await logout(); toast("החשבון נמחק", "ok"); }} />` : null}
  </div>`;
}
async function logout() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); const sub = reg && (await reg.pushManager.getSubscription()); if (sub) { await sb.from("fam_push_subs").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); } } catch (_) {}
  const uid = store.s.session?.user?.id; if (uid) LS.del("fam-cache-" + uid);
  if (channel) { sb.removeChannel(channel); channel = null; }
  await sb.auth.signOut();
  store.set({ session: null, me: null, myMemberships: [], families: [], members: [], profiles: {}, events: [], rsvps: [], invitees: [], notifications: [], avatars: {} });
  location.hash = "home";
}
function applyDisplay() {
  const d = LS.get("fam-display", { theme: "auto", scale: 1, simple: false });
  const dark = d.theme === "dark" || (d.theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.documentElement.style.setProperty("--scale", d.simple ? Math.max(1.15, d.scale) : d.scale);
  document.body.classList.toggle("simple", !!d.simple);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f1621" : "#3f74c9");
}

// ================== בדיקת תקינות ==================
async function runHealth() {
  const out = []; const add = (name, status, text, fix) => out.push({ name, status, text, fix });
  const t0 = performance.now();
  try { const h = await api("health"); add("חיבור לשרת", "ok", `השרת זמין (${Math.round(performance.now() - t0)} מ״ש)`); if (!h.push) add("שירות ההתראות", "warn", "שירות שליחת ההתראות בשרת אינו מוגדר"); else add("שירות ההתראות", "ok", "שירות שליחת ההתראות פעיל"); }
  catch (e) { add("חיבור לשרת", "err", navigator.onLine ? "השרת לא הגיב. נסה שוב בעוד כמה דקות" : "אין חיבור לאינטרנט", "retry"); }
  try { const { data, error } = await sb.auth.getUser(); if (error || !data.user) throw error || new Error(); add("התחברות המשתמש", "ok", "אתה מחובר כראוי"); }
  catch (_) { add("התחברות המשתמש", "err", "פג תוקף ההתחברות", "relogin"); }
  try { const { error } = await sb.from("fam_profiles").select("id").eq("id", store.s.session.user.id).limit(1); if (error) throw error; add("גישה למסד הנתונים", "ok", "קריאת נתונים תקינה"); }
  catch (e) { add("גישה למסד הנתונים", "err", friendlyError(e), "retry"); }
  const ch = channel?.state; add("סנכרון בזמן אמת", ch === "joined" ? "ok" : "warn", ch === "joined" ? "עדכונים מבני משפחה מגיעים מיידית" : "הסנכרון המיידי לא מחובר כרגע — הנתונים יתעדכנו בכל פתיחה", "resync");
  add("פעולות שממתינות לסנכרון", store.s.queue.length ? "warn" : "ok", store.s.queue.length ? `${store.s.queue.length} פעולות ממתינות לחיבור` : "אין פעולות ממתינות", store.s.queue.length ? "flush" : null);
  const ps = await pushStatus().catch(() => "unsupported");
  add("הרשאות התראות", ps === "on" ? "ok" : "warn", { on: "התראות פעילות במכשיר הזה", off: "התראות לטלפון לא הופעלו", denied: "ההתראות חסומות בהגדרות הדפדפן", unsupported: "הדפדפן לא תומך בהתראות", "ios-install": "באייפון יש להוסיף למסך הבית קודם" }[ps], ps === "off" ? "push" : null);
  try { localStorage.setItem("fam-test", "1"); localStorage.removeItem("fam-test"); add("אחסון מקומי", "ok", "האחסון במכשיר תקין"); } catch (_) { add("אחסון מקומי", "warn", "הדפדפן חוסם אחסון מקומי (מצב גלישה פרטית?) — העבודה ללא חיבור לא תפעל"); }
  const sw = await navigator.serviceWorker?.getRegistration().catch(() => null);
  add("עבודה ללא חיבור", sw?.active ? "ok" : "warn", sw?.active ? "האפליקציה שמורה במכשיר ותיפתח גם בלי אינטרנט" : "רכיב העבודה ללא חיבור עדיין לא פעיל — רענן את הדף", sw?.active ? null : "reload");
  add("עוזר AI", "ok", "לא הופעל בגרסה זו (יתווסף בשלב הבא)");
  const upd = await checkForUpdate(false);
  add("גרסת האפליקציה", "ok", `מותקנת: ${APP.version}`);
  add("זמינות עדכונים", upd ? (upd.available ? "warn" : "ok") : "warn", upd ? (upd.available ? `קיימת גרסה חדשה: ${upd.latest}` : "האפליקציה מעודכנת") : "לא ניתן לבדוק עדכונים כרגע", upd?.available ? "update" : null);
  return out;
}
function HealthModal({ onClose }) {
  const [res, setRes] = useState(null); const [busy, run] = useBusy();
  const doRun = () => run(async () => { setRes(null); setRes(await runHealth()); });
  useEffect(() => { doRun(); }, []);
  const fix = (k) => run(async () => {
    if (k === "retry" || k === "resync") { await loadAll(); startRealtime(store.s.session.user.id); }
    if (k === "relogin") { await logout(); onClose(); return; }
    if (k === "flush") await flushQueue();
    if (k === "push") await enablePush();
    if (k === "reload" || k === "update") { await applyUpdate(); return; }
    setRes(await runHealth());
  });
  const overall = !res ? null : res.some((r) => r.status === "err") ? "err" : res.some((r) => r.status === "warn") ? "warn" : "ok";
  const IC = { ok: "🟢", warn: "🟡", err: "🔴" }, LB = { ok: "תקין", warn: "דורש תשומת לב", err: "תקלה" };
  return html`<${Modal} title="🔧 בדיקת תקינות האפליקציה" onClose=${onClose}>
    ${!res ? html`<p class="center">בודק…</p>` : html`
      <div class=${overall === "ok" ? "ok-box" : overall === "warn" ? "warn" : "err-box"} style="font-weight:700;text-align:center">${IC[overall]} ${LB[overall]}</div>
      <div class="card">${res.map((r) => html`<div class="health-row"><span>${IC[r.status]}</span><div class="grow"><div style="font-weight:600">${r.name}</div><div class="small muted">${r.text}</div></div>${r.fix ? html`<button class="btn" disabled=${busy} onClick=${() => fix(r.fix)}>תיקון</button>` : null}</div>`)}</div>
      <p class="small muted">הבדיקה רק קוראת מידע — היא לא משנה ולא מוחקת שום נתון.</p>
      <button class="btn block" disabled=${busy} onClick=${doRun}>הרצה חוזרת</button>`}
  <//>`;
}

// ================== אודות ==================
function AboutScreen() {
  const s = useStore(); const [modal, setModal] = useState(null);
  return html`<div class="page">
    <div class="card center" style="padding:28px 16px">
      <div style="font-size:3.4rem">❤️</div>
      <div style="font-size:1.9rem;font-weight:800">${APP.name}</div>
      <div class="muted">${APP.tagline}</div>
      <div style="margin-top:14px;font-weight:700">גרסה: ${APP.version}</div>
      <div style="margin-top:6px">${APP.credit}</div>
      <div class="small muted" style="margin-top:6px">${APP.copyright}</div>
    </div>
    ${s.update?.available ? html`<div class="ok-box row spread"><span>🎁 גרסה ${s.update.latest} זמינה</span><button class="btn green" onClick=${applyUpdate}>עדכון עכשיו</button></div>` : null}
    <div class="btn-grid">
      <button class="btn" onClick=${() => checkForUpdate(true)}>🔄 בדיקת עדכונים</button>
      <button class="btn" onClick=${() => setModal("news")}>📋 מה חדש בגרסה?</button>
      <button class="btn" onClick=${() => setModal("health")}>🔧 בדיקת תקינות האפליקציה</button>
      <button class="btn" onClick=${() => setModal("bug")}>📩 דיווח על תקלה</button>
    </div>
    ${modal === "news" ? html`<${NewsModal} onClose=${() => setModal(null)} />` : null}
    ${modal === "health" ? html`<${HealthModal} onClose=${() => setModal(null)} />` : null}
    ${modal === "bug" ? html`<${BugModal} onClose=${() => setModal(null)} />` : null}
  </div>`;
}
function NewsModal({ onClose }) {
  const [notes, setNotes] = useState(null);
  useEffect(() => { fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()).then((v) => setNotes(v.notes || {})).catch(() => setNotes({})); }, []);
  const keys = notes ? Object.keys(notes).sort((a, b) => cmpVer(b, a)) : [];
  return html`<${Modal} title="📋 מה חדש" onClose=${onClose}>
    ${!notes ? html`<p>טוען…</p>` : keys.length ? keys.map((k) => html`<div class="card"><h3>גרסה ${k}${k === APP.version ? " (מותקנת)" : ""}</h3><ul style="margin:0;padding-inline-start:20px">${notes[k].map((n) => html`<li>${n}</li>`)}</ul></div>`) : html`<p class="muted">אין מידע כרגע (צריך חיבור לאינטרנט).</p>`}
  <//>`;
}
function BugModal({ onClose }) {
  const [text, setText] = useState(""); const [busy, run] = useBusy();
  return html`<${Modal} title="📩 דיווח על תקלה" onClose=${onClose}>
    <p class="small muted">תאר מה קרה ומה ציפית שיקרה. יחד עם הדיווח נשלחים פרטים טכניים בסיסיים (גרסה, סוג מכשיר) כדי לעזור לתקן.</p>
    <textarea class="input" value=${text} onInput=${(e) => setText(e.target.value)} maxlength="2000" placeholder="למשל: לחצתי על 'מגיע' ולא קרה כלום…"></textarea>
    <button class="btn primary block" style="margin-top:12px" disabled=${busy || !text.trim()} onClick=${() => run(async () => {
      const diag = { version: APP.version, ua: navigator.userAgent, standalone: isStandalone(), online: navigator.onLine, route: location.hash, time: new Date().toISOString(), queue: store.s.queue.length };
      const { error } = await sb.from("fam_bug_reports").insert({ user_id: store.s.session.user.id, text: text.trim(), diag }); if (error) throw error;
      toast("הדיווח נשלח. תודה!", "ok"); onClose(); })}>${busy ? "שולח…" : "שליחת הדיווח"}</button>
  <//>`;
}

// ================== שלד האפליקציה ==================
const TITLES = { home: "בית", calendar: "לוח שנה", new: "אירוע חדש", family: "המשפחה", notifications: "התראות", settings: "הגדרות", about: "אודות האפליקציה" };
function Shell() {
  const s = useStore(); const route = useRoute();
  const [base, arg] = route.split(/-(.+)/);
  const unread = s.notifications.filter((n) => !n.read_at).length;
  const hasFamily = s.myMemberships.some((m) => m.status === "active");
  let screen, title = TITLES[base] || APP.name;
  if (!hasFamily && !["settings", "about"].includes(base)) { screen = html`<${Onboarding} />`; title = APP.name; }
  else if (base === "event") { screen = html`<${EventScreen} id=${arg} />`; title = "פרטי אירוע"; }
  else if (base === "edit") { screen = html`<${EventForm} key=${"e" + arg} editId=${arg} />`; title = "עריכת אירוע"; }
  else if (route.startsWith("new")) { const d = (route.match(/date=(\d{4}-\d{2}-\d{2})/) || [])[1]; screen = html`<${EventForm} key=${"n" + route} presetDate=${d} />`; title = "אירוע חדש"; }
  else if (base === "calendar") screen = html`<${CalendarScreen} />`;
  else if (base === "family") screen = html`<${FamilyScreen} />`;
  else if (base === "notifications") screen = html`<${NotificationsScreen} />`;
  else if (base === "settings") screen = html`<${SettingsScreen} key=${s.me?.updated_at} />`;
  else if (base === "about") screen = html`<${AboutScreen} />`;
  else { screen = html`<${Home} />`; title = APP.name; }
  const NAV = [["home", "🏠", "בית"], ["calendar", "📅", "לוח שנה"], ["new", "➕", "אירוע חדש"], ["family", "👨‍👩‍👧‍👦", "המשפחה"], ["notifications", "🔔", "התראות"]];
  return html`<div class="app">
    ${!s.online ? html`<div class="banner offline">📴 אין חיבור לאינטרנט — מוצג המידע האחרון שנשמר${s.queue.length ? ` · ${s.queue.length} פעולות ימתינו לסנכרון` : ""}</div>` : null}
    ${s.update?.required ? html`<div class="banner">⚠️ הגרסה המותקנת ישנה מדי ויש לעדכן<button class="btn" onClick=${applyUpdate}>עדכון</button></div>` : s.update?.available ? html`<div class="banner">🎁 גרסה חדשה (${s.update.latest}) זמינה<button class="btn" onClick=${applyUpdate}>עדכון</button></div>` : null}
    <div class="topbar">
      ${["home", "calendar", "family", "notifications", ""].includes(base) || !hasFamily ? html`<span style="font-size:1.3rem">❤️</span>` : html`<button class="icon-btn" onClick=${() => history.length > 1 ? history.back() : go("home")} aria-label="חזרה">→</button>`}
      <h1>${title}</h1>
      ${s.syncing ? html`<span class="small muted">מסנכרן…</span>` : null}
      <button class="icon-btn" onClick=${() => go("settings")} aria-label="הגדרות">⚙️</button>
    </div>
    ${s.loadError && s.online ? html`<div class="page" style="padding-bottom:0"><div class="err-box small row spread"><span>${s.loadError}</span><button class="btn" onClick=${() => loadAll().catch(() => {})}>נסה שוב</button></div></div>` : null}
    ${screen}
    ${hasFamily ? html`<nav class="nav"><div class="nav-inner">${NAV.map(([k, ic, l]) => html`<button class=${(base === k || (k === "new" && route.startsWith("new")) ? "on" : "") + (k === "new" ? " plus" : "")} onClick=${() => go(k)} aria-label=${l}><span class="ic">${ic}</span>${l}${k === "notifications" && unread ? html`<span class="badge">${unread > 99 ? "99+" : unread}</span>` : null}</button>`)}</div></nav>` : null}
  </div>`;
}
function Root() {
  const s = useStore();
  return html`${s.boot ? html`<${Splash} />` : !s.session ? html`<${AuthScreen} />` : html`<${Shell} />`}
    ${s.toast ? html`<div class=${"toast " + (s.toast.kind || "")} role="status">${s.toast.msg}</div>` : null}`;
}

// ================== הפעלה ==================
async function onSession(session) {
  const prev = store.s.session?.user?.id;
  store.set({ session });
  if (!session) return;
  if (prev !== session.user.id) {
    const cached = LS.get("fam-cache-" + session.user.id, null);
    if (cached) store.set(cached);
    startRealtime(session.user.id);
  }
  try { await loadAll(); } catch (_) {}
  const join = LS.get("fam-pending-join", null);
  if (join) { try { await joinWithCode(join); } catch (e) { toastErr(e); } }
  flushQueue();
}
async function boot() {
  window.__booted = true;
  applyDisplay();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyDisplay);
  const params = new URLSearchParams(location.search);
  if (params.get("join")) { LS.set("fam-pending-join", params.get("join").toUpperCase()); history.replaceState(null, "", location.pathname + location.hash); }
  render(html`<${Root} />`, document.getElementById("root"));
  const minSplash = new Promise((r) => setTimeout(r, 900));
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "navigate") go(e.data.route); });
  }
  const { data } = await sb.auth.getSession();
  await minSplash;
  store.set({ boot: false });
  if (data.session) onSession(data.session);
  sb.auth.onAuthStateChange((ev, session) => { if (ev === "SIGNED_IN" || ev === "TOKEN_REFRESHED" || ev === "USER_UPDATED") { if (session?.user?.id !== store.s.session?.user?.id || ev === "SIGNED_IN") onSession(session); else store.set({ session }); } if (ev === "SIGNED_OUT") store.set({ session: null }); });
  window.addEventListener("online", () => { store.set({ online: true }); flushQueue(); scheduleReload(300); });
  window.addEventListener("offline", () => store.set({ online: false }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && store.s.session) { scheduleReload(200); checkForUpdate(false); } });
  checkForUpdate(false);
  setInterval(() => checkForUpdate(false), 6 * 3600 * 1000);
}
boot();
