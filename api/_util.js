import sgMail from "@sendgrid/mail";
import crypto from "crypto";

export function initSendgrid() {
  const req = ["SENDGRID_API_KEY", "FROM_EMAIL", "TEAM_EMAIL", "VERIFICATION_SECRET"];
  for (const k of req) if (!process.env[k]) throw new Error(`Missing env: ${k}`);
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  return sgMail;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

/** Create a deterministic 6-digit code for a 10-minute window (no storage). */
const WINDOW_SEC = 600;
function codeFor(email, windowIndex) {
  const h = crypto
    .createHmac("sha256", process.env.VERIFICATION_SECRET)
    .update((email || "").toLowerCase() + ":" + String(windowIndex))
    .digest("hex");
  // Take last 6 digits from hash
  return String(parseInt(h.slice(-8), 16) % 1_000_000).padStart(6, "0");
}
export function makeVerificationCode(email, nowMs = Date.now()) {
  const idx = Math.floor(nowMs / 1000 / WINDOW_SEC);
  return codeFor(email, idx);
}
export function checkVerificationCode(email, code, nowMs = Date.now()) {
  const idx = Math.floor(nowMs / 1000 / WINDOW_SEC);
  const candidates = [codeFor(email, idx), codeFor(email, idx - 1)]; // allow slight skew
  return candidates.includes((code || "").trim());
}

/** Safe JSON body for Vercel Node functions. */
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
