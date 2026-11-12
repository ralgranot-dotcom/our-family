// "המשפחה שלנו" — פונקציית שרת יחידה
// פעולות: health, signup, notify, reset_password, delete_account, cron
// כל בדיקות ההרשאה מתבצעות כאן בצד השרת — הלקוח לא יכול לעקוף אותן.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("PROJECT_SECRET_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const VAPID_PUBLIC_KEY = "BPCF5A90ThjBCUBk8Zv9lqn4Af0hIPAE1HBgUG8QZyNjx7xNwDRaP1Zowhh_WAQn--JPBfl3mkKu-RWg85XYW5Q";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const AUTH_DOMAIN = "family-app.invalid";
const APP_NAME = "המשפחה שלנו";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ ok: false, error: msg }, status);

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let vapidReady = false;
try { if (VAPID_PRIVATE_KEY) { webpush.setVapidDetails("mailto:ralgranot@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); vapidReady = true; } } catch (_) { vapidReady = false; }

// ---------- עזרי זמן (שעון ישראל) ----------
function ilParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return { wd: p.weekday, hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, ymd: `${p.year}-${p.month}-${p.day}`, md: `${p.month}-${p.day}` };
}
function ilDateTime(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
function inRange(hm: string, from: string, to: string) {
  if (!from || !to || from === to) return false;
  return from < to ? hm >= from && hm < to : hm >= from || hm < to;
}
function isQuiet(settings: any, now = new Date()) {
  const p = ilParts(now);
  if (settings?.quiet?.on && inRange(p.hm, settings.quiet.from || "22:00", settings.quiet.to || "07:00")) return true;
  if (settings?.shabbat_quiet) {
    if (p.wd === "Fri" && p.hm >= "15:00") return true;
    if (p.wd === "Sat" && p.hm < "21:00") return true;
  }
  return false;
}
const KIND_GROUP: Record<string, string> = {
  event_new: "events", event_changed: "events", event_cancelled: "events",
  rsvp_reminder: "reminders", event_reminder: "reminders", organizer_message: "messages",
  rsvp: "rsvp", join_request: "family", member_approved: "family", birthday: "birthdays",
};
function wantsPush(settings: any, kind: string) {
  const g = KIND_GROUP[kind] ?? "other";
  return settings?.notify?.[g] !== false;
}

// ---------- שליחת התראות ----------
type Note = { user_id: string; family_id?: string | null; event_id?: string | null; kind: string; title: string; body?: string; dedupe?: string };

async function deliver(notes: Note[]) {
  if (!notes.length) return { created: 0, pushed: 0 };
  const rows = notes.map((n) => ({ ...n, body: n.body ?? null, dedupe: n.dedupe ?? null, push_state: "pending" }));
  let inserted: any[] = [];
  // dedupe: התראה עם מפתח שכבר קיים לא תיווצר שוב
  const withKey = rows.filter((r) => r.dedupe), noKey = rows.filter((r) => !r.dedupe);
  if (noKey.length) {
    const { data, error } = await admin.from("fam_notifications").insert(noKey).select();
    if (error) throw error; inserted = inserted.concat(data ?? []);
  }
  if (withKey.length) {
    const { data, error } = await admin.from("fam_notifications").upsert(withKey, { onConflict: "dedupe", ignoreDuplicates: true }).select();
    if (error) throw error; inserted = inserted.concat(data ?? []);
  }
  const pushed = await pushPending(inserted);
  return { created: inserted.length, pushed };
}

async function pushPending(notifs: any[]) {
  if (!notifs.length) return 0;
  const userIds = [...new Set(notifs.map((n) => n.user_id))];
  const [{ data: profs }, { data: subs }] = await Promise.all([
    admin.from("fam_profiles").select("id,settings").in("id", userIds),
    admin.from("fam_push_subs").select("endpoint,user_id,p256dh,auth").in("user_id", userIds),
  ]);
  const settingsOf = new Map((profs ?? []).map((p: any) => [p.id, p.settings ?? {}]));
  const subsOf = new Map<string, any[]>();
  for (const s of subs ?? []) { const a = subsOf.get(s.user_id) ?? []; a.push(s); subsOf.set(s.user_id, a); }
  let sent = 0; const sentIds: string[] = [], skippedIds: string[] = [], dead: string[] = [];
  for (const n of notifs) {
    const st = settingsOf.get(n.user_id) ?? {};
    const userSubs = subsOf.get(n.user_id) ?? [];
    if (!wantsPush(st, n.kind) || !userSubs.length || !vapidReady) { skippedIds.push(n.id); continue; }
    if (isQuiet(st)) continue; // נשאר "pending" — יישלח אוטומטית אחרי השעות השקטות
    const payload = JSON.stringify({ title: `❤️ ${APP_NAME}`, body: `${n.title}${n.body ? "\n" + n.body : ""}`.slice(0, 400), tag: n.event_id ?? n.kind, url: n.event_id ? `./#event-${n.event_id}` : "./#notifications" });
    let any = false;
    for (const s of userSubs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { urgency: "high", TTL: 3600 * 12 });
        any = true; sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
      }
    }
    (any ? sentIds : skippedIds).push(n.id);
  }
  if (sentIds.length) await admin.from("fam_notifications").update({ push_state: "sent" }).in("id", sentIds);
  if (skippedIds.length) await admin.from("fam_notifications").update({ push_state: "skipped" }).in("id", skippedIds);
  if (dead.length) await admin.from("fam_push_subs").delete().in("endpoint", dead);
  return sent;
}

// ---------- עזרי הרשאות ----------
async function getCaller(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { user: data.user, token };
}
async function memberRow(family_id: string, user_id: string) {
  const { data } = await admin.from("fam_members").select("role,status").eq("family_id", family_id).eq("user_id", user_id).maybeSingle();
  return data as { role: string; status: string } | null;
}
async function displayName(user_id: string) {
  const { data } = await admin.from("fam_profiles").select("first_name,last_name,nickname").eq("id", user_id).maybeSingle();
  if (!data) return "בן משפחה";
  return (data.nickname || `${data.first_name} ${data.last_name}`).trim() || "בן משפחה";
}
async function eventRecipients(ev: any) {
  let ids: string[];
  if (ev.invite_all) {
    const { data } = await admin.from("fam_members").select("user_id").eq("family_id", ev.family_id).eq("status", "active");
    ids = (data ?? []).map((r: any) => r.user_id);
  } else {
    const { data } = await admin.from("fam_event_invitees").select("user_id").eq("event_id", ev.id);
    const { data: act } = await admin.from("fam_members").select("user_id").eq("family_id", ev.family_id).eq("status", "active");
    const active = new Set((act ?? []).map((r: any) => r.user_id));
    ids = [...new Set([...(data ?? []).map((r: any) => r.user_id), ev.created_by])].filter((u) => active.has(u));
  }
  return ids;
}

// ---------- זיהוי משתמש ----------
export function normalizeLogin(raw: string) {
  const s = (raw ?? "").trim().toLowerCase();
  const digits = s.replace(/[\s\-()+.]/g, "");
  if (/^\d{9,15}$/.test(digits)) {
    let d = digits;
    if (d.startsWith("972")) d = "0" + d.slice(3);
    return { kind: "phone", value: d };
  }
  return { kind: "email", value: s };
}
async function authEmailFor(login: string) {
  const n = normalizeLogin(login);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("our-family:" + n.value));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  return { authEmail: `u${hex}@${AUTH_DOMAIN}`, norm: n };
}

