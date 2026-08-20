import { roleLabel } from '../utils/roleMeta';

/**
 * 🔒 แถบ "ทำไมปุ่มหาย" — ใช้ทุกหน้าที่ซ่อนปุ่ม/คอลัมน์ตามสิทธิ์
 *
 * ⚠️ ทำไมต้องมี (feedback หน้างาน 2026-08-20 · เคสตารางกะ):
 *   หัวหน้าทีมช่างเปิดหน้าตารางกะได้ ตั้งข้อมูลครบแล้ว แต่ **ไม่มีปุ่ม ⇄ สลับกะ**
 *   เพราะ role ไม่มี action key นั้น — แต่หน้าจอไม่ได้บอกอะไรเลย
 *   คนหน้างานจึงสรุปว่า "ระบบพัง / ทำไม่เสร็จ" แล้วแจ้งกลับมาเป็นบั๊ก
 *   → ซ่อนปุ่มได้ แต่ **ห้ามซ่อนเหตุผล** (กฎ "ห้ามล้มเหลวเงียบ")
 *
 * ต้นเหตุที่เจอซ้ำ = กับดัก seed `enum_range`/รายชื่อ role ตายตัว:
 *   action key ถูก seed ตั้งแต่ก่อน role นั้นเกิด → role ใหม่ไม่มีแถว = fail-closed
 *   (mtn/engineer/planner_store/dept_admin เพิ่มทีหลังทั้งหมด)
 *
 * ใช้:
 *   <ReadOnlyNote show={!canEdit} role={role}
 *     what="แก้ทะเบียนสินค้า" permKey="products:edit" />
 *
 * props:
 *   show     — เงื่อนไข (ปกติ `!can(...)`) · false = ไม่ render อะไรเลย
 *   role     — role ของผู้ใช้ (จาก UserContext) เอาไว้บอกว่าต้องเปิดสิทธิ์ให้ใคร
 *   what     — ข้อความสั้นๆ ว่า "ทำอะไรไม่ได้" (เช่น "แก้ทะเบียนสินค้า")
 *   permKey  — คีย์สิทธิ์ที่ต้องเปิด (เช่น 'products:edit') · ใส่ได้หลายตัวคั่นด้วย ,
 *   hint     — (ไม่บังคับ) คำอธิบายเพิ่มเฉพาะหน้า
 *   compact  — แบบบรรทัดเดียว (ใช้ในโมดัล/พื้นที่แคบ)
 */
export default function ReadOnlyNote({ show = true, role, what, permKey, hint, compact = false, style }) {
  if (!show) return null;
  const keys = String(permKey || '').split(',').map(s => s.trim()).filter(Boolean);
  return (
    <div style={{
      background: 'rgba(245,158,11,0.1)', border: '1px solid #f59e0b', borderRadius: 8,
      padding: compact ? '7px 10px' : '10px 12px', marginBottom: compact ? 10 : 14,
      fontSize: compact ? 12 : 12.5, lineHeight: 1.65, ...style,
    }}>
      🔒 <b>โหมดดูอย่างเดียว{what ? ` — บัญชีนี้ยังไม่มีสิทธิ์${what}` : ''}</b>
      {!compact && <> จึงไม่เห็นปุ่ม/คอลัมน์สำหรับแก้ไข</>}
      {!compact && (
        <div style={{ color: 'var(--text2)', marginTop: 3 }}>
          ให้ admin เปิดสิทธิ์{' '}
          {keys.map((k, i) => (
            <span key={k}>{i > 0 && ' หรือ '}<code>{k}</code></span>
          ))}
          {role && <> ให้ role <b>{roleLabel(role)}</b></>}{' '}
          ที่หน้า <b>จัดการสิทธิ์ (/permissions)</b> → แท็บ <b>สิทธิ์การทำงาน</b>
          {hint && <div style={{ marginTop: 3, opacity: 0.85 }}>{hint}</div>}
        </div>
      )}
    </div>
  );
}
