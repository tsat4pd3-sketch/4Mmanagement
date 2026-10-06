/* ══ 📊 ตัวเลขประจำแผงบนบอร์ด New Model (2026-10-06 · feedback user "design obeya ยังดีกว่า") ══

   ทำไม OBEYA ดูดีกว่า — ไม่ใช่เรื่องสีหรือวัสดุ แต่เป็น **"การ์ดหนึ่งใบตอบกี่คำถาม"**:

   | คำถามที่คนยืนหน้าบอร์ดถาม | แผ่น OBEYA | การ์ด NM เดิม |
   |---|---|---|
   | ตัวเลขเท่าไหร่      | **94.9** ตัวโต | ✗ |
   | เทียบเป้าแล้วเป็นไง | ชิป "หลุดเป้า" + เดลต้า | สีอย่างเดียว |
   | ตัวเลขมาจากไหน      | "ระบบคำนวณ · YTD 78.1%" | ✗ |
   | แนวโน้ม             | กราฟ 12 เดือน | ✗ |
   | กดอะไรต่อ           | "เจาะดู ↗" | ✗ |

   วัดจริงบนบอร์ด 737D MLM: **21 แผงมีข้อมูลนับได้ทั้ง 21 แผง แต่ไม่โชว์ตัวเลขสักใบ**
   (9 ใบมีข้อความอธิบาย · ที่เหลือมีแต่ชื่อกับ "อัปเดต N วันก่อน")
   ⇒ ไฟล์นี้ดึง "ตัวเลขที่มีอยู่แล้วในข้อมูล" ออกมา — **ไม่ได้สร้างตัวเลขใหม่**

   🔴 กฎความซื่อสัตย์ (เหมือน /obeya):
   - **นับไม่ได้ = `null` ห้ามคืน 0** · แถวที่ยังไม่ประเมิน **ห้ามนับเป็น "ผ่าน"**
   - **ประเมินไม่ครบ ต้องบอกว่าประเมินแล้วกี่จากกี่** (`rated` / `total`) ห้ามคิด % จากตัวหารปลอม
   - **ใบเอกสาร (`doc`) ไม่มีความคืบหน้า** — คืนเป็น "จำนวนรายการ" และบอกตรงๆ ว่าเป็นจำนวน
     (เอาจำนวนหัวข้อมาทำเป็น % = ตัวเลขที่ไม่มีความหมาย ซึ่งแย่กว่าไม่มีตัวเลข)
   - 🔴 **สีคืนเป็นคีย์ EVA (`R`/`Y`/`G`/`none`) ไม่ใช่ hex** — บอร์ดนี้มีภาษาสีของตัวเองอยู่แล้ว
     (`EVA` ใน `nmBoard.js`) · ประกาศตารางสีใหม่ = จอเดียวกันมีเหลือง 2 เฉด (มีด่าน
     `status-palette-single-source` จับตอน build — โดนจริงรอบนี้)
   ══════════════════════════════════════════════════════════════════════════════════════════ */

const DONE_STATUS = new Set(['done', 'closed', 'complete', 'completed']);

/** แถวนี้ "ประเมินแล้ว" ไหม — `none`/ว่าง = ยังไม่ประเมิน (คนละเรื่องกับ "ประเมินแล้วตก") */
const rated = (eva) => !!eva && eva !== 'none';

/** วันนี้เลยกำหนดไปแล้วไหม — ไม่มีกำหนด = ไม่เลย (ไม่ใช่ "เลย") */
function isOverdue(due, now) {
  if (!due) return false;
  const d = new Date(`${due}T23:59:59`);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < now.getTime();
}

/** ทุกเซลล์ในเมทริกซ์ (รายพาร์ท × ด่าน) เป็นลิสต์เดียว */
function matrixCells(panel) {
  const out = [];
  for (const r of panel?.rows || []) {
    for (const k of Object.keys(r?.cells || {})) out.push(r.cells[k]);
  }
  return out;
}

/**
 * ตัวเลขประจำแผง 1 ใบ
 * @param {object} panel
 * @param {Date} [now]  ⏱️ ต้องรับเวลาเข้ามา (เทสตรึงค่าได้ · กฎ "เทสระเบิดเวลา" ใน CLAUDE.md)
 * @returns {null | {
 *   kind: 'progress'|'issues'|'count',
 *   value: number, total: number|null, pct: number|null,
 *   rated: number|null, unrated: number|null,
 *   overdue: number|null, label: string, source: string, eva: 'R'|'Y'|'G'|'none'
 * }}  นับไม่ได้ = `null` (จอต้องไม่วาดช่องตัวเลขเลย ห้ามวาดเป็น 0)
 */