// ---------- פעולות ----------
async function actSignup(body: any) {
  const login = String(body.login ?? "").trim();
  const password = String(body.password ?? "");
  const first = String(body.first_name ?? "").trim().slice(0, 40);
  const last = String(body.last_name ?? "").trim().slice(0, 40);
  if (!login) return fail("יש להזין מייל או מספר טלפון");
  const { authEmail, norm } = await authEmailFor(login);
  if (norm.kind === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(norm.value)) return fail("כתובת המייל אינה תקינה. אפשר להזין מספר טלפון במקום");
  if (password.length < 6) return fail("הסיסמה צריכה להכיל לפחות 6 תווים");
  if (!first) return fail("יש להזין שם פרטי");
  const { data, error } = await admin.auth.admin.createUser({ email: authEmail, password, email_confirm: true, user_metadata: { fam: true } });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return fail("משתמש עם הפרטים האלה כבר קיים. עבור ללשונית 'כניסה'");
    return fail("ההרשמה נכשלה: " + error.message, 500);
  }
  const uid = data.user!.id;
  const profileRow = {
    id: uid, login_id: norm.value, first_name: first, last_name: last,
    email: norm.kind === "email" ? norm.value : null, phone: norm.kind === "phone" ? norm.value : null,
    settings: { notify: {}, remind_hours: [24, 3] },
  };
  let pe: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    ({ error: pe } = await admin.from("fam_profiles").insert(profileRow));
    if (!pe || !/JWT|fetch|network|timeout/i.test(pe.message)) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  if (pe) { await admin.auth.admin.deleteUser(uid); return fail("שמירת הפרופיל נכשלה: " + pe.message, 500); }
  return json({ ok: true, auth_email: authEmail });
}

