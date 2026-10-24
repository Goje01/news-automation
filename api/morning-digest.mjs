import { sendMorningDigests } from "../lib/digest.mjs";
import { authorized } from "../lib/auth.mjs";

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  try {
    await sendMorningDigests();
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
