/**
 * useNgiFeed — sumber data Virtual Office NGI.
 * Menggantikan WebSocket lokal Claude Office: membaca /api/office/state (wajib login dashboard)
 * lalu menerjemahkannya menjadi OfficeEvent yang sudah dipahami App.
 *  - meja berstatus "aktif"  → agen datang & duduk di meja (agent_spawned)
 *  - laporan baru (events)   → status/bubble agen (agent_working) + pesan chat
 *  - permintaan persetujuan  → pesan chat 🙋
 */
import { useEffect, useRef } from 'react'
import type { OfficeEvent } from '../types'
import { AGENT_CONFIGS } from '../types'
import { ROLE_TO_CHAR } from '../config'

interface Desk { key: string; unit_key: string; name: string; role: string; status: string; last_seen_at?: string | null }
interface Unit { key: string; name: string; color: string }
interface Ev { id: number; desk_key: string | null; level: string; message: string; created_at: string }
interface Appr { id: string; desk_key: string | null; kind: string; summary: string; created_at: string }
interface State { units: Unit[]; desks: Desk[]; events: Ev[]; approvals: Appr[] }

const SPRITES = ['Frontend-dev-1', 'dev-1', 'dev-2', 'employee-1', 'employee-2', 'employee-3', 'security-audit-1', 'explore-1']
const EMOJI: Record<string, string> = { media: '📰', inti: '🧭', studio: '🎨', platform: '🧩', umkm: '🏪' }
const POLL_MS = 15_000

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }
export const ngiRole = (deskKey: string) => `ngi-${deskKey}`

function register(d: Desk, u?: Unit) {
  const role = ngiRole(d.key)
  AGENT_CONFIGS[role] = { color: u?.color ?? '#95a5a6', emoji: EMOJI[d.unit_key] ?? '🤖', title: d.name }
  ROLE_TO_CHAR[role] = SPRITES[hash(d.key) % SPRITES.length]
  return role
}

export function useNgiFeed({ onEvent, disabled = false }: { onEvent: (e: OfficeEvent) => void; disabled?: boolean }) {
  const cb = useRef(onEvent); cb.current = onEvent
  const spawned = useRef(new Set<string>())
  const lastEvent = useRef<number | null>(null)
  const seenAppr = useRef(new Set<string>())
  const warned = useRef(false)

  useEffect(() => {
    if (disabled) return
    let stop = false
    const say = (sender: string, role: string | undefined, text: string) =>
      cb.current({ type: 'chat_message', sender, text, ...(role ? { role } : {}), timestamp: Date.now() + Math.random() } as OfficeEvent)

    async function poll() {
      try {
        const r = await fetch('/api/office/state', { credentials: 'same-origin', cache: 'no-store' })
        if (r.status === 401) { if (!warned.current) { warned.current = true; say('Claude', undefined, '🔒 Sesi login habis — login ulang di Command Center lalu buka Virtual Office lagi.') } return }
        if (!r.ok) { if (!warned.current) { warned.current = true; say('Claude', undefined, `⚠️ Database kantor belum bisa dibaca (HTTP ${r.status}).`) } return }
        warned.current = false
        const s: State = await r.json()
        const units = new Map(s.units.map(u => [u.key, u]))
        const desks = new Map(s.desks.map(d => [d.key, d]))
        // 1) agen aktif masuk kantor
        for (const d of s.desks) {
          if (d.status !== 'aktif' || spawned.current.has(d.key)) continue
          const role = register(d, units.get(d.unit_key))
          spawned.current.add(d.key)
          cb.current({ type: 'agent_spawned', agent: { id: d.key, name: d.name, role, task: d.role } })
        }
        // 2) laporan baru → bubble + chat (pemuatan pertama: tampilkan 5 terakhir saja di chat)
        const evs = [...s.events].sort((a, b) => a.id - b.id)
        const first = lastEvent.current === null
        const fresh = first ? evs.slice(-5) : evs.filter(e => e.id > (lastEvent.current as number))
        if (evs.length) lastEvent.current = evs[evs.length - 1].id
        else if (first) lastEvent.current = 0
        for (const e of fresh) {
          const d = e.desk_key ? desks.get(e.desk_key) : undefined
          const icon = e.level === 'bahaya' ? '🚨 ' : e.level === 'peringatan' ? '⚠️ ' : ''
          if (d && spawned.current.has(d.key) && !first) cb.current({ type: 'agent_working', agentId: d.key, status: icon + e.message })
          else say(d ? d.name : 'Claude', d ? ngiRole(d.key) : undefined, icon + e.message)
        }
        // 3) permintaan persetujuan
        for (const a of s.approvals) {
          if (seenAppr.current.has(a.id)) continue
          seenAppr.current.add(a.id)
          const d = a.desk_key ? desks.get(a.desk_key) : undefined
          say(d ? d.name : 'Claude', d ? ngiRole(d.key) : undefined, `🙋 Minta persetujuan Anda (${a.kind}): ${a.summary}`)
        }
      } catch {
        if (!warned.current) { warned.current = true; say('Claude', undefined, '⚠️ Tidak bisa terhubung ke server kantor.') }
      }
    }
    poll()
    const t = setInterval(() => { if (!stop) poll() }, POLL_MS)
    return () => { stop = true; clearInterval(t) }
  }, [disabled])
}
