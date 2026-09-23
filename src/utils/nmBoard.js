/* ══ 🧭 New Model Board (IEC) — กฎ/สูตรกลาง (pure ทั้งไฟล์ มีเทส) ═══════════════════════
   ถอดจากบอร์ด OBEYA จริงของ IEC (MODEL 737D MLM) — ดู docs/IEC-NEW-MODEL-OBEYA-DESIGN.md

   🔴 กฎที่ห้ามละเมิด (ตกผลึกจากบอร์ดจริง):
   1. EVA มี 4 ชั้น: แถว → แผง → โปรเจค (3 แกน) → ลูกค้า · ห้ามยุบเหลือดวงเดียว
   2. **"ยังไม่ถึงด่าน" ≠ "ไม่ผ่าน"** — บนบอร์ดจริงบล็อก 1A ของ CPM/ECI/PPC ว่างทั้งบล็อก
      เพราะยังไม่ถึงเวลา ถ้าตีเป็น NG จอจะแดงทั้งกระดานตั้งแต่วันแรก ⇒ คืน 'none' (เทา)
   3. ไฟต้องพก "เหตุผล + ตัวเลขจริง" มาด้วยเสมอ ห้ามมีแต่สี (แบบกล่อง "Result NG < Level 2")
   4. ความสดของข้อมูลคือส่วนหนึ่งของความจริง — แผงที่ไม่มีใครแตะนาน ต้องเตือน
      (บอร์ดกระดาษมีแถบ UPDATE STATUS รายสัปดาห์ให้ติ๊ก)
   ═════════════════════════════════════════════════════════════════════════════════════ */

/** สถานะประเมิน — ค่าเดียวที่ใช้ทั้งระบบ */
export const EVA = {
  G:    { key: 'G',    label: 'ตามแผน',      short: 'G', color: '#22c55e' },
  Y:    { key: 'Y',    label: 'เฝ้าระวัง',    short: 'Y', color: '#eab308' },
  R:    { key: 'R',    label: 'ช้า/ไม่ผ่าน',  short: 'R', color: '#ef4444' },
  none: { key: 'none', label: 'ยังไม่ถึง/ไม่มีข้อมูล', short: '–', color: '#64748b' },
};
export const evaMeta = (k) => EVA[k] || EVA.none;

/** ลำดับความแย่ — ใช้หาตัวที่แย่สุดในกลุ่ม (none ไม่นับว่าแย่ ดูกฎข้อ 2) */
const RANK = { R: 3, Y: 2, G: 1, none: 0 };

/**
 * รวมไฟหลายดวงเป็นดวงเดียว = "แย่สุดชนะ"
 * ⚠️ ถ้าไม่มีดวงไหนถูกประเมินเลย คืน 'none' ไม่ใช่ 'G' — ห้ามเดาว่าเขียว
 */
export function rollupEva(list) {
  const vals = (list || []).map(v => (typeof v === 'string' ? v : v?.eva)).filter(Boolean);
  if (!vals.length) return 'none';
  let worst = 'none';
  for (const v of vals) if ((RANK[v] || 0) > (RANK[worst] || 0)) worst = v;
  return worst;
}

/** นับจำนวนแต่ละสี — ใช้โชว์ "2 จาก 4 พาร์ทแดง" ข้างไฟ (กฎข้อ 3) */
export function evaCounts(list) {
  const out = { G: 0, Y: 0, R: 0, none: 0, total: 0 };
  for (const it of list || []) {
    const v = (typeof it === 'string' ? it : it?.eva) || 'none';
    if (out[v] === undefined) continue;
    out[v]++; out.total++;
  }
  return out;
}

/** ข้อความสั้นข้างไฟ เช่น "🔴 2 · 🟡 1 · 🟢 5" (ข้ามสีที่เป็น 0) */
export function countsLabel(c) {
  const parts = [];
  if (c.R) parts.push(`🔴 ${c.R}`);
  if (c.Y) parts.push(`🟡 ${c.Y}`);
  if (c.G) parts.push(`🟢 ${c.G}`);
  if (c.none) parts.push(`⚪ ${c.none}`);
  return parts.join(' · ');
}

/* ── ความสด (แทนแถบ UPDATE STATUS บนกระดาษ) ─────────────────────────────── */
export const STALE_WARN_DAYS = 14;   // ค้าง 2 สัปดาห์ = เตือน
export const STALE_BAD_DAYS  = 28;   // ค้าง 4 สัปดาห์ = ถือว่าเชื่อไม่ได้

/** อายุข้อมูลเป็นวัน — รับ now เข้ามาได้เสมอ (กฎเทสระเบิดเวลา ใน CLAUDE.md) */
export function daysSince(iso, now = new Date()) {
  if (!iso) return null;
  const t = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(t.getTime())) return null;
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d0 - t) / 86400000);
}

