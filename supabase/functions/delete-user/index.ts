import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── delete-user: ลบบัญชีผู้ใช้ (auth + โปรไฟล์) — admin เท่านั้น ────────────────
// เรียกจากหน้า จัดการผู้ใช้งาน (AddUser.jsx) · การลบ auth.users ต้องใช้ service role
// จึงทำฝั่ง client ตรงๆ ไม่ได้
// กันพลาด: ห้ามลบบัญชีตัวเอง · ห้ามลบบัญชีที่เป็น admin (ต้องถอด role ก่อน — กันลบ admin คนสุดท้าย)

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

    const { user_id } = await req.json()
    if (!user_id) return json({ error: 'ต้องระบุ user_id' }, 400)
    if (user_id === caller.id) return json({ error: 'ห้ามลบบัญชีของตัวเอง' }, 400)

    const { data: target } = await admin.from('profiles').select('role, full_name').eq('id', user_id).maybeSingle()
    if (target?.role === 'admin') {
      return json({ error: 'ห้ามลบบัญชี admin — เปลี่ยนชุดสิทธิ์เป็นอย่างอื่นก่อนถ้าต้องการลบจริง' }, 400)
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(user_id)
    if (delErr) return json({ error: delErr.message }, 400)
    // โปรไฟล์: เผื่อ FK ไม่ได้ตั้ง cascade — ลบซ้ำแบบ idempotent
    await admin.from('profiles').delete().eq('id', user_id)

    return json({ success: true })
  } catch (error) {
    return json({ error: (error as Error).message }, 400)
  }
})
