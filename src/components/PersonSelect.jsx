/* ══════════════════════════════════════════════════════════════════════════
   <PersonSelect> — ช่อง "เลือกคน" ตัวกลางของทั้งระบบ  (2026-09-07 · single-source audit)

   ที่มา: audit ทุกหน้าเจอช่องชื่อคนที่พิมพ์เอง >60 จุด (ผู้ตรวจ/ผู้อนุมัติ/ผู้รับผิดชอบ/ผู้แจ้ง/
   ผู้สอน/หัวหน้างาน/ผู้แก้ไข ฯลฯ) ทั้งที่มี profiles + employees ในฐานอยู่แล้ว
   ⚠️ กฎ: ช่องที่รับ "ชื่อคน" ต้องใช้ component นี้ ห้าม <input> เปล่า / datalist เอง
      (UI-CONVENTIONS §5.1.1 — ลิสต์ยาวต้องค้นได้ · ห้ามมี 2 ช่อง "เลือก" + "พิมพ์เอง")

   สิ่งที่รับประกัน:
     1. ค้นได้ทั้งชื่อ / รหัสพนักงาน / ตำแหน่ง / ส่วนงาน / role
     2. **คนที่เกี่ยวข้องขึ้นก่อน ไม่ตัดคนอื่นทิ้ง** (prefer ด้วย lines / lineIds / section / roles)
        — หยิบข้ามทีมมีจริง (หลักเดียวกับลิสต์มอบหมายช่างใน /mtn-repair) · ใส่ strict เมื่อต้องจำกัดจริง
     3. ชื่อที่พิมพ์เอง (allowFree — default เปิด เพราะปลายทางส่วนใหญ่เก็บ snapshot ชื่อ และคนนอก
        ระบบ/ลูกค้ามีจริง) ติดป้าย "ไม่ได้อยู่ในทะเบียน" ไม่ปล่อยเงียบ
     4. คืนทั้ง id (profile uid / employee id) และชื่อ — หน้าเลือกเก็บได้ทั้ง FK และ snapshot

   value = ชื่อที่เก็บอยู่ (text) · onChange({ name, id, uid, employee_id, employee_code,
   signature_url, section, position, role, kind: 'profile'|'employee'|'free', opt })
   ══════════════════════════════════════════════════════════════════════════ */
import { useMemo } from 'react';
import SearchSelect from './SearchSelect';
import usePeople from '../utils/usePeople';
import { positionLabel } from '../utils/positions';
import { roleLabel } from '../utils/roleMeta';
import { personOptions, sameName, appendHistoryOptions } from '../utils/pickerOptions';

export { personOptions };

export default function PersonSelect({
  value = '', onChange, source = 'profiles',
  lines, lineIds, section, roles, strict = false,
  allowFree = true, placeholder = 'ค้นชื่อ / รหัสพนักงาน…', freeHint = '', emptyText,
  history = [],          // ชื่อที่เคยบันทึกในคอลัมน์ปลายทาง (useColumnHistory) — คนนอกทะเบียนที่เคยกรอกยังเลือกซ้ำได้ (กลุ่ม 📜)
  disabled, inputStyle, style, wrapRows = false, maxRows = 60,
}) {
  const { profiles, employees, failed } = usePeople({ profiles: source !== 'employees', employees: source !== 'profiles' });
  const options = useMemo(() => {
    const base = personOptions({ profiles, employees, source, lines, lineIds, section, roles, strict, posLabel: positionLabel, roleLabel });
    return appendHistoryOptions(base, { history, current: '', keyOf: (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase(), make: () => ({ kind: 'free', uid: null, employee_id: null, employee_code: null, signature_url: null, section: null, position: null, role: null }) });
  }, [profiles, employees, source, lines, lineIds, section, roles, strict, history]);
  // ค่าที่เก็บอยู่คือ "ชื่อ" → หา option ที่ชื่อตรงกัน (ชื่อเดิมที่พิมพ์มาก่อนก็ยังโชว์ได้ผ่าน text)
  const sel = useMemo(() => options.find(o => sameName(o.label, value)) || null, [options, value]);
  const emit = ({ id, text, opt }) => {
    if (opt) onChange?.({ name: opt.label, known: !opt.history, id: opt.uid || opt.employee_id || null, uid: opt.uid || null, employee_id: opt.employee_id || null, employee_code: opt.employee_code || null, signature_url: opt.signature_url || null, section: opt.section, position: opt.position, role: opt.role, kind: opt.kind, opt });
    else onChange?.({ name: text, known: false, id: null, uid: null, employee_id: null, employee_code: null, signature_url: null, section: null, position: null, role: null, kind: 'free', opt: null });
    void id;
  };
  return (
    <SearchSelect
      value={sel ? sel.id : ''} text={value || ''} options={options} onChange={emit}
      allowFree={allowFree} placeholder={placeholder} freeHint={freeHint}
      emptyText={emptyText || (failed ? 'โหลดทะเบียนคนไม่สำเร็จ' : 'ไม่พบชื่อที่ค้นหา')}
      disabled={disabled} inputStyle={inputStyle} style={style} wrapRows={wrapRows} maxRows={maxRows}
    />
  );
}
