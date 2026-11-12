// "המשפחה שלנו" — הגדרות קבועות
// ⚠️ בכל עדכון גרסה יש לעדכן את המספר בשלושה מקומות: כאן, ב-sw.js וב-version.json
export const APP = {
  name: "המשפחה שלנו",
  tagline: "המקום שבו כל המשפחה נפגשת.",
  version: "1.0.0",
  credit: "תוכנן ויוצר ע״י איתן נוה",
  copyright: "© 2026 איתן נוה. כל הזכויות שמורות.",
};

// מפתח ציבורי בלבד (anon) — מיועד להיות בצד הלקוח. ההגנה על הנתונים מתבצעת בשרת (RLS).
export const SUPABASE_URL = "https://ddytetgcdygmufitgxeg.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkeXRldGdjZHlnbXVmaXRneGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwOTM3NTQsImV4cCI6MjEwMzY2OTc1NH0._7qjKKs0SXHXdubgJmade1JRV59qJRVrSe2d-XfcE20";
export const VAPID_PUBLIC_KEY = "BPCF5A90ThjBCUBk8Zv9lqn4Af0hIPAE1HBgUG8QZyNjx7xNwDRaP1Zowhh_WAQn--JPBfl3mkKu-RWg85XYW5Q";
export const AUTH_DOMAIN = "family-app.invalid";

export const EVENT_TYPES = [
  { key: "shabbat", label: "ארוחת שבת", emoji: "🕯️", color: "#5b7fc7" },
  { key: "holiday", label: "סעודת חג", emoji: "🍷", color: "#8e5fbf" },
  { key: "birthday", label: "יום הולדת", emoji: "🎂", color: "#e06b93" },
  { key: "wedding", label: "חתונה", emoji: "💍", color: "#c9a227" },
  { key: "brit", label: "ברית", emoji: "👶", color: "#3fa6bf" },
  { key: "barmitzvah", label: "בר מצווה", emoji: "📜", color: "#3f74c9" },
  { key: "batmitzvah", label: "בת מצווה", emoji: "🌸", color: "#e48ab3" },
  { key: "trip", label: "טיול", emoji: "🏞️", color: "#2f9e66" },
  { key: "gathering", label: "מפגש משפחתי", emoji: "👨‍👩‍👧‍👦", color: "#f08a4b" },
  { key: "special", label: "אירוע מיוחד", emoji: "⭐", color: "#d9a520" },
];
