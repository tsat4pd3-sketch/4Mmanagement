/* ═══════════════════════════════════════════════════════════════════════════
   เลข MO ออกยังไง — pure · **ต้องตรงกับ SQL `public.mtn_assign_mo_no()` เป๊ะ**  2026-10-14

   ⚠️ ไฟล์นี้ **ไม่ได้ออกเลข** — ตัวออกเลขจริงคือ RPC ฝั่ง DB (atomic กันออกชนกัน 2 เครื่อง)
      ไฟล์นี้มีไว้ให้ **จอบอกความจริงได้ว่า "ใบถัดไปจะเป็นเลขอะไร / ตัวนับอยู่ที่คีย์ไหน"**
      กฎเดียวกับ `snapMachineNo` ↔ `public.machine_key()` — **แก้ฝั่งไหน ต้องแก้อีกฝั่งในคอมมิทเดียวกัน**
      (มีด่าน `mo-number-js-sql-parity` ใน regressionGuards)

   ─── รูปแบบเลขต่อทีม (คำสั่ง user 14/10) ────────────────────────────────────────
   | ทีม | เลข | อ่านว่า |
   |---|---|---|
   | MTN | `O-MTN.2026/10-16` | **O = ออกจากระบบ** · ใบที่ 16 ของเดือน ต.ค. 2026 |
   | JIG · DIE · PRODUCTION | `JIG-BM-141026-0014-M8` | ทีม·ประเภท·วันที่·ใบรันสะสมที่ 14·**ใบที่ 8 ของเดือน** |

   🔴 **ทำไมเป็นแบบนี้ (อย่าเปลี่ยนโดยไม่อ่าน):**
   · ทีมที่นับต่อเนื่อง **ไม่ได้ทิ้งของเดิม — ต่อหาง `-M<n>` เข้าไป** (คำสั่ง user ตรงๆ
     *"ไม่ใช่เอาของเดิมออก แต่เพิ่มเข้าไป"*) ⇒ วันที่ + ประเภทงานยังอยู่ในเลข ·
     **ตัวนับเดิมไม่ต้องรีเซ็ต = ไม่มีทางเลขซ้ำใบเก่า** · ใบเก่าแค่ไม่มีหาง ⇒ รู้ทันทีว่าเป็นใบก่อนเปลี่ยน
   · ทีม MTN เติม **`O-` นำหน้า** เพราะทีมยังมีเล่มกระดาษที่เขียนเลขเองอยู่ (`MTN.2026/10-15`)
     ⇒ `O-` แยกให้เห็นว่าใบไหนออกจากระบบ · เป็น**มาตรการชั่วคราวระหว่างทยอยเลิกเล่มมือ**
     (user 14/10: *"จะทยอยผลักดันแทนมนวลให้หมดไป เลขจะได้ไม่มีปัญหา"*)
     ⇒ วันที่เลิกเล่มมือได้แล้ว **ถอด `mark` ออกจากตารางข้างล่าง + แก้ SQL ในคอมมิทเดียวกัน**

   ─── ที่มาของไฟล์นี้ (วัดจริง 14/10) ───────────────────────────────────────────
   จอ "🔢 เลขรัน MO" เคยโกหก **2 ทีมจาก 4** เพราะเดาเองว่าทุกทีมออกเลขแบบเดียวกัน:
     MTN        จอบอก `MTN-BM-141026-0001` · จริง `MTN.2026/10-15`
     PRODUCTION จอบอก รหัส `PRD` · จริง `PRO` (ออกไปแล้ว 708 ใบ)
   ⇒ และช่องกรอก "เลขล่าสุด" ของ MTN เขียนลงคีย์ผิด = **กรอกไปไม่มีผลเลย**
     (คำถามช่าง 13/10 *"จะ Skip เลข MO ต้องกรอกตรงไหน"* — ตอนนั้นยังไม่มีที่ให้กรอก)

   🔴 **ห้ามแก้ `mo_code` ให้ต่างจากที่ออกไปแล้ว** — คีย์ตัวนับผูกกับรหัส ⇒ เปลี่ยนรหัส =
      ตัวนับคนละตัว = **เลขรีสตาร์ทจาก 1** แล้วไปซ้ำใบเก่า (จอมี confirm เตือนแล้ว ห้ามถอด)
   ═══════════════════════════════════════════════════════════════════════════ */