export function panelMetric(panel, now = new Date()) {
  if (!panel) return null;
  const kind = panel.kind;

  /* ── ใบกิจกรรม: นับ "ขั้นงานที่ผ่านแล้ว" จาก eva รายแถว ───────────────────────── */
  if (kind === 'activity') {
    const rows = panel.rows || [];
    if (!rows.length) return null;
    const ratedRows = rows.filter(r => rated(r?.eva));
    if (!ratedRows.length) return null;                 // ไม่มีแถวไหนถูกประเมิน = ประเมินไม่ได้
    const ok = ratedRows.filter(r => r.eva === 'G').length;
    const bad = ratedRows.filter(r => r.eva === 'R').length;
    return {
      kind: 'progress',
      value: ok, total: ratedRows.length,
      pct: Math.round((ok / ratedRows.length) * 100),
      rated: ratedRows.length, unrated: rows.length - ratedRows.length,
      overdue: null,
      label: 'ขั้นงานผ่านแล้ว',
      source: `จากใบกิจกรรม ${rows.length} ขั้น`,
      eva: bad ? 'R' : ok === ratedRows.length ? 'G' : 'Y',
    };
  }

  /* ── เมทริกซ์พาร์ท×ด่าน: นับ "ช่องที่ประเมินแล้วและผ่าน" ───────────────────────── */
  if (kind === 'matrix') {
    const cells = matrixCells(panel);
    if (!cells.length) return null;
    const ratedCells = cells.filter(c => rated(c?.eva));
    if (!ratedCells.length) return null;                // ยังไม่ถึงด่าน = ยังประเมินไม่ได้
    const ok = ratedCells.filter(c => c.eva === 'G').length;
    const bad = ratedCells.filter(c => c.eva === 'R').length;
    return {
      kind: 'progress',
      value: ok, total: ratedCells.length,
      pct: Math.round((ok / ratedCells.length) * 100),
      rated: ratedCells.length, unrated: cells.length - ratedCells.length,
      overdue: null,
      label: 'ช่องประเมินผ่าน',
      source: `${panel.rows?.length || 0} พาร์ท × ${panel.milestones?.length || 0} ด่าน`,
      eva: bad ? 'R' : ok === ratedCells.length ? 'G' : 'Y',
    };
  }

  /* ── ทะเบียนปัญหา / มติที่ประชุม: นับ "เรื่องที่ยังเปิดอยู่" + "เลยกำหนด" ───────── */
  if (kind === 'issues') {
    const rows = panel.rows || [];
    if (!rows.length) return null;
    const open = rows.filter(r => !DONE_STATUS.has(String(r?.status || '').toLowerCase()));
    const overdue = open.filter(r => isOverdue(r?.due, now)).length;
    return {
      kind: 'issues',
      value: open.length, total: rows.length, pct: null,
      rated: null, unrated: null,
      overdue,
      label: 'เรื่องยังเปิดอยู่',
      source: `ทะเบียนทั้งหมด ${rows.length} เรื่อง`,
      eva: overdue ? 'R' : open.length ? 'Y' : 'G',
    };
  }

  /* ── ใบเอกสาร / ผังโหนด: เป็น "จำนวนรายการ" ไม่ใช่ความคืบหน้า ────────────────────
     🔴 ห้ามแปลงเป็น % — จำนวนหัวข้อในใบไม่มีตัวหารที่มีความหมาย */
  const n = (panel.fields?.length || 0) + (panel.tree?.length || 0) + (panel.tiers?.length || 0) + (panel.rows?.length || 0);
  if (!n) return null;
  return {
    kind: 'count',
    value: n, total: null, pct: null, rated: null, unrated: null, overdue: null,
    label: panel.tree?.length ? 'บรรทัดในผังพาร์ท' : panel.tiers?.length ? 'ชั้นผู้ส่งมอบ' : 'หัวข้อในใบ',
    source: 'ใบเอกสารบนบอร์ด',
    eva: 'none',
  };
}

/** ข้อความสั้นข้างตัวเลข เช่น "/ 11" หรือ "เลยกำหนด 3" — ไม่มีอะไรเสริม = `''` */
export function metricSuffix(m) {
  if (!m) return '';
  if (m.kind === 'progress') return `/ ${m.total}`;
  if (m.kind === 'issues') return m.total ? `/ ${m.total}` : '';
  return '';
}

/** คำเตือนที่ต้องเขียนบนจอเมื่อข้อมูลไม่ครบ — ไม่มี = `null` (ห้ามเขียนคำเตือนลอยๆ) */
export function metricWarn(m) {
  if (!m) return null;
  if (m.kind === 'issues' && m.overdue) return `เลยกำหนดแล้ว ${m.overdue} เรื่อง`;
  if (m.unrated) return `ยังไม่ประเมินอีก ${m.unrated} รายการ — % คิดจากที่ประเมินแล้วเท่านั้น`;
  return null;
}
