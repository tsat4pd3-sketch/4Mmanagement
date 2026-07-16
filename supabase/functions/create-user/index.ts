import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── create-user: สร้างบัญชีผู้ใช้ + โปรไฟล์ครบทุก field ในจังหวะเดียว ──────────
// เรียกจากหน้า จัดการผู้ใช้งาน (AddUser.jsx) เท่านั้น
//
// กติกาสำคัญ (แก้บั๊กยุคแรก 2026-07-13):
// 1. ผู้เรียกต้องเป็น admin เท่านั้น — เช็คจาก profiles.role ของ JWT ผู้เรียก (เดิมใครก็เรียกได้)
// 2. ห้าม hardcode รายชื่อ role — validate กับ enum user_role ใน DB สดๆ
//    (เดิม hardcode 5 role ค้างไว้ ทำให้เลือก sale แล้วโดนสลับเป็น supervisor เงียบๆ)
//    role ไม่ผ่าน = ปฏิเสธพร้อม error ชัดๆ ไม่สลับค่าให้เอง
// 3. เขียนโปรไฟล์ครบทุก field (position/sections/notify_email) ในจังหวะเดียว — ไม่ต้องให้
//    client ตามอัพเดทเป็นจังหวะสอง (เดิมถ้าจังหวะสองพลาด ได้ user ไร้ scope/ตำแหน่ง)
// 4. กัน fail-open ฝั่ง server ด้วย: supervisor ต้องมี sections / leader ต้องมี line+team
// 5. ถ้า insert โปรไฟล์พลาด ลบบัญชี auth ทิ้งทันที — ไม่ทิ้งบัญชีค้างครึ่งทาง

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

    // ── 1) ผู้เรียกต้อง login และเป็น admin ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !caller) return json({ error: 'Unauthorized' }, 401)
    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', caller.id).single()
    if (callerProfile?.role !== 'admin') {
      return json({ error: 'เฉพาะ admin เท่านั้นที่สร้างผู้ใช้ได้' }, 403)
    }

    const { email, password, role, full_name, position, section, sections, team, line_id, notify_email } = await req.json()

    if (!email || !password) return json({ error: 'ต้องระบุ Email และรหัสผ่าน' }, 400)

    // ── 2) validate role กับ enum จริงใน DB (รองรับ role ใหม่อัตโนมัติ ไม่ต้องแก้ function) ──
    const { data: roleRows, error: enumErr } = await admin.rpc('get_user_roles')
    let validRoles: string[] = []
    if (!enumErr && Array.isArray(roleRows)) validRoles = roleRows.map((r: { role: string }) => r.role)
    if (!validRoles.length) {
      // fallback: ไม่มี RPC — ปล่อยให้ enum constraint ของ DB ตัดสินตอน insert (ยังปลอดภัย แค่ error อ่านยากกว่า)
      validRoles = [role]
    }
    if (!validRoles.includes(role)) {
      return json({ error: `ชุดสิทธิ์ "${role}" ไม่มีในระบบ (มี: ${validRoles.join(', ')})` }, 400)
    }

    // ── 3) กัน fail-open scope ฝั่ง server (ซ้ำกับ validation ฝั่งฟอร์ม — กันเรียกตรง/ฟอร์มเวอร์ชันเก่า) ──
    const secArr: string[] = Array.isArray(sections) ? sections.filter(Boolean) : []
    if (role === 'supervisor' && !secArr.length && !section) {
      return json({ error: 'Supervisor ต้องกำหนด Section อย่างน้อย 1 ส่วนงาน' }, 400)
    }
    if (role === 'leader' && (!line_id || !team)) {
      return json({ error: 'Leader ต้องกำหนดทั้งไลน์ผลิตและ Team' }, 400)
    }

    // ── 4) สร้างบัญชี + โปรไฟล์ครบทุก field ──
    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (createError) return json({ error: createError.message }, 400)

    if (newUser.user) {
      const { error: profileError } = await admin.from('profiles').insert({
        id:           newUser.user.id,
        role,
        full_name:    full_name || null,
        position:     position || null,
        section:      secArr[0] || section || null, // section เดี่ยว = ตัวแรกเสมอ (rollback compat)
        sections:     secArr.length ? secArr : null,
        team:         team || null,
        line_id:      line_id ? Number(line_id) : null,
        notify_email: notify_email || null,
      })
      if (profileError) {
        // insert พลาด — ลบบัญชี auth ทิ้ง ไม่ทิ้งบัญชีค้างครึ่งทาง
        await admin.auth.admin.deleteUser(newUser.user.id)
        return json({ error: `สร้างโปรไฟล์ไม่สำเร็จ: ${profileError.message}` }, 400)
      }
    }

    return json({ success: true, user: { id: newUser.user?.id } })
  } catch (error) {
    return json({ error: (error as Error).message }, 400)
  }
})
