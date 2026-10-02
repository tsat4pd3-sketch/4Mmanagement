/* ══ 🧪 จองเครื่อง "ทดลองงานใหม่" (new model trial) — ฟอร์มของทีมวางแผน ═══════════════════
   (2026-10-01 · หน้างานแจ้ง "มีงาน new model มาขอ trial เครื่อง จะลงยังไง")

   คำสั่ง user: *"ปกติ PE จะแจ้ง PLANNER เพื่อขอบุคกิ้งเครื่อง และวางแผนจะจัดการวางแผนให้"*
   ⇒ **คนกรอกคือวางแผน** (PE แจ้งมาทางไลน์/ปากเปล่าตามเดิม) — ไม่ทำคิวอนุมัติข้ามฝ่าย
     ของที่ขาดจริงคือ "เครื่องถูกจองไปแล้ว แต่แผนในระบบไม่รู้" ⇒ ไทม์ไลน์โกหกว่าไลน์ว่าง

   🔴 กติกาที่ห้ามละเมิด:
     · **เวลาที่ขอ (est_min) คือช่องบังคับ ไม่ใช่ qty × CT** — พาร์ทใหม่ไม่มี cycle time แน่ๆ
       และถ้าปล่อยให้ไม่มีเวลา ไทม์ไลน์จะตีเป็น "คำนวณไม่ได้" แล้ว**ทุกใบหลังจากนั้นเชื่อไม่ได้**
     · 🔴 **ห้ามสร้างพาร์ทใหม่ลง `dr_products`** — SAP ยังไม่ออกเลข MAT และพาร์ทอาจไม่เกิดจริง
       ⇒ ทะเบียนสินค้าจริงจะเปื้อน แล้วทุกจอที่นับพาร์ท/BOM/สต๊อกเพี้ยนตาม
       Part No. ลูกค้าเก็บไว้บนใบ (`trial_part_no`) ไปก่อน · พอ SAP ออกค่อยผูกทีหลัง
     · ช่อง "ลูกค้า"/"ผู้ขอ" ต้องผ่าน **picker กลาง** (UI-CONVENTIONS §5.1.2) ห้าม `<input>` เปล่า
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { useState } from 'react';
import CustomerSelect from './CustomerSelect';
import PersonSelect from './PersonSelect';
import MachineSelect from './MachineSelect';
import { toast } from './Toast';

/* เหตุผลที่ขอเครื่อง — ชุดตั้งต้นจากสายงาน APQP/NPI ที่โรงงานใช้จริง (ดู npi_tooling_step_templates)
   🔴 มี "อื่นๆ" ให้พิมพ์เองเสมอ — ทีมที่ไม่มีเหตุผลในลิสต์ต้องไม่ถูกบังคับให้เลือกผิด */
const REASONS = ['T0 tryout', 'T1 tryout / แก้ไข', 'Run@Rate', 'ECI / เปลี่ยนแบบ', '4M change', 'ทดลองวัสดุใหม่'];

const label = { fontSize: 11.5, color: 'var(--muted)', display: 'block', marginBottom: 3 };
const row = { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px,100%), 1fr))' };

