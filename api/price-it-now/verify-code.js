import { checkVerificationCode, isValidEmail, sanitizeEmail, parseJson } from "../_util.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }

  let { email, code } = await parseJson(req);
  email = sanitizeEmail(email);
  if (!isValidEmail(email) || !code) return res.status(400).json({ error: "missing" });

  const ok = checkVerificationCode(email, code);
  if (!ok) return res.status(400).json({ error: "bad code" });
  return res.status(200).json({ ok: true });
}
