/* ══ <SectionScopeSelect> — ตัวกรอง "ดูส่วนงานไหน" ช่องเดียว บนต้นไม้ผังองค์กร (2026-11-09 · คำสั่ง user) ═══
   ที่มา: *"ปัญหา dropdown ที่ยังเหมือนไม่ดึงจากผังองค์กร ยังเจอหลาย tab ในหลายๆ หน้า"* (ภาพ /manpower-board)
   วัดก่อนแก้: 9 หน้า/14 ช่อง ยังวาด `<select>` ส่วนงานเป็นลิสต์แบนเอง (ManpowerBoard · MorningMeeting · ProductionPlan ·
   Dashboard · TvBoard · WorkforceInsight ×4 · DisplayRotation · Checkin(export) · AddUser) ทั้งที่ UI §5.3 ข้อ 9 สั่งไว้แล้วว่า
   **ทุกช่องขอบเขตวาดด้วย `<OrgScopePicker>` ตัวเดียว** — ลิสต์แบนไม่มีฝ่าย/ไอคอน/ย่อหน้า ⇒ คนอ่านว่า "ไม่ได้มาจากผัง"
   · ไฟล์นี้เป็น "ตัวแปลง" สำหรับหน้าที่เก็บ state เป็น **สตริงส่วนงานตัวเดียว** (`''` = ทุกส่วนงาน) —
     คิวรี/ตัวกรองของหน้าไม่ต้องแก้ · ต้นไม้หน้าตาเดียวกับ OBEYA/Report (`<LineScopeSelect>` คือพี่น้องของตัวนี้สำหรับหน้าที่เลือกไลน์ได้)
   · ฝ่าย/แผนก/กลุ่มไลน์/ไลน์ โชว์เป็นหัวสีเทา **ไม่ตัดทิ้ง** (ตัดทิ้ง = ต้นไม้ต่างจากจออื่นอีก) · `pickDept` = แผนกเลือกได้ด้วย
   · ขอบเขตของ user อ่านจาก `UserContext.sections` เอง · `only` = จำกัดส่วนงานเพิ่มจากหน้า (เช่น leader เห็นแค่ส่วนงานตัวเอง)
   · ค่าที่ถืออยู่แต่ไม่อยู่ในตัวเลือก (ส่วนงานถูกเปลี่ยนชื่อ/นอกขอบเขต) OrgScopePicker โชว์เป็นแถว ⚠ ไม่หายเงียบ
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import { useContext, useMemo } from 'react';
import { UserContext } from '../App';
import OrgScopePicker from './OrgScopePicker';
import useOrgScope from '../utils/useOrgScope';
import { PLANT } from '../utils/orgScope';
import { ALL } from '../utils/filterLabels';

import { tr } from '../utils/i18n';
const PICKABLE = ['section'];
const PICKABLE_DEPT = ['section', 'department'];

/**
 * @param lines      ทะเบียนไลน์ที่หน้านี้มี (ให้ต้นไม้มีกลุ่มไลน์/ไลน์เป็นหัวสีเทาเหมือนจออื่น) — ไม่มีก็ได้
 * @param value      ส่วนงานที่เลือกอยู่ ('' = ทุกส่วนงาน) · ค่า = รหัส/ชื่อส่วนงานตามผัง (`orgKey`)
 * @param dept       แผนก (ชื่อ org department) ที่เลือกอยู่ — ใช้คู่กับ `pickDept`
 * @param onChange   (section, { kind: 'all'|'section'|'department', unit }) — เลือกแผนก ⇒ section = ส่วนงานแม่ของแผนกนั้น · unit = ชื่อแผนก
 * @param only       จำกัดส่วนงานที่เลือกได้เพิ่มจากขอบเขต user (array ชื่อ) — ว่าง = ตามขอบเขต user
 * @param index      ดัชนีผัง (`useOrgScope(lines).index`) จากหน้าแม่ ถ้าโหลดไว้แล้ว — ไม่ส่ง = โหลดเอง
 * @param allLabel   ป้ายตัวเลือก "ทุกส่วนงาน" (default `ALL.section`)
 */
export default function SectionScopeSelect({
  lines = [], value = '', dept = '', pickDept = false, onChange, only = null, index: givenIndex = null, failed: givenFailed = '',
  allLabel = ALL.section, disabled, id, style, width = 240, title,
}) {
  const ctx = useContext(UserContext) || {};
  const scopeSecs = ctx.sections || [];
  const { index: ownIndex, failed: ownFailed } = useOrgScope(givenIndex ? [] : lines);
  const index = givenIndex || ownIndex;
  const failed = givenIndex ? givenFailed : ownFailed;
  // `only` แคบกว่าขอบเขต user ได้อย่างเดียว (leader = ส่วนงานตัวเอง) — ว่างทั้งคู่ = ทั้งโรงงาน
  const sections = useMemo(() => {
    if (only && only.length) return scopeSecs.length ? only.filter(s => scopeSecs.some(x => String(x).trim().toLowerCase() === String(s).trim().toLowerCase())) : only;
    return scopeSecs;
  }, [only, scopeSecs]);

  const cur = useMemo(() => {
    if (pickDept && dept) return { kind: 'department', value: dept };
    return value ? { kind: 'section', value } : PLANT;
  }, [value, dept, pickDept]);

  const emit = (sc) => {
    if (!sc || !sc.kind || sc.kind === 'plant') { onChange?.('', { kind: 'all', unit: '' }); return; }
    if (sc.kind === 'department') {
      const sec = index?.sectionOf?.('department', sc.value) || '';
      onChange?.(sec, { kind: 'department', unit: sc.value });
      return;
    }
    onChange?.(sc.value, { kind: sc.kind, unit: '' });
  };

  return (
    <OrgScopePicker index={index} value={cur} onChange={emit} scopeSet={null} sections={sections} failed={failed}
      costCenter={false} pickable={pickDept ? PICKABLE_DEPT : PICKABLE} plantLabel={allLabel}
      disabled={disabled} id={id} style={style} width={width}
      title={title || (pickDept ? tr('ขอบเขต: ส่วนงาน / แผนก (หัวสีเทา = ระดับที่หน้านี้ไม่ได้กรอง)') : tr('ขอบเขต: ส่วนงาน (หัวสีเทา = ระดับที่หน้านี้ไม่ได้กรอง)'))} />
  );
}
