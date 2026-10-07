/** Alat bersama untuk karyawan AI (dipakai api/agents/run.js). */
const { getSession, safeEqual } = require('../session');
const { sb } = require('../supabase');

const MODEL = 'claude-haiku-4-5-20251001';
const PRICE = { in: 1 / 1e6, out: 5 / 1e6 }; // USD per token (Haiku)

function whoCalls(req) {
  const cron = process.env.CRON_SECRET || '';
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (cron.length >= 16 && safeEqual(got, cron)) return 'cron';
  if (getSession(req)) return 'owner';
  return null;
}

async function ensureAgent({ desk, name, tools, budget }) {
  const rows = await sb(`office_agents?select=id&desk_key=eq.${desk}`);
  let id = rows[0]?.id;
  if (!id) {
    const ins = await sb('office_agents', { method: 'POST', prefer: 'return=representation', body: {
      desk_key: desk, name, model: MODEL, status: 'aktif', tools, daily_budget_usd: budget,
      needs_approval: ['kirim_klien', 'uang', 'publikasi', 'deploy'],
    } });
    id = ins[0].id;
  }
  await sb(`office_desks?key=eq.${desk}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'aktif', agent_id: id, model: 'Haiku', last_seen_at: new Date().toISOString() } });
  return id;
}

async function spentToday(desk) {
  const since = new Date(Date.now() - 864e5).toISOString();
  const rows = await sb(`office_costs?select=usd&desk_key=eq.${desk}&created_at=gte.${since}`);
  return rows.reduce((s, r) => s + Number(r.usd || 0), 0);
}

async function callClaude(system, user, maxTokens = 700) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return { text: j.content.map(c => c.text || '').join('').trim(), usage: j.usage || {} };
}

async function logCost(desk, usage) {
  const usd = (usage.input_tokens || 0) * PRICE.in + (usage.output_tokens || 0) * PRICE.out;
  await sb('office_costs', { method: 'POST', prefer: 'return=minimal', body: { desk_key: desk, model: MODEL, tokens_in: usage.input_tokens || 0, tokens_out: usage.output_tokens || 0, usd } });
  return usd;
}

const event = (unit_key, desk_key, level, message, meta) =>
  sb('office_events', { method: 'POST', prefer: 'return=minimal', body: { unit_key, desk_key, level, message: String(message).slice(0, 500), ...(meta ? { meta } : {}) } });

module.exports = { MODEL, whoCalls, ensureAgent, spentToday, callClaude, logCost, event };
