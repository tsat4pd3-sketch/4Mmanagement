import { useContext } from 'react';
import PageHeader from '../components/PageHeader';
import ImageSqueezePanel from '../components/ImageSqueezePanel';
import { UserContext } from '../App';
import { can, isActionSeeded } from '../utils/permissions';

/* ══ 🗜️ ดูแลพื้นที่จัดเก็บ / ค่าเน็ต — /storage-maintenance ═══════════════════════════
   2026-09-22 · คำสั่ง user: "ที่จริงฟังก์ชันปุ่มบีบอัดรูปน่าจะอยู่ที่ setting"
   ถูกต้อง — งานบีบรูปกวาด **ทั้งระบบ** 6 กลุ่ม (ผังไลน์ · ผังโรงงาน · ผังเครื่องจักร ·
   รูปจุดตรวจ PM · รูปซ่อม MO · รูปพนักงาน) ไม่ได้ผูกกับไลน์ใดไลน์หนึ่ง
   เดิมแขวนไว้ที่ `/linesetup` ซึ่ง (ก) ไม่อยู่ใน sidebar (ฝังอยู่ใน /layout-setup)
   (ข) ชื่อหน้าบอกว่าเป็นเรื่อง "ตั้งค่าไลน์" ⇒ **หาไม่เจอ** (user ต้องถามว่าปุ่มอยู่ไหน)

   หน้านี้ตั้งใจให้เป็นบ้านของ "งานดูแลระบบที่กินค่าเน็ต/พื้นที่" — มีอะไรเพิ่มในอนาคต
   (เก็บกวาดรูปขยะ · ล้าง cache · ดูยอดใช้พื้นที่) ให้มาต่อที่นี่ **ห้ามแตกไปแขวนหน้าอื่น**
   ════════════════════════════════════════════════════════════════════════════════════ */

export default function StorageMaintenance() {
  const { role } = useContext(UserContext);
  /* สิทธิ์แบบ deploy-safe (pattern เดียวกับ canDelete ใน permissions.js):
     คีย์ใหม่ `storage_maintain:run` ถ้ายังไม่ seed → ถอยไปใช้สิทธิ์เดิมที่เคยคุมปุ่มนี้
     (`line_setup:edit` — ปุ่มอยู่ที่ /linesetup มาก่อน) ⇒ ก่อน apply migration ใครกดได้ก็ยังกดได้เท่าเดิม */
  const canRun = isActionSeeded('storage_maintain', 'run')
    ? can('storage_maintain', 'run', role)
    : can('line_setup', 'edit', role);

  return (
    <div style={{ padding: '18px 20px 40px', maxWidth: 900 }}>
      <PageHeader
        title="ดูแลพื้นที่จัดเก็บ / ค่าเน็ต" icon="🗜️"
        sub="บีบรูปที่อัปไว้แล้วให้เล็กลง — ความละเอียดเท่าเดิม"
      />

      {/* ทำไมต้องมีหน้านี้ — เขียนไว้เพราะเป็นเหตุการณ์ที่ทำให้ทั้งโรงงาน login ไม่ได้ */}
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-lg)',
        padding: 12, marginBottom: 12, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7,
      }}>
        <b style={{ color: 'var(--text)' }}>ทำไมต้องบีบ:</b> Supabase คิดค่าบริการตาม
        “จำนวนไบต์ที่ส่งออกไปหาเครื่องผู้ใช้” (egress) — ไม่ใช่จำนวนครั้ง
        · รูปผัง PNG ใบเดียว 8 MB × จอที่เปิด 40 เครื่อง = 320 MB จากรูปใบเดียว
        <br />
        <span style={{ color: 'var(--muted)' }}>
          เคยเกิดจริง 11 ก.ย. 2026: โควต้าเต็ม → Supabase ระงับบริการทั้ง organization →
          <b style={{ color: 'var(--accent2)' }}> ทั้งโรงงาน login ไม่ได้</b>
          {' '}· WebP เล็กกว่า PNG/JPEG ราวครึ่งหนึ่งที่คุณภาพเท่ากัน และ
          <b> ไม่ลดความละเอียด</b> (เคยลดแล้วผังเบลออ่านไม่ออก — ห้ามทำซ้ำ)
        </span>
      </div>

      <ImageSqueezePanel canRun={canRun} />
    </div>
  );
}