/** 'fresh' | 'warn' | 'bad' | 'unknown' */
export function freshness(iso, now = new Date()) {
  const d = daysSince(iso, now);
  if (d === null) return 'unknown';
  if (d >= STALE_BAD_DAYS) return 'bad';
  if (d >= STALE_WARN_DAYS) return 'warn';
  return 'fresh';
}

export function freshLabel(iso, now = new Date()) {
  const d = daysSince(iso, now);
  if (d === null) return 'ไม่เคยอัปเดต';
  if (d <= 0) return 'อัปเดตวันนี้';
  if (d === 1) return 'อัปเดตเมื่อวาน';
  return `อัปเดต ${d} วันก่อน`;
}

/* ── EVA ของโปรเจค = 3 แกน (หัวบอร์ดจริงเขียน Result KPI / Process KPI / Milestone) ── */
export const PROJECT_AXES = [
  { key: 'result',    label: 'Result KPI',  hint: 'ผลงานที่ส่งมอบได้จริง (คุณภาพ/ชิ้นงาน/เอกสารที่ลูกค้ารับ)' },
  { key: 'process',   label: 'Process KPI', hint: 'กระบวนการเดินตามแผนไหม (งานย่อย/เอกสารภายใน)' },
  { key: 'milestone', label: 'Milestone',   hint: 'ทันด่านของลูกค้าไหม (CV / 1A / MPT / SOP)' },
];

/** ไฟรวมของโปรเจค = แย่สุดใน 3 แกน (ใช้ตอนย่อลงการ์ดลูกค้า) */
export const projectEva = (p) => rollupEva(PROJECT_AXES.map(a => p?.eva?.[a.key]));

/** ไฟรวมของลูกค้า = แย่สุดของทุกโปรเจค · ไม่มีโปรเจค = none (ห้ามโชว์เขียว) */
export const customerEva = (projects) => rollupEva((projects || []).map(projectEva));

/* ── ชนิดของแผง (บอร์ด 21 แผง ยุบเหลือ 5 รูปทรง) ─────────────────────────── */
export const PANEL_KIND = {
  activity: { icon: '📅', label: 'ใบกิจกรรม',        hint: 'กิจกรรม + ผู้รับผิดชอบ + แผน/จริง + สถานะ' },
  matrix:   { icon: '🔲', label: 'เมทริกซ์พาร์ท×ด่าน', hint: 'พาร์ทเป็นแถว ด่านเป็นคอลัมน์ + จุดประเมิน' },
  issues:   { icon: '🔥', label: 'ทะเบียนปัญหา',      hint: 'ปัญหา · สาเหตุ · มาตรการ · ผู้รับผิดชอบ · กำหนด' },
  doc:      { icon: '📄', label: 'เอกสาร/ฟอร์ม',      hint: 'ฟอร์มมาตรฐาน + ไฟล์แนบ + รูป' },
  network:  { icon: '🕸️', label: 'ผังโหนด',           hint: 'ผัง tier ผู้ผลิต/ผู้ส่งมอบ' },
};

/** แผงที่ต้องรีบดู = แดง หรือ ข้อมูลค้างจนเชื่อไม่ได้ */
export function panelsNeedingAttention(panels, now = new Date()) {
  return (panels || [])
    .map(p => ({ ...p, _fresh: freshness(p.updated_at, now) }))
    .filter(p => p.eva === 'R' || p._fresh === 'bad' || (p.eva === 'Y' && p._fresh === 'warn'))
    .sort((a, b) => (RANK[b.eva] || 0) - (RANK[a.eva] || 0));
}

/** งานค้างที่เลยกำหนด — รวมจาก Kadai + มติที่ประชุมของทุกโปรเจค */
export function overdueActions(projects, now = new Date()) {
  const out = [];
  for (const p of projects || []) {
    for (const panel of p.panels || []) {
      if (panel.kind !== 'issues') continue;
      for (const r of panel.rows || []) {
        if (r.status === 'done' || !r.due) continue;
        const late = daysSince(r.due, now);
        if (late !== null && late > 0) out.push({ ...r, late, project: p, panel });
      }
    }
  }
  return out.sort((a, b) => b.late - a.late);
}

/** ตัดเกรดอัตโนมัติจาก "ค่าที่วัดได้ vs เกณฑ์" — ระบบตัดสี คนกดทับได้พร้อมเหตุผล (กฎข้อ 3) */
export function gradeByTarget(actual, target, { higherIsBetter = true, warnRatio = 0.95 } = {}) {
  if (actual === null || actual === undefined || target === null || target === undefined) return 'none';
  const a = Number(actual), t = Number(target);
  if (!Number.isFinite(a) || !Number.isFinite(t) || t === 0) return 'none';
  const ok = higherIsBetter ? a >= t : a <= t;
  if (ok) return 'G';
  const ratio = higherIsBetter ? a / t : t / a;
  return ratio >= warnRatio ? 'Y' : 'R';
}
