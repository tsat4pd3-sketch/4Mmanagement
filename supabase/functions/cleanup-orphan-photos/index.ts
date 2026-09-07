import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── ล้างไฟล์กำพร้าใน bucket employee-photos ─────────────────────────────────
// "กำพร้า" = ไฟล์ที่ไม่มี employees.image_url หรือ line_layouts.image_url ชี้ถึงแล้ว
// เกิดจากระบบเวอร์ชันก่อนหน้า: เปลี่ยนรูปแล้วอัปโหลดชื่อใหม่โดยไม่ลบไฟล์เดิม (เคยสะสม ~100MB)
// ตอนนี้ฝั่งแอปลบไฟล์เก่าเองแล้ว (operator.jsx / LineSetup.jsx) — function นี้ไว้เก็บกวาดย้อนหลัง/ตามรอบ
//
// วิธีเรียก (admin เท่านั้น รู้ token):
//   POST /functions/v1/cleanup-orphan-photos?dry_run=1   → รายงานอย่างเดียว ไม่ลบ
//   POST /functions/v1/cleanup-orphan-photos             → ลบจริง
//   header: x-cleanup-token: <CLEANUP_TOKEN>
// กันพลาด: ไฟล์ที่เพิ่งอัปโหลดภายใน 24 ชม. จะไม่ถูกแตะ (อาจกำลังรอผูกกับ record)

// token อ่านจาก secret เท่านั้น (เคยฝังในซอร์ส = อยู่ใน git history ของทุกคน · แก้ 2026-09-07)
//   ตั้งด้วย: supabase secrets set CLEANUP_TOKEN=<สุ่มใหม่> --project-ref ewhdfqwfwofivojtsizn  แล้ว deploy ใหม่
//   ไม่ตั้ง = function ปฏิเสธทุกคำขอ (fail-closed) — ดีกว่าเปิดให้ token เก่าที่รั่วแล้วใช้ต่อ
const CLEANUP_TOKEN = Deno.env.get('CLEANUP_TOKEN') ?? ''
const BUCKET = 'employee-photos'
const SAFETY_MS = 24 * 60 * 60 * 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cleanup-token',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!CLEANUP_TOKEN) return json({ error: 'CLEANUP_TOKEN not configured' }, 503)
  if (req.headers.get('x-cleanup-token') !== CLEANUP_TOKEN) return json({ error: 'unauthorized' }, 401)

  try {
    const dryRun = new URL(req.url).searchParams.get('dry_run') === '1'
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // 1) รวบรวมชื่อไฟล์ที่ยังถูกอ้างอิงอยู่
    const refs = new Set<string>()
    const addRef = (url: string | null) => {
      const name = (url ?? '').split(`/${BUCKET}/`)[1]
      if (name) refs.add(decodeURIComponent(name))
    }
    const { data: emps, error: e1 } = await admin.from('employees').select('image_url')
    if (e1) throw e1
    for (const r of emps ?? []) addRef(r.image_url)
    const { data: layouts, error: e2 } = await admin.from('line_layouts').select('image_url')
    if (e2) throw e2
    for (const r of layouts ?? []) addRef(r.image_url)
    // ผังรวมโรงงาน (factory/) — whitelist กันโดนลบ (เก็บ bucket เดียวกับ layouts)
    // ⚠️ whitelist ทุกตารางต้อง throw เมื่อคิวรีล้ม — ถ้ากลืน error ตรงนี้ fmaps=undefined
    //    → รูปผังรวมโรงงานทุกไฟล์ใน factory/ กลายเป็น "กำพร้า" แล้วถูกลบจริง (พบตอน audit 2026-09-07)
    const { data: fmaps, error: e3 } = await admin.from('factory_map').select('image_url')
    if (e3) throw e3
    for (const r of fmaps ?? []) addRef(r.image_url)

    // 2) ไล่รายชื่อไฟล์ทั้ง bucket (root + โฟลเดอร์ layouts/)
    const listAll = async (prefix: string) => {
      const out: { name: string; created_at: string; size: number }[] = []
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 100, offset })
        if (error) throw error
        for (const f of data ?? []) {
          if (!f.id) continue // โฟลเดอร์ย่อย ไม่ใช่ไฟล์
          out.push({
            name: prefix ? `${prefix}/${f.name}` : f.name,
            created_at: f.created_at,
            size: Number(f.metadata?.size ?? 0),
          })
        }
        if ((data ?? []).length < 100) break
      }
      return out
    }
    const files = [...await listAll(''), ...await listAll('layouts'), ...await listAll('factory')]

    // 3) คัดไฟล์กำพร้า (ข้ามไฟล์ใหม่ภายใน 24 ชม.)
    const cutoff = Date.now() - SAFETY_MS
    const orphans = files.filter(f => !refs.has(f.name) && new Date(f.created_at).getTime() < cutoff)
    const freedBytes = orphans.reduce((s, f) => s + f.size, 0)

    // 4) ลบเป็น batch ละ 50
    let deleted = 0
    if (!dryRun) {
      for (let i = 0; i < orphans.length; i += 50) {
        const batch = orphans.slice(i, i + 50).map(f => f.name)
        const { error } = await admin.storage.from(BUCKET).remove(batch)
        if (error) throw error
        deleted += batch.length
      }
    }

    return json({
      dry_run: dryRun,
      total_files: files.length,
      referenced: refs.size,
      orphans: orphans.length,
      deleted,
      freed_mb: Math.round(freedBytes / 1024 / 1024 * 10) / 10,
      sample: orphans.slice(0, 10).map(f => f.name),
    })
  } catch (err) {
    return json({ error: (err as Error).message }, 400)
  }
})
