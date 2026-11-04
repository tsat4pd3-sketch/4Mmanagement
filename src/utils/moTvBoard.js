/* ══ 📺 บอร์ดใบแจ้งซ่อม MO บนจอ TV ห้องช่าง — กฎ pure (2026-11-03 · ประชุม 02/11 ข้อ B6) ══════════
   *"จอ TV ทีม MTN วนหน้า MO อัตโนมัติ — รอรับงาน / กำลังซ่อม / รอตรวจ"*

   ผู้ใช้: `components/MoTvBoard.jsx` (วาด) ← `/tv?dept=mo&mo=<กอง>&team=<ทีม>` (TvBoard)
   ตั้งรอบวนที่ `/display-rotation` (ทะเบียนพารามิเตอร์ `/tv` ใน utils/displayRotation.js)

   🔴 กฎที่ไฟล์นี้ยึด
   1. **"ใบนี้รออะไร" ถาม `moWaitMeta()` ที่เดียว** — แตกด้วย `stage` ไม่ใช่เลขขั้น (เลขขั้นคนละความหมาย
      2 ฟอร์ม · ด่านอนุมัติก่อนเริ่มงานไม่มีเลขขั้น) · "ค้างมานานเท่าไหร่" = `stageSinceOf()` (mtnStale.js)
   2. **กอง (group) = การรวม stage ที่คนหน้างานพูดถึงเป็นเรื่องเดียว** — stage ที่ไม่อยู่ในกองไหน
      (ขั้นใหม่ในอนาคต · ตีกลับ · ส่งซ่อมภายนอก) **ตกกอง `other` ห้ามหาย** (ตะกร้ารับท้ายลิสต์)
   3. **ค่า `mo=` ที่ไม่รู้จัก = ไม่กรอง + ธง `badGroup`** ให้จอเขียนบอก (ห้ามทำให้จอว่าง — ลิงก์เก่า/พิมพ์ผิด)
   4. **กรองแล้วต้องบอกว่าซ่อนกี่ใบ** (นอกขอบเขตบัญชีจอ / ทีมอื่น) — "ไม่มีใบค้าง" ทั้งที่มีแต่ไม่ใช่ของเรา = จอโกหก
   5. **รับ `now` เป็นพารามิเตอร์** (เทสรอบนาฬิกา +400 วัน) · ไม่รู้เวลาเข้าขั้น = `ageMin:null` ห้าม 0
   ════════════════════════════════════════════════════════════════════════════════════════ */
import { isMoOpen, moWaitMeta, MO_DONE_STATUSES, MO_STATUS_LABEL } from './mtnStepPerm.js';
import { stageSinceOf, staleTone, STALE_SINCE_COLS } from './mtnStale.js';
import { daysOpen } from './mtnDuplicate.js';

/** กองบนจอ — ลำดับ = ลำดับงานจริง · `stages` = stage จาก `moWaitMeta()` */
export const MO_TV_GROUPS = Object.freeze([
  { key: 'approve', icon: '🔒', label: 'รอผู้จัดการอนุมัติ (ก่อนเริ่มงาน)', stages: ['approve_first'] },
  { key: 'accept', icon: '📣', label: 'รอช่างรับงาน', stages: ['assign'] },
  { key: 'repair', icon: '🛠', label: 'กำลังซ่อม', stages: ['service'] },
  { key: 'check', icon: '☑️', label: 'รอตรวจรับงาน / ตรวจคุณภาพ', stages: ['accept_work', 'qa'] },
  { key: 'close', icon: '✅', label: 'รอรับมอบ / อนุมัติปิดใบ', stages: ['handover', 'mtn_head', 'mtn_approve', 'cost_mgr_close', 'close'] },
  // ตะกร้ารับท้าย — ตีกลับ · ส่งซ่อมภายนอก · stage ที่ยังไม่รู้จัก (กฎข้อ 2)
  { key: 'other', icon: '📤', label: 'นอกลำดับขั้น (ตีกลับ / ส่งซ่อมภายนอก)', stages: [] },
]);
const STAGE_TO_GROUP = Object.fromEntries(MO_TV_GROUPS.flatMap(g => g.stages.map(s => [s, g.key])));
export const MO_TV_GROUP_KEYS = MO_TV_GROUPS.map(g => g.key);
export const moTvGroupMeta = (key) => MO_TV_GROUPS.find(g => g.key === key) || null;