async function actNotify(req: Request, body: any) {
  const c = await getCaller(req); if (!c) return fail("נדרשת התחברות", 401);
  const me = c.user.id; const kind = String(body.kind ?? "");
  const actor = await displayName(me);

  if (kind === "join_request") {
    const fid = String(body.family_id ?? "");
    const m = await memberRow(fid, me); if (!m || m.status !== "pending") return fail("אין בקשת הצטרפות פתוחה");
    const { data: admins } = await admin.from("fam_members").select("user_id").eq("family_id", fid).eq("status", "active").in("role", ["owner", "admin"]);
    const { data: fam } = await admin.from("fam_families").select("name").eq("id", fid).single();
    const r = await deliver((admins ?? []).map((a: any) => ({ user_id: a.user_id, family_id: fid, kind, title: `בקשת הצטרפות ל${fam?.name ?? "משפחה"}`, body: `${actor} מבקש להצטרף. אפשר לאשר במסך "המשפחה".`, dedupe: `join-${fid}-${me}-${a.user_id}` })));
    return json({ ok: true, ...r });
  }
  if (kind === "member_approved") {
    const fid = String(body.family_id ?? ""), target = String(body.target_user ?? "");
    const m = await memberRow(fid, me); if (!m || m.status !== "active" || !["owner", "admin"].includes(m.role)) return fail("אין הרשאה", 403);
    const t = await memberRow(fid, target); if (!t || t.status !== "active") return fail("המשתתף לא אושר");
    const { data: fam } = await admin.from("fam_families").select("name").eq("id", fid).single();
    const r = await deliver([{ user_id: target, family_id: fid, kind, title: `התקבלת ל${fam?.name ?? "משפחה"} 🎉`, body: "עכשיו אפשר לראות את האירועים המשפחתיים." }]);
    return json({ ok: true, ...r });
  }

  // כל שאר הסוגים קשורים לאירוע
  const eid = String(body.event_id ?? "");
  const { data: ev } = await admin.from("fam_events").select("*").eq("id", eid).maybeSingle();
  if (!ev) return fail("האירוע לא נמצא", 404);
  const m = await memberRow(ev.family_id, me);
  if (!m || m.status !== "active") return fail("אין הרשאה", 403);
  const isManager = ev.created_by === me || ["owner", "admin"].includes(m.role);
  const when = ilDateTime(ev.starts_at);

  if (kind === "rsvp") {
    const { data: r0 } = await admin.from("fam_rsvps").select("status,guests").eq("event_id", eid).eq("user_id", me).maybeSingle();
    if (!r0 || ev.created_by === me) return json({ ok: true, created: 0 });
    const label = r0.status === "yes" ? "מגיע/ה 🟢" : r0.status === "no" ? "לא מגיע/ה 🔴" : "עדיין לא יודע/ת 🟡";
    const r = await deliver([{ user_id: ev.created_by, family_id: ev.family_id, event_id: eid, kind, title: `${actor}: ${label}`, body: `${ev.title}${r0.guests ? ` · +${r0.guests} נלווים` : ""}` }]);
    return json({ ok: true, ...r });
  }

  if (!isManager) return fail("רק מארגן האירוע או מנהל יכולים לשלוח התראה זו", 403);
  let recipients = (await eventRecipients(ev)).filter((u) => u !== me);
  let title = "", text = "";
  if (kind === "event_new") { title = `הזמנה חדשה: ${ev.title}`; text = `${when}${ev.location ? " · " + ev.location : ""}\n${actor} מזמין/ה אותך. נא לאשר הגעה.`; }
  else if (kind === "event_changed") { title = `עדכון באירוע: ${ev.title}`; text = String(body.changes ?? `המועד: ${when}`).slice(0, 250); }
  else if (kind === "event_cancelled") { title = `האירוע בוטל: ${ev.title}`; text = `${actor} ביטל/ה את האירוע שתוכנן ל${when}.`; }
  else if (kind === "organizer_message") {
    const msg = String(body.message ?? "").trim().slice(0, 300); if (!msg) return fail("ההודעה ריקה");
    if (body.audience === "yes") {
      const { data: yes } = await admin.from("fam_rsvps").select("user_id").eq("event_id", eid).eq("status", "yes");
      const ys = new Set((yes ?? []).map((r: any) => r.user_id)); recipients = recipients.filter((u) => ys.has(u));
    }
    title = `הודעה מ${actor} · ${ev.title}`; text = msg;
  } else if (kind === "rsvp_reminder") {
    if (ev.status !== "active") return fail("האירוע בוטל");
    if (ev.last_reminder_at && Date.now() - new Date(ev.last_reminder_at).getTime() < 6 * 3600 * 1000) {
      const next = new Date(new Date(ev.last_reminder_at).getTime() + 6 * 3600 * 1000);
      return fail(`כבר נשלחה תזכורת לאחרונה. אפשר לשלוח שוב החל מ־${ilParts(next).hm} (שעון ישראל)`, 429);
    }
    const { data: ans } = await admin.from("fam_rsvps").select("user_id").eq("event_id", eid);
    const answered = new Set((ans ?? []).map((r: any) => r.user_id));
    recipients = recipients.filter((u) => !answered.has(u));
    await admin.from("fam_events").update({ last_reminder_at: new Date().toISOString() }).eq("id", eid);
    title = `תזכורת: נא לאשר הגעה · ${ev.title}`; text = `${when}. לחיצה אחת — מגיע / לא מגיע / עדיין לא יודע.`;
  } else return fail("סוג התראה לא מוכר");

  const r = await deliver(recipients.map((u) => ({ user_id: u, family_id: ev.family_id, event_id: eid, kind, title, body: text })));
  return json({ ok: true, recipients: recipients.length, ...r });
}

