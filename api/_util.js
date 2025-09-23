import sgMail from "@sendgrid/mail";

export function initSendgrid() {
  const req = ["SENDGRID_API_KEY", "FROM_EMAIL", "TEAM_EMAIL"];
  for (const k of req) {
    if (!process.env[k]) throw new Error(`Missing env: ${k}`);
  }
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  return sgMail;
}

const codes = new Map(); // email -> { code, exp }

export function pickCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
export function setCode(email, code, ttlSec = 600) {
  codes.set((email || "").toLowerCase(), { code, exp: Date.now() + ttlSec * 1000 });
}
export function checkCode(email, code) {
  const rec = codes.get((email || "").toLowerCase());
  if (!rec) return false;
  const ok = rec.code === code && Date.now() < rec.exp;
  if (ok) codes.delete((email || "").toLowerCase());
  return ok;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

/** Safely get JSON body for Vercel Node functions (supports object, string, or raw stream). */
export async function parseJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  try {
    const chunks = [];
    for await (const ch of req) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