import { bkkDateStr } from './workDate.js';

/* ── ทะเบียนรูปแบบต่อทีม — **จุดเดียวของทั้งระบบ** ─────────────────────────────
   ทีมที่ไม่อยู่ในตาราง = ค่าตั้งต้น (นับต่อเนื่อง + ต่อหางลำดับเดือน)
   🔴 แก้ตารางนี้ = ต้องแก้ SQL `mtn_assign_mo_no` ในคอมมิทเดียวกัน (มีด่านเทียบให้)
   ⚠️ จงใจ **ไม่ทำเป็น dropdown ใน DB** — เปลี่ยนรูปแบบเลขเอกสารเป็นการตัดสินใจของ doc control
      ไม่ใช่ของที่ควรกดพลาดได้จากหน้าจอ (และบางทางทำให้ตัวนับรีสตาร์ท) */
const DEFAULT_FORMAT = { style: 'running', monthTail: true, mark: '' };
export const TEAM_MO_FORMAT = Object.freeze({
  /* `style:'monthly'` = เลขมีลำดับเดือนในตัวอยู่แล้ว จึงไม่ต่อหาง `-M<n>` ซ้ำ */
  maintenance: { style: 'monthly', monthTail: false, mark: 'O-' },
});
export const formatOfTeam = (teamKey) => TEAM_MO_FORMAT[String(teamKey || '').trim()] || DEFAULT_FORMAT;

/** ทีมที่ใช้ "เลขรีเซ็ตรายเดือน" — ด่าน parity เทียบลิสต์นี้กับสาขาใน SQL */
export const MONTHLY_TEAM_KEYS = Object.freeze(
  Object.keys(TEAM_MO_FORMAT).filter(k => TEAM_MO_FORMAT[k].style === 'monthly'));

/** รูปแบบเลขของทีมนี้ — `'monthly'` = `O-MTN.2026/10-16` · `'running'` = `JIG-BM-141026-0014-M8` */
export const moFormatOf = (teamKey) => formatOfTeam(teamKey).style;

/** รหัสทีมที่ใช้จริงในเลข MO — ทะเบียนชนะ · ไม่ตั้งไว้ถอยไป "3 ตัวแรกของ key"
 *  ⚠️ กฎถอยต้องตรงกับ SQL: `upper(substr(regexp_replace(key,'\s','','g'),1,3))` */
export function moCodeOf(team = {}) {
  const set = String(team.mo_code || '').trim().toUpperCase();
  if (set) return set;
  const k = String(team.key || '').replace(/\s/g, '');
  return (k ? k.slice(0, 3) : 'MTN').toUpperCase();
}

/** ส่วนวันของเลข (ตามปฏิทินไทย) — คืน `null` ถ้าอ่านเวลาไม่ออก (ห้ามเดาเป็นวันนี้) */
function bkkParts(at) {
  const iso = bkkDateStr(at);                      // 'YYYY-MM-DD' เวลาไทย (ของกลาง)
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return { ym: `${y}${m}`, period: `${y}/${m}`, ddmmyy: `${d}${m}${y.slice(2)}` };
}

/**
 * คีย์ตัวนับ **หลัก** ของทีมนี้ใน `mtn_mo_seq` (เลขที่โชว์ในช่อง "เลขล่าสุด")
 * · รายเดือน → `'MTN:202610'` (คนละตัวทุกเดือน ⇒ รีเซ็ตเองโดยไม่ต้องมีใครกด)
 * · ต่อเนื่อง → `'JIG'`
 * @param at epoch ms / ISO — **ต้องส่งมา** (เทสรันรอบนาฬิกา +400 วัน · ห้ามอ่าน Date.now() เอง)
 * @returns string | `null` = อ่านเวลาไม่ออก (จอต้องเขียนว่าตัดสินไม่ได้ ห้ามเดา)
 */