async function actResetPassword(req: Request, body: any) {
  const c = await getCaller(req); if (!c) return fail("נדרשת התחברות", 401);
  const fid = String(body.family_id ?? ""), target = String(body.user_id ?? ""), pw = String(body.new_password ?? "");
  if (pw.length < 6) return fail("הסיסמה צריכה להכיל לפחות 6 תווים");
  const me = await memberRow(fid, c.user.id);
  if (!me || me.status !== "active" || !["owner", "admin"].includes(me.role)) return fail("רק מנהל יכול לאפס סיסמה", 403);
  const t = await memberRow(fid, target); if (!t || t.status !== "active") return fail("המשתתף לא נמצא");
  if (target !== c.user.id && (t.role === "owner" || (t.role === "admin" && me.role !== "owner"))) return fail("אין הרשאה לאפס סיסמה למנהל", 403);
  const { data: u } = await admin.auth.admin.getUserById(target);
  if (!u?.user?.email?.endsWith("@" + AUTH_DOMAIN)) return fail("לא ניתן לאפס סיסמה לחשבון זה");
  const { error } = await admin.auth.admin.updateUserById(target, { password: pw });
  if (error) return fail("האיפוס נכשל: " + error.message, 500);
  await admin.from("fam_audit").insert({ family_id: fid, actor: c.user.id, action: "password_reset", details: { user: target } });
  return json({ ok: true });
}

