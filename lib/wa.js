/** Kirim WhatsApp lewat Fonnte (FONNTE_TOKEN). */
async function sendWa(target, message) {
  const token = process.env.FONNTE_TOKEN;
  if (!token) throw new Error('FONNTE_TOKEN belum di-set');
  const r = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, message, countryCode: '62' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.status) throw new Error(j.reason || j.message || `Fonnte HTTP ${r.status}`);
  return j;
}
module.exports = { sendWa };
