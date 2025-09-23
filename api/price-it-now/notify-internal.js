import { initSendgrid, parseJson } from "../_util.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const payload = await parseJson(req);

  try {
    const sg = initSendgrid();
    await sg.send({
      to: process.env.TEAM_EMAIL,
      from: process.env.FROM_EMAIL,
      subject: "Price It Now – new request",
      html: `<pre>${JSON.stringify(payload, null, 2)}</pre>`,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("notify-internal error", err?.response?.body || err);
    return res.status(500).json({ error: "failed to notify" });
  }
}
