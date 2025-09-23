import { initSendgrid, parseJson } from "../_util.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const body = await parseJson(req);
  const { sendTo, calcHtml } = body || {};
  if (!sendTo || !calcHtml) return res.status(400).json({ error: "missing" });

  try {
    const sg = initSendgrid();
    await sg.send({
      to: sendTo,
      from: process.env.FROM_EMAIL,
      replyTo: process.env.TEAM_EMAIL,
      subject: "Your Retail401k cost sheet",
      html: calcHtml,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("send-quote error", err?.response?.body || err);
    return res.status(500).json({ error: "failed to send quote" });
  }
}
