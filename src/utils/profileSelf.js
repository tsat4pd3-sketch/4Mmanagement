import { supabase } from '../supabaseClient';

/* ═══ บันทึก "ลายเซ็น / รูปโปรไฟล์" ของตัวเอง (2026-08-17) ═══
   ⚠️ กับดักที่ทำให้ลายเซ็นหายหลัง logout:
     `supabase.from('profiles').update({...}).eq('id', me)` ที่ถูก RLS บล็อก
     **ไม่คืน error** — คืนว่าสำเร็จแต่แก้ 0 แถว → โค้ดเดิมขึ้น "บันทึกเรียบร้อย"
     ทั้งที่ไม่มีอะไรถูกเขียน (พิสูจน์บน PostgreSQL 16 แล้ว)

   กติกา:
     1) เขียนผ่าน RPC `set_my_signature` / `set_my_avatar` (SECURITY DEFINER)
        → ผ่านได้ไม่ว่า policy ของ profiles จะตั้งไว้ยังไง และแตะได้เฉพาะคอลัมน์นั้น
     2) ยังไม่ได้ apply migration → ถอยไป update ตรง **แต่ต้อง .select() นับแถวเสมอ**
        0 แถว = ล้มเหลว ต้องบอกผู้ใช้ ห้ามขึ้นว่าสำเร็จ

   จุดใหม่ที่ให้ user แก้ข้อมูลโปรไฟล์ตัวเอง ให้ใช้ helper นี้ ห้าม update ตรง */

const RPC = { signature_url: 'set_my_signature', avatar_url: 'set_my_avatar' };

const rpcMissing = (e) =>
  e?.code === 'PGRST202' || e?.code === '42883' || /(function|schema cache)/i.test(e?.message || '');

/** @returns {Promise<{ok:true} | {ok:false, message:string}>} */
export async function saveMyProfileMedia(field, url) {
  const fn = RPC[field];
  if (!fn) return { ok: false, message: `ฟิลด์ ${field} ไม่อยู่ในรายการที่แก้เองได้` };

  const { error } = await supabase.rpc(fn, { p_url: url });
  if (!error) return { ok: true };
  if (!rpcMissing(error)) return { ok: false, message: error.message };

  // ── fallback: ยังไม่ได้ apply migration 20260817_profile_self_update_rpc ──
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, message: 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่' };

  const { data, error: upErr } = await supabase
    .from('profiles').update({ [field]: url }).eq('id', user.id).select('id');
  if (upErr) return { ok: false, message: upErr.message };
  if (!data?.length) {
    // แก้ไม่ได้แม้แต่แถวตัวเอง = RLS บล็อก (นี่คือเคสที่ทำให้ลายเซ็นหายมาตลอด)
    return { ok: false, message: 'บันทึกไม่สำเร็จ — ฐานข้อมูลไม่อนุญาตให้แก้โปรไฟล์ของตัวเอง '
      + '(ต้อง apply migration 20260817_profile_self_update_rpc ก่อน · แจ้ง admin)' };
  }
  return { ok: true };
}
