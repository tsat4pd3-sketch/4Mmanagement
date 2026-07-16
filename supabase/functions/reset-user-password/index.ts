import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── reset-user-password: admin ตั้งรหัสผ่านใหม่ให้ user — admin เท่านั้น ─────────
// ใช้เมื่อ user ลืมรหัส/login ไม่ได้ (ระบบไม่มี email จริงให้ส่งลิงก์ reset)
// เรียกจากหน้า จัดการผู้ใช้งาน (AddUser.jsx modal แก้ไข) · ต้องใช้ service role จึงทำฝั่ง client ไม่ได้
// กันพลาด: เปลี่ยนรหัสบัญชี admin ผ่านทางนี้ไม่ได้ (admin เปลี่ยนรหัสตัวเองผ่าน ChangePasswordModal)

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
    if (callerProfile?.role !== 'admin') return json({ error: 'เฉพาะ admin เท่านั้นที่รีเซ็ตรหัสผ่านได้' }, 403)

    const { user_id, new_password } = await req.json()
    if (!user_id) return json({ error: 'ต้องระบุ user_id' }, 400)
    if (typeof new_password !== 'string' || new_password.length < 6) {
      return json({ error: 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร' }, 400)
    }

    const { data: target } = await admin.from('profiles').select('role, full_name').eq('id', user_id).maybeSingle()
    if (target?.role === 'admin') {
      return json({ error: 'เปลี่ยนรหัสบัญชี admin ผ่านทางนี้ไม่ได้ — ให้เจ้าตัวเปลี่ยนเองจากเมนูเปลี่ยนรหัสผ่าน' }, 400)
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(user_id, { password: new_password })
    if (updErr) return json({ error: updErr.message }, 400)

    return json({ success: true })
  } catch (error) {
    return json({ error: (error as Error).message }, 400)
  }
})
