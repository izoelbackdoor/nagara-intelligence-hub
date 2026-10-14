/**
 * Nagara Robot Trading — Signal Webhook
 * POST: Terima sinyal dari Python bot atau TradingView
 *       Wajib secret = env ROBOT_WEBHOOK_SECRET (min. 16 karakter), dikirim lewat
 *       header "X-Nagara-Secret" atau field "secret" di body (TradingView tidak bisa set header).
 *       Bila env belum di-set, semua sinyal ditolak (503) — tidak ada secret default.
 * GET:  Kembalikan sinyal terbaru untuk dashboard (wajib login).
 *
 * Catatan: Vercel Serverless Functions bersifat stateless.
 * Sinyal di-buffer di memory per instance (ephemeral).
 * Untuk produksi, ganti dengan KV store / tabel Supabase.
 */

const { requireAuth, safeEqual, sendJson } = require("../../lib/session");

const MAX_SIGNALS = 100; // max sinyal yang disimpan
const SECRET_FIELDS = ["secret", "passphrase", "token", "key"];

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

/** Salinan body tanpa field rahasia, supaya secret tidak ikut tersimpan / tampil di GET. */
function withoutSecrets(body) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!SECRET_FIELDS.includes(k.toLowerCase())) out[k] = v;
  }
  return out;
}

const clip = (s, n) => String(s ?? "").slice(0, n);

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  // ── GET: ambil sinyal terbaru (dashboard, wajib login) ────────────
  if (req.method === "GET") {
    if (!requireAuth(req, res)) return;
    const q = req.query || {};
    const limit = Math.min(Math.max(parseInt(q.limit || "20", 10) || 20, 1), MAX_SIGNALS);
    const pair = q.pair ? String(q.pair).toLowerCase() : null;
    let signals = global._robotSignals;
    if (pair) signals = signals.filter(s => s.pair && String(s.pair).toLowerCase() === pair);
    return sendJson(res, 200, { ok: true, count: signals.length, signals: signals.slice(0, limit) });
  }

  // ── POST: terima sinyal baru (bot / TradingView, wajib secret) ────
  if (req.method === "POST") {
    const expected = process.env.ROBOT_WEBHOOK_SECRET || "";
    if (expected.length < 16) {
      return sendJson(res, 503, { ok: false, error: "Webhook robot belum dikonfigurasi (ROBOT_WEBHOOK_SECRET)" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body && typeof body === "object" ? body : {};

    const given = req.headers["x-nagara-secret"] || body.secret || "";
    if (!safeEqual(given, expected)) {
      return sendJson(res, 401, { ok: false, error: "Unauthorized" });
    }

    const source = body.source === "tradingview" ? "tradingview" : "python_bot";

    // Normalise payload dari TradingView (format berbeda)
    let signal;
    if (source === "tradingview") {
      const raw = withoutSecrets(body);
      signal = {
        source:    "tradingview",
        signal:    clip(body.action || body.signal || "HOLD", 20).toUpperCase(),
        pair:      clip(body.ticker || body.pair || "UNKNOWN", 40),
        price:     parseFloat(body.close || body.price || 0) || 0,
        strategy:  clip(body.strategy_name || body.strategy || "TradingView Alert", 120),
        reason:    clip(body.comment || body.reason || body.message || "", 500),
        dry_run:   false,
        bot_name:  "TradingView",
        timestamp: clip(body.time || new Date().toISOString(), 40),
        raw:       JSON.stringify(raw).length < 4000 ? raw : undefined,
      };
    } else {
      // Format dari Python bot
      signal = {
        source:    "python_bot",
        signal:    clip(body.signal || "HOLD", 20).toUpperCase(),
        pair:      clip(body.pair || "UNKNOWN", 40),
        price:     parseFloat(body.price || 0) || 0,
        strategy:  clip(body.strategy || "", 120),
        reason:    clip(body.reason || "", 500),
        dry_run:   body.dry_run !== undefined ? !!body.dry_run : true,
        bot_name:  clip(body.bot_name || "Nagara Bot", 60),
        pnl:       body.pnl !== undefined ? parseFloat(body.pnl) : null,
        timestamp: clip(body.timestamp || new Date().toISOString(), 40),
      };
    }

    addSignal(signal);
    console.log(`[Robot Signal] ${signal.source} | ${signal.signal} ${signal.pair} @ ${signal.price}`);
    return sendJson(res, 200, { ok: true, received: signal });
  }

  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
};
