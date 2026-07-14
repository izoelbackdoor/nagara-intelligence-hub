/**
 * Nagara Robot Trading — Signal Webhook
 * POST: Terima sinyal dari Python bot atau TradingView
 * GET:  Kembalikan sinyal terbaru untuk dashboard
 *
 * Catatan: Vercel Serverless Functions bersifat stateless.
 * Sinyal di-buffer di memory per instance (ephemeral).
 * Untuk produksi, ganti dengan KV store (Vercel KV / Redis).
 */

const WEBHOOK_SECRET = process.env.ROBOT_WEBHOOK_SECRET || "nagara_robot_secret_2025";
const MAX_SIGNALS    = 100; // max sinyal yang disimpan

// In-memory buffer (per Vercel instance, ephemeral)
if (!global._robotSignals) {
  global._robotSignals = [];
}

function addSignal(signal) {
  global._robotSignals.unshift(signal);
  if (global._robotSignals.length > MAX_SIGNALS) {
    global._robotSignals = global._robotSignals.slice(0, MAX_SIGNALS);
  }
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ── GET: ambil sinyal terbaru ──────────────────────────────────
  if (req.method === "GET") {
    const limit  = parseInt(req.query.limit || "20", 10);
    const pair   = req.query.pair || null;
    let signals  = global._robotSignals;
    if (pair) {
      signals = signals.filter(s => s.pair && s.pair.toLowerCase() === pair.toLowerCase());
    }
    return res.status(200).json({
      ok:      true,
      count:   signals.length,
      signals: signals.slice(0, limit),
    });
  }

  // ── POST: terima sinyal baru ───────────────────────────────────
  if (req.method === "POST") {
    let body = req.body;

    // Parse JSON jika belum
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    // Validasi secret
    const secret = body.secret || req.headers["x-nagara-secret"];
    if (secret !== WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    // Tentukan source
    const source = body.source || "python_bot";

    // Normalise payload dari TradingView (format berbeda)
    let signal;
    if (source === "tradingview") {
      signal = {
        source:    "tradingview",
        signal:    (body.action || body.signal || "HOLD").toUpperCase(),
        pair:      body.ticker || body.pair || "UNKNOWN",
        price:     parseFloat(body.close || body.price || 0),
        strategy:  body.strategy_name || body.strategy || "TradingView Alert",
        reason:    body.comment || body.reason || body.message || "",
        dry_run:   false,
        bot_name:  "TradingView",
        timestamp: body.time || new Date().toISOString(),
        raw:       body,
      };
    } else {
      // Format dari Python bot
      signal = {
        source:    "python_bot",
        signal:    (body.signal || "HOLD").toUpperCase(),
        pair:      body.pair   || "UNKNOWN",
        price:     parseFloat(body.price  || 0),
        strategy:  body.strategy || "",
        reason:    body.reason   || "",
        dry_run:   body.dry_run  !== undefined ? body.dry_run : true,
        bot_name:  body.bot_name || "Nagara Bot",
        pnl:       body.pnl !== undefined ? parseFloat(body.pnl) : null,
        timestamp: body.timestamp || new Date().toISOString(),
      };
    }

    addSignal(signal);

    console.log(`[Robot Signal] ${signal.source} | ${signal.signal} ${signal.pair} @ ${signal.price}`);

    return res.status(200).json({ ok: true, received: signal });
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
};