async function actDeleteAccount(req: Request) {
  const c = await getCaller(req); if (!c) return fail("נדרשת התחברות", 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${c.token}` } }, auth: { persistSession: false } });
  const { error } = await userClient.rpc("fam_delete_my_data");
  if (error) return fail(error.message);
  // מוחקים את חשבון ההתחברות רק אם הוא חשבון של האפליקציה המשפחתית (לעולם לא חשבון של מערכת אחרת)
  if (c.user.email?.endsWith("@" + AUTH_DOMAIN)) {
    const { data: files } = await admin.storage.from("fam-media").list(c.user.id);
    if (files?.length) await admin.storage.from("fam-media").remove(files.map((f: any) => `${c.user.id}/${f.name}`));
    await admin.auth.admin.deleteUser(c.user.id);
  }
  return json({ ok: true });
}

async function actCron(req: Request) {
  const { data: cfg } = await admin.from("fam_private_config").select("value").eq("key", "cron_secret").maybeSingle();
  if (!cfg?.value || req.headers.get("x-cron-secret") !== cfg.value) return fail("אין הרשאה", 403);
  const now = new Date();
  const out: Record<string, number> = { reminders: 0, birthdays: 0, deferred: 0 };

  // 1) תזכורות לפני אירוע — לפי העדפות כל משתמש (ברירת מחדל: 24 ו-3 שעות לפני)
  const horizon = new Date(now.getTime() + 49 * 3600 * 1000).toISOString();
  const { data: evs } = await admin.from("fam_events").select("*").eq("status", "active").gt("starts_at", now.toISOString()).lt("starts_at", horizon);
  const notes: Note[] = [];
  for (const ev of evs ?? []) {
    const recips = await eventRecipients(ev);
    const { data: rs } = await admin.from("fam_rsvps").select("user_id,status").eq("event_id", ev.id);
    const declined = new Set((rs ?? []).filter((r: any) => r.status === "no").map((r: any) => r.user_id));
    const { data: profs } = await admin.from("fam_profiles").select("id,settings").in("id", recips);
    for (const p of profs ?? []) {
      if (declined.has(p.id)) continue;
      const hours: number[] = Array.isArray(p.settings?.remind_hours) ? p.settings.remind_hours : [24, 3];
      for (const h of hours) {
        const fireAt = new Date(ev.starts_at).getTime() - h * 3600 * 1000;
        if (fireAt <= now.getTime() && fireAt > now.getTime() - 20 * 60 * 1000) {
          notes.push({ user_id: p.id, family_id: ev.family_id, event_id: ev.id, kind: "event_reminder", title: `תזכורת: ${ev.title}`, body: `${ilDateTime(ev.starts_at)}${ev.location ? " · " + ev.location : ""}`, dedupe: `rem-${ev.id}-${p.id}-${h}` });
        }
      }
    }
  }
  if (notes.length) out.reminders = (await deliver(notes)).created;

  // 2) ימי הולדת — פעם ביום, בבוקר (08:00 שעון ישראל ואילך)
  const ip = ilParts(now);
  if (ip.hm >= "08:00") {
    const { data: bps } = await admin.from("fam_profiles").select("id,first_name,last_name,nickname,birthday").not("birthday", "is", null);
    const bdayNotes: Note[] = [];
    for (const b of bps ?? []) {
      if (String(b.birthday).slice(5, 10) !== ip.md) continue;
      const { data: fams } = await admin.from("fam_members").select("family_id").eq("user_id", b.id).eq("status", "active");
      for (const f of fams ?? []) {
        const { data: mates } = await admin.from("fam_members").select("user_id").eq("family_id", f.family_id).eq("status", "active").neq("user_id", b.id);
        const name = (b.nickname || `${b.first_name} ${b.last_name}`).trim();
        for (const mt of mates ?? []) bdayNotes.push({ user_id: mt.user_id, family_id: f.family_id, kind: "birthday", title: `🎂 היום יום ההולדת של ${name}`, body: "זה זמן טוב לשלוח ברכה!", dedupe: `bd-${b.id}-${mt.user_id}-${ip.ymd}` });
      }
    }
    if (bdayNotes.length) out.birthdays = (await deliver(bdayNotes)).created;
  }

  // 3) התראות שנדחו בגלל שעות שקטות / שבת
  const { data: pend } = await admin.from("fam_notifications").select("*").eq("push_state", "pending").order("created_at").limit(300);
  const cutoff = now.getTime() - 36 * 3600 * 1000;
  const old = (pend ?? []).filter((n: any) => new Date(n.created_at).getTime() < cutoff).map((n: any) => n.id);
  if (old.length) await admin.from("fam_notifications").update({ push_state: "skipped" }).in("id", old);
  out.deferred = await pushPending((pend ?? []).filter((n: any) => !old.includes(n.id)));
  return json({ ok: true, ...out });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return fail("השרת אינו מוגדר כראוי", 500);
    let body: any = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    switch (body.action) {
      case "health": return json({ ok: true, server_time: new Date().toISOString(), push: vapidReady, vapid_public_key: VAPID_PUBLIC_KEY });
      case "signup": return await actSignup(body);
      case "notify": return await actNotify(req, body);
      case "reset_password": return await actResetPassword(req, body);
      case "delete_account": return await actDeleteAccount(req);
      case "cron": return await actCron(req);
      default: return fail("פעולה לא מוכרת");
    }
  } catch (e) {
    return fail("שגיאת שרת: " + ((e as Error)?.message ?? String(e)), 500);
  }
});