export default function TrialBookingModal({ lineName, dies = [], onClose, onAdd }) {
  const [f, setF] = useState({
    part_no: '', part_name: '', customer: '', reason: REASONS[1], reason_free: '',
    requested_by: '', machine_no: '', die_no: '', qty: 50, hours: 4, mins: 0, note: '',
  });
  const set = (k) => (v) => setF(o => ({ ...o, [k]: v }));
  const estMin = (Number(f.hours) || 0) * 60 + (Number(f.mins) || 0);
  const reason = f.reason === 'อื่นๆ' ? f.reason_free.trim() : f.reason;

  const submit = () => {
    if (!f.part_no.trim() && !f.part_name.trim()) { toast.error('กรอก Part No. หรือชื่องานอย่างน้อย 1 ช่อง'); return; }
    /* 🔴 ไม่มีเวลาที่ขอ = วางบนไทม์ไลน์ไม่ได้ แล้วทั้งคิวหลังจากนั้นจะเชื่อไม่ได้ ⇒ บล็อกตรงนี้ที่เดียว
       (ต่างจาก "เกินกำลัง" ที่เป็นแค่คำเตือน — อันนั้นคนตั้งใจอัดงานได้) */
    if (estMin <= 0) { toast.error('ต้องระบุเวลาที่ขอใช้เครื่อง — ไม่งั้นวางลงไทม์ไลน์ไม่ได้'); return; }
    onAdd({
      trial_part_no: f.part_no.trim() || null,
      trial_part_name: f.part_name.trim() || null,
      trial_customer: f.customer.trim() || null,
      trial_reason: reason || null,
      requested_by: f.requested_by.trim() || null,
      machine_no: f.machine_no || null,
      die_no: f.die_no || null,
      qty_plan: Math.max(1, Number(f.qty) || 1),
      est_min: estMin,
      note: f.note.trim() || null,
    });
    onClose?.();
  };

  return (
    /* 🔴 ไม่ปิดจาก backdrop — ห้ามใส่ onClick={onClose} ที่ชั้นนี้ (UI-CONVENTIONS §5)
       เผลอแตะพื้นหลังแล้วที่กรอกไว้ทั้งฟอร์มหายหมด · ปิดได้จากปุ่ม ✕ / ยกเลิก เท่านั้น
       ⚠️ ใช้ className="overlay" + "modal" ของกลาง ห้ามวาง position:fixed / สีพื้นเอง
          (วางเองแล้วหน้าตาไม่เหมือน modal ตัวอื่นในระบบ — ความทึบพื้นหลัง ขอบ ระยะใน ต่างกันหมด) */
    <div className="overlay">
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ width: 'min(680px, 96vw)', maxHeight: '92vh', overflowY: 'auto', display: 'grid', gap: 12 }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>🧪 จองเครื่องทดลองงานใหม่</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
              {lineName} · งานนี้จะไปกินเวลาบนไทม์ไลน์เหมือนงานผลิตจริง เพื่อให้กะอื่นเห็นว่าเครื่องถูกจอง
            </div>
          </div>
          {/* ปิดได้จาก ✕ / ยกเลิก เท่านั้น (ชั้น backdrop ไม่รับคลิก — ดูคอมเมนต์ด้านบน) */}
          <button type="button" onClick={onClose} aria-label="ปิด" title="ปิด"
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18,
              cursor: 'pointer', lineHeight: 1, padding: 2, flexShrink: 0 }}>✕</button>
        </div>

        <div style={row}>
          <div>
            <label style={label}>Part No. ของลูกค้า</label>
            <input value={f.part_no} onChange={e => set('part_no')(e.target.value)}
              placeholder="เช่น MB3B-16E060-CH" style={{ width: '100%', fontFamily: 'monospace' }} />
          </div>
          <div>
            <label style={label}>ชื่องาน</label>
            <input value={f.part_name} onChange={e => set('part_name')(e.target.value)}
              placeholder="เช่น BRKT RR NEW MODEL" style={{ width: '100%' }} />
          </div>
        </div>
        {/* 🔴 ความซื่อสัตย์: บอกตรงๆ ว่าทำไมไม่ให้เลือกจากทะเบียนสินค้า */}
        <div style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--bg2)', borderRadius: 6, padding: '6px 9px' }}>
          ℹ️ งานใหม่ยังไม่มีเลข MAT (SAP ยังไม่ออก) — ระบบ<b>ไม่สร้างพาร์ทลงทะเบียนสินค้าให้</b>
          เพราะพาร์ทอาจยังไม่เกิดจริง · เก็บ Part No. ไว้บนใบนี้ก่อน พอเลข MAT ออกค่อยผูกเข้าระบบทีหลัง
        </div>

        <div style={row}>
          <div>
            <label style={label}>ลูกค้า</label>
            <CustomerSelect value={f.customer} onChange={set('customer')} inputStyle={{ width: '100%' }} />
          </div>
          <div>
            <label style={label}>ผู้ขอ (PE / ผู้ประสาน)</label>
            <PersonSelect value={f.requested_by} onChange={set('requested_by')} inputStyle={{ width: '100%' }} />
          </div>
        </div>

        <div style={row}>
          <div>
            <label style={label}>เหตุผลที่ขอ</label>
            <select value={f.reason} onChange={e => set('reason')(e.target.value)} style={{ width: '100%' }}>
              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              <option value="อื่นๆ">อื่นๆ (พิมพ์เอง)</option>
            </select>
            {f.reason === 'อื่นๆ' && (
              <input value={f.reason_free} onChange={e => set('reason_free')(e.target.value)}
                placeholder="ระบุเหตุผล" style={{ width: '100%', marginTop: 5 }} />
            )}
          </div>
          <div>
            <label style={label}>เครื่องที่ขอ</label>
            <MachineSelect value={f.machine_no} lines={[lineName]} onChange={set('machine_no')} inputStyle={{ width: '100%' }} />
          </div>
          <div>
            <label style={label}>แม่พิมพ์ / จิ๊ก</label>
            <select value={f.die_no} onChange={e => set('die_no')(e.target.value)} style={{ width: '100%' }}>
              <option value="">— ไม่ระบุ —</option>
              {dies.map(d => <option key={d.id} value={d.set_code}>{d.set_code}{d.part_name ? ` · ${d.part_name}` : ''}</option>)}
            </select>
          </div>
        </div>

        <div style={row}>
          <div>
            {/* 🔴 ช่องนี้แทน qty × CT — พาร์ทใหม่ไม่มี CT ให้คำนวณ (ดูหัวไฟล์) */}
            <label style={label}>⏱️ ขอใช้เครื่อง <b style={{ color: 'var(--accent)' }}>(บังคับ)</b></label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="number" min="0" max="48" value={f.hours} onChange={e => set('hours')(e.target.value)}
                style={{ width: 70, textAlign: 'right' }} /><span style={{ fontSize: 12 }}>ชม.</span>
              <input type="number" min="0" max="59" step="5" value={f.mins} onChange={e => set('mins')(e.target.value)}
                style={{ width: 70, textAlign: 'right' }} /><span style={{ fontSize: 12 }}>นาที</span>
            </div>
          </div>
          <div>
            <label style={label}>ทดลองกี่ชิ้น</label>
            <input type="number" min="1" value={f.qty} onChange={e => set('qty')(e.target.value)}
              style={{ width: '100%', textAlign: 'right' }} />
          </div>
        </div>

        <div>
          <label style={label}>หมายเหตุ</label>
          <textarea value={f.note} onChange={e => set('note')(e.target.value)} rows={2}
            placeholder="เช่น ต้องมี QA ยืนดูด้วย / ใช้เหล็กล็อตพิเศษ" style={{ width: '100%' }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: estMin > 0 ? 'var(--text2)' : '#f59e0b', marginRight: 'auto' }}>
            {estMin > 0
              ? `จะจองเวลาเครื่อง ${Math.floor(estMin / 60)}:${String(estMin % 60).padStart(2, '0')} ชม. ต่อท้ายคิว`
              : '⚠️ ยังไม่ได้ระบุเวลา — วางลงไทม์ไลน์ไม่ได้'}
          </span>
          <button onClick={onClose}>ยกเลิก</button>
          <button onClick={submit} style={{ background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 800 }}>
            + เข้าแผน
          </button>
        </div>
      </div>
    </div>
  );
}