/** คอลัมน์ที่บอร์ดต้อง select — ขาดตัวไหน = `moWaitMeta`/`stageSinceOf` ตอบ "ไม่รู้" แล้วใบตกกองผิด */
export const MO_TV_COLS = [...new Set([
  'id', 'mo_no', 'status', 'current_step', 'mtn_dept', 'item_type', 'line_name', 'machine_no',
  'problem_characteristic', 'problem_group', 'report_at', 'reported_by_name', 'reporter_prod',
  'assigned_to', 'assigned_techs',
  // ด่านอนุมัติก่อนเริ่มงาน (`isApprovalBlocked`) · ขั้น QA (`isWaitingQa`) · ขั้นปิดใบ MTN (`mtnCloseStage`)
  'purpose', 'dept_manager_at', 'plant_manager_at', 'quality_related', 'qa_skipped_at', 'mtn_head_at', 'approve_at',
  ...STALE_SINCE_COLS,
])].join(',');

/** ตัวกรองฝั่ง server — ใบที่ยังเปิดอยู่ (ชุดสถานะจบมาจาก mtnStepPerm ที่เดียว) */
export const MO_TV_DONE_FILTER = `(${MO_DONE_STATUSES.join(',')})`;

/** กองของใบ */
export function moTvGroupOf(order) {
  const { stage } = moWaitMeta(order);
  return (stage && STAGE_TO_GROUP[stage]) || 'other';
}

/** "ค้างมานาน" แบบสั้น — นาทีน้อยกว่า 1 ชม. = น. · น้อยกว่า 1 วัน = ชม. · นอกนั้น = วัน · ไม่รู้ = '–' */
export function fmtWait(min) {
  if (min == null || !Number.isFinite(min)) return '–';
  if (min < 60) return `${Math.max(0, Math.floor(min))} น.`;
  if (min < 1440) return `${Math.floor(min / 60)} ชม.`;
  return `${Math.floor(min / 1440)} วัน`;
}

/**
 * @param {Array} orders แถว mtn_orders (select ด้วย MO_TV_COLS)
 * @param {object} o
 *   · group  คีย์กอง ('' / 'all' = ทุกกอง)
 *   · team   คีย์ทีมช่าง ('' / 'all' = ทุกทีม)
 *   · teamOf (order) => คีย์ทีม (ส่ง teamKeyOf จากหน้า — ไฟล์นี้ไม่รู้จักทะเบียนทีม)
 *   · inScope (lineName) => boolean — ขอบเขตบัญชีจอ
 *   · now    ms
 * @returns {{ rows, counts, total, badGroup, hiddenScope, hiddenTeam, unknownAge, approxAge }}
 *   counts = จำนวนต่อกอง (หลังกรองขอบเขต+ทีม · ก่อนกรองกอง) ⇒ จอเขียนภาพรวมทุกกองได้
 */
export function buildMoTvBoard(orders, {
  group = '', team = '', teamOf = (o) => String(o?.mtn_dept || '').trim().toLowerCase(),
  inScope = () => true, now = Date.now(),
} = {}) {
  const g = String(group || '').trim();
  const wantGroup = g && g !== 'all' ? g : '';
  const badGroup = !!wantGroup && !MO_TV_GROUP_KEYS.includes(wantGroup);
  const wantTeam = team && team !== 'all' ? String(team).trim().toLowerCase() : '';

  const counts = Object.fromEntries(MO_TV_GROUP_KEYS.map(k => [k, 0]));
  let hiddenScope = 0, hiddenTeam = 0, unknownAge = 0, approxAge = 0;
  const rows = [];
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || !isMoOpen(o)) continue;
    if (!inScope(o.line_name)) { hiddenScope += 1; continue; }
    if (wantTeam && teamOf(o) !== wantTeam) { hiddenTeam += 1; continue; }
    const grp = moTvGroupOf(o);
    counts[grp] += 1;
    if (wantGroup && !badGroup && grp !== wantGroup) continue;
    const { meta } = moWaitMeta(o);
    const since = stageSinceOf(o);
    const t = since.iso ? new Date(since.iso).getTime() : NaN;
    const ageMin = Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60000)) : null;
    if (ageMin == null) unknownAge += 1;
    else if (!since.exact) approxAge += 1;
    rows.push({
      o, group: grp, ageMin, exact: since.exact,
      tone: staleTone(daysOpen(since.iso, now)),
      waitTitle: meta?.title || MO_STATUS_LABEL[String(o.status || '').trim()] || 'ตัดสินไม่ได้',
      waitIcon: meta?.icon || '•',
      waitWho: meta?.whoShort || '',
    });
  }
  // ค้างนานสุดขึ้นก่อน · ไม่รู้อายุไว้ท้าย (ไม่ตัดทิ้ง)
  rows.sort((a, b) => (a.ageMin == null) - (b.ageMin == null) || (b.ageMin ?? 0) - (a.ageMin ?? 0)
    || String(a.o.mo_no || '').localeCompare(String(b.o.mo_no || '')));
  return { rows, counts, total: Object.values(counts).reduce((s, n) => s + n, 0), badGroup, hiddenScope, hiddenTeam, unknownAge, approxAge };
}
