import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── delete-user: ลบบัญชีผู้ใช้ (auth + โปรไฟล์) — admin เท่านั้น ────────────────
// เรียกจากหน้า จัดการผู้ใช้งาน (AddUser.jsx) · การลบ auth.users ต้องใช้ service role
// จึงทำฝั่ง client ตรงๆ ไม่ได้
// กันพลาด: ห้ามลบบัญชีตัวเอง · ห้ามลบบัญชีที่เป็น admin (ต้องถอด role ก่อน — กันลบ admin คนสุดท้าย)
//
// 🔗 บัญชีที่มีประวัติผูกอยู่ (2026-11-05 · เคสจริง: บัญชีซ้ำของคนเดียวกันมีใบเช็คชื่อ 99 ใบ)
//   FK แบบ NO ACTION (เช่น daily_production_logs.checked_by → profiles) ทำให้ auth.admin.deleteUser ล้ม
//   ด้วยข้อความ "Database error deleting user" ที่บอกอะไรไม่ได้ ⇒
//   · ไม่ส่ง reassign_to : ถาม fn_profile_ref_blockers ก่อน — ติด = ตอบ 409 พร้อมรายการ {tbl,col,n}
//   · ส่ง reassign_to    : โอนคอลัมน์ผู้กระทำทุกตัวไปบัญชีปลายทาง (fn_profile_reassign_refs) แล้วค่อยลบ
//     ใช้เฉพาะ "บัญชีซ้ำของคนเดียวกัน" — ประวัติ "ใครตรวจ/ใครสร้าง" ต้องไม่หายเงียบ (traceability)
//   ทั้ง 2 ฟังก์ชันเป็น service_role เท่านั้น (migration 20261105_profile_ref_blockers_main.sql)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !caller) return json({ error: 'Unauthorized' }, 401)
    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', caller.id).single()
    if (callerProfile?.role !== 'admin') return json({ error: 'เฉพาะ admin เท่านั้นที่ลบผู้ใช้ได้' }, 403)

    const { user_id, reassign_to } = await req.json()
    if (!user_id) return json({ error: 'ต้องระบุ user_id' }, 400)
    if (user_id === caller.id) return json({ error: 'ห้ามลบบัญชีของตัวเอง' }, 400)

    const { data: target } = await admin.from('profiles').select('role, full_name').eq('id', user_id).maybeSingle()
    if (target?.role === 'admin') {
      return json({ error: 'ห้ามลบบัญชี admin — เปลี่ยนชุดสิทธิ์เป็นอย่างอื่นก่อนถ้าต้องการลบจริง' }, 400)
    }

    let moved: { tbl: string; col: string; n: number }[] = []
    if (reassign_to) {
      if (reassign_to === user_id) return json({ error: 'บัญชีปลายทางต้องไม่ใช่บัญชีที่กำลังลบ' }, 400)
      const { data: dest } = await admin.from('profiles').select('id, full_name').eq('id', reassign_to).maybeSingle()
      if (!dest) return json({ error: 'ไม่พบบัญชีปลายทางที่จะโอนประวัติให้' }, 400)
      const { data: rows, error: mvErr } = await admin.rpc('fn_profile_reassign_refs', { p_from: user_id, p_to: reassign_to })
      if (mvErr) return json({ error: `โอนประวัติไม่สำเร็จ — ยังไม่ได้ลบ: ${mvErr.message}` }, 400)
      moved = rows ?? []
    } else {
      // ถามก่อนว่าอะไรกันลบอยู่ — ดีกว่าปล่อยให้ deleteUser ล้มด้วยข้อความที่อ่านไม่รู้เรื่อง
      const { data: blockers, error: bErr } = await admin.rpc('fn_profile_ref_blockers', { p_uid: user_id })
      if (bErr) return json({ error: `ตรวจประวัติที่ผูกกับบัญชีไม่ได้ — ยังไม่ได้ลบ: ${bErr.message}` }, 400)
      if (blockers?.length) {
        const total = blockers.reduce((s: number, b: { n: number }) => s + Number(b.n || 0), 0)
        return json({
          error: `ลบไม่ได้ — บัญชีนี้มีประวัติผูกอยู่ ${total} รายการ (${blockers.map((b: { tbl: string; col: string; n: number }) => `${b.tbl}.${b.col} ${b.n}`).join(' · ')})`,
          blockers,
        }, 409)
      }
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(user_id)
    if (delErr) return json({ error: delErr.message, moved }, 400)
    // โปรไฟล์: เผื่อ FK ไม่ได้ตั้ง cascade — ลบซ้ำแบบ idempotent
    await admin.from('profiles').delete().eq('id', user_id)

    return json({ success: true, moved })
  } catch (error) {
    return json({ error: (error as Error).message }, 400)
  }
})
