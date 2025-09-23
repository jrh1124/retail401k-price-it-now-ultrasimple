import { initSendgrid, pickCode, setCode, isValidEmail, parseJson } from "../_util.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  const body = await parseJson(req);
  const { email, contact } = body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: "invalid email" });

  try {
    const code = pickCode();
    setCode(email, code, 600);
    const sg = initSendgrid();
    await sg.send({
      to: email,
      from: process.env.FROM_EMAIL,
      subject: "Your Retail401k verification code",
      html: `<p>Hi${contact?.firstName ? " " + contact.firstName : ""},</p>
             <p>Your verification code is: <strong style="font-size:18px">${code}</strong></p>
             <p>This code expires in 10 minutes.</p>`,
    });
    return res.status(200).json({ verificationId: "ok" });
  } catch (err) {
    console.error("request-code error", err?.response?.body || err);
    return res.status(500).json({ error: "failed to send code" });
  }
}