export function moSeqKeyOf(team = {}, at) {
  const code = moCodeOf(team);
  if (moFormatOf(team.key) !== 'monthly') return code;
  const p = bkkParts(at);
  return p ? `${code}:${p.ym}` : null;
}

/**
 * คีย์ตัวนับ **ลำดับเดือน** (หาง `-M<n>`) — มีเฉพาะทีมที่ต่อหาง
 * 🔴 ต้องเป็นตัวนับจริงใน DB **ห้ามนับแถวเอา** — นับแถวแล้ว 2 ใบที่สร้างพร้อมกันจะได้เลขเดียวกัน
 *    และใบที่ถูกลบจะทำให้เลขของใบที่เหลือ "ขยับ" ทั้งที่ mo_no เก็บค่าเดิมไว้แล้ว
 * @returns string (`'JIG:M202610'`) | `null` = ทีมนี้ไม่ต่อหาง หรืออ่านเวลาไม่ออก
 */
export function moMonthKeyOf(team = {}, at) {
  if (!formatOfTeam(team.key).monthTail) return null;
  const p = bkkParts(at);
  return p ? `${moCodeOf(team)}:M${p.ym}` : null;
}

/**
 * เลข MO ที่จะได้ถ้าตัวนับอยู่ที่ `seq` (ใบถัดไปให้ส่ง `last_seq + 1`)
 * @param seq       ลำดับหลัก (รันสะสม หรือลำดับเดือนสำหรับทีมแบบ monthly)
 * @param monthSeq  ลำดับของเดือน (เฉพาะทีมที่ต่อหาง) — ไม่รู้ = **ไม่ต่อหาง** ไม่ใช่คืน null
 *                  (ใบยังต้องมีเลขเสมอ · หางเป็นของเสริม)
 * @returns string | `null` = อ่านเวลาไม่ออก **ห้ามคืนสตริงมั่ว** (จอต้องขึ้นว่าตัดสินไม่ได้)
 */
export function moNoOf(team = {}, { seq, monthSeq = null, at, prefix = 'BM' } = {}) {
  const p = bkkParts(at);
  if (!p || !Number.isFinite(Number(seq))) return null;
  const f = formatOfTeam(team.key);
  const code = moCodeOf(team);
  const n = Number(seq);
  if (f.style === 'monthly') return `${f.mark}${code}.${p.period}-${n}`;   // ไม่ pad — ตามฟอร์มกระดาษ
  /* ⚠️ `Number(null) === 0` ⇒ เช็ค `Number.isFinite(Number(x))` เฉยๆ จะได้หาง `-M0`
     (เลขที่โกหกว่า "ใบที่ 0 ของเดือน") — ต้องกันค่าว่างออกก่อนเสมอ */
  const ms = (monthSeq === null || monthSeq === undefined || monthSeq === '') ? NaN : Number(monthSeq);
  const tail = (f.monthTail && Number.isFinite(ms) && ms > 0) ? `-M${ms}` : '';
  return `${f.mark}${code}-${String(prefix || 'BM')}-${p.ddmmyy}-${String(n).padStart(4, '0')}${tail}`;
}

/** คำอธิบายรูปแบบสำหรับโชว์บนจอตั้งค่า (ห้ามพิมพ์รูปแบบซ้ำในหน้า) */
export function moFormatHint(team = {}) {
  const f = formatOfTeam(team.key);
  if (f.style === 'monthly') {
    return { title: 'รีเซ็ตทุกเดือน', detail: `${f.mark ? `${f.mark}` : ''}รหัสทีม.ปี/เดือน-ลำดับเดือน`
      + (f.mark ? ` · ${f.mark.replace(/-$/, '')} = ออกจากระบบ (แยกจากเล่มเขียนมือ)` : '') };
  }
  return { title: 'นับต่อเนื่อง ไม่รีเซ็ต + ลำดับเดือน',
    detail: 'รหัสทีม-ประเภท-วันเดือนปี-เลขรันสะสม-M<ใบที่เท่าไหร่ของเดือน>' };
}
