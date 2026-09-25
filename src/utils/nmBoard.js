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

/* ── 📺 โหมดจอ TV (70") — ต้องเห็นทั้งบอร์ดในจอเดียว ห้ามเลื่อน ────────────────
   บอร์ดกระดาษคือผนังแผ่นเดียวที่มองเห็นหมดในพริบตา ถ้าจอ TV ต้องเลื่อนก็เสียจุดขายไป
   ⇒ คำนวณจำนวนคอลัมน์จากจำนวนแผง แล้วให้แต่ละช่องสูงเท่ากันด้วย grid 1fr */
export function tvGrid(n, ratio = 16 / 9) {
  const count = Math.max(1, Number(n) || 0);
  // หาจำนวนคอลัมน์ที่ทำให้ช่องใกล้สี่เหลี่ยมจัตุรัสที่สุดบนจอ 16:9
  let best = { cols: 1, rows: count, score: Infinity };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellRatio = (ratio / cols) / (1 / rows);   // กว้าง:สูง ของช่อง
    const score = Math.abs(Math.log(cellRatio / 1.5)) + (cols * rows - count) * 0.04;
    if (score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}


/* ══ 🧭 work flow การไล่ดูบอร์ด — กติกาจาก IEC เอง (Obeya_E_Board-V2.pptx · 2026-09-24) ══
   IEC ส่งสไลด์บอกลำดับการเจาะมาเอง 4 ชั้น: 4 แผงหน้าแรก → POP → หัวข้อย่อย → เอกสาร/ไฟล์
   🔴 กติกาที่เขาเขียนกำกับไว้ ห้ามตีความใหม่:
   1. EVA **คนตั้งเอง** ("Leader EVA สีด้วยตัวเอง") — ระบบ *เสนอ* ได้ แต่ห้ามเขียนทับ
   2. แดง **ต้องมีข้อความ** ว่าเกิดอะไร/แก้ยังไง ไม่งั้นคนมาดูบอร์ดไม่รู้เรื่อง
   3. กลิ้งขึ้นแบบแย่สุดชนะ — "ถ้ามี 1 ตัวเป็นสีแดง ต้องโชว์แดงเลย" (= rollupEva เดิม)
   4. **เกณฑ์วันไม่เท่ากันทุกแผง** — ห้ามใช้ชุดเดียวทั้งจอ (ดู EVA_RULE ด้านล่าง)
   ═════════════════════════════════════════════════════════════════════════════════════ */

/** 3 ถังบนหัวบอร์ด — นับจาก EVA ของ sub KPI ทุกตัวใน POP */
export const BUCKETS = [
  { key: 'delay',  label: 'Delay',             eva: 'R', hint: 'sub KPI ที่ EVA แดง — กดแล้วกระโดดไปที่รายการเลย' },
  { key: 'onplan', label: 'On plan',           eva: 'Y', hint: 'กำลังดำเนินการตามแผน' },
  { key: 'done',   label: 'Complete & Finish', eva: 'G', hint: 'จบแล้ว ไม่ต้อง follow up อีก' },
];
/** EVA → ถัง · 'none' ไม่เข้าถังไหน (ยังไม่ถึงด่าน ≠ ไม่ผ่าน — กฎข้อ 2 ของไฟล์นี้) */
export const bucketOf = (eva) => (eva === 'R' ? 'delay' : eva === 'Y' ? 'onplan' : eva === 'G' ? 'done' : null);

/**
 * แผ่ POP เป็นรายการ "ใบ" (sub KPI ที่ประเมินได้จริง) — หัวข้อที่มีลูกไม่นับเป็นใบ
 * คืน [{ path, no, label, mainKey, mainLabel, eva, note, panel }]
 */
export function flattenPop(pop) {
  const out = [];
  for (const m of pop || []) {
    const kids = m.subs || [];
    if (!kids.length) {
      out.push({ path: m.key, no: m.no, label: m.label, mainKey: m.key, mainLabel: m.label,
        eva: m.eva || 'none', note: m.note || '', panel: m.panel || null });
      continue;
    }
    for (const s of kids) {
      out.push({ path: `${m.key}.${s.key}`, no: s.no, label: s.label, mainKey: m.key, mainLabel: m.label,
        eva: s.eva || 'none', note: s.note || '', panel: s.panel || null });
    }
  }
  return out;
}

/** EVA ของ main KPI = แย่สุดของ sub KPI ของตัวเอง (ตัวที่ไม่มีลูกใช้ค่าตัวเอง) */
export function mainEva(main) {
  const kids = main?.subs || [];
  return kids.length ? rollupEva(kids.map(s => s.eva)) : (main?.eva || 'none');
}

/** นับ 3 ถัง + ที่ยังไม่ประเมิน — ใช้กับ "ใบ" จาก flattenPop */
export function bucketCounts(leaves) {
  const out = { delay: 0, onplan: 0, done: 0, none: 0, total: 0 };
  for (const l of leaves || []) {
    const b = bucketOf(l?.eva);
    if (b) out[b]++; else out.none++;
    out.total++;
  }
  return out;
}

/** ใบทั้งหมดในถังหนึ่ง — นี่คือ "ทางลัด" ที่ IEC ขอ: กดถังแดงแล้วเห็นรายการปัญหาเลย */
export function leavesInBucket(leaves, bucketKey) {
  return (leaves || []).filter(l => bucketOf(l?.eva) === bucketKey);
}

/** ใบที่แดงแต่ไม่มีคำอธิบาย = ผิดกติกาข้อ 2 ของ IEC — จอต้องฟ้อง ห้ามปล่อยผ่าน */
export function redWithoutNote(leaves) {
  return (leaves || []).filter(l => l?.eva === 'R' && !String(l?.note || '').trim());
}

/* ── เกณฑ์สีราย "ชนิดแผง" — ตัวเลขมาจากสไลด์ของ IEC ตรงๆ ห้ามแก้เอง ──────────── */
export const EVA_RULE = {
  pop: { label: 'POP main KPI', redDays: 10,
    red: 'delay > 10 วัน',
    yellow: 'กำลังดำเนินการตามแผน และ KPI target ต้องได้ด้วยทุกสัปดาห์',
    green: 'ทำแล้ว จบไปแล้ว ไม่มีการ follow up อีก' },
  delivery: { label: 'Part delivery status', redDays: null,
    red: 'ส่งไม่ได้ / delay — ต้องระบุว่าตัวไหน สาเหตุอะไร',
    yellow: 'ส่งได้แบบมีเงื่อนไข — ต้องระบุว่าตัวไหน สาเหตุอะไร',
    green: 'ส่งได้ตาม Condition stage' },
  quality: { label: 'Part quality status', redDays: 14, yellowDays: 7,
    red: 'Data + status part ไม่ตรงตาม Condition stage · delay > 14 วัน',
    yellow: 'ไม่ตรงตาม Condition stage · delay > 7 วัน + ต้องมีแผน improve',
    green: 'Data + status part ตรงตาม Condition stage' },
  doc: { label: 'เอกสาร 7.1 / 7.2', redDays: 10, yellowDays: 7,
    red: 'delay > 10 วัน',
    yellow: 'ไม่ตรงตาม Condition stage · delay > 7 วัน + ต้องมีแผน improve',
    green: 'ผ่านแล้ว จบแล้ว ไม่ติดปัญหา ไม่มีการ follow up อีก' },
};

/**
 * สีที่ "ระบบเสนอ" จากจำนวนวันที่ช้า — ตามเกณฑ์ของแผงนั้น
 * ⚠️ เสนอเท่านั้น — คนตั้งสีจริงคือ Leader (กติกาข้อ 1) · ใช้เทียบว่าสีที่ตั้งตรงเกณฑ์ไหม
 * คืน 'none' เมื่อยังไม่รู้จำนวนวัน — ห้ามเดาว่าเขียว
 *
 * 🟠 **ช่องโหว่ในเกณฑ์ของ IEC (ตัดสินเอง รอเขายืนยัน):** เกณฑ์เหลืองเขียนว่า
 *    "delay > 7 วัน **+ แผน improve**" ⇒ ช้าเกิน 7 วันแต่ *ไม่มี* แผน improve
 *    ไม่เข้าทั้งเหลืองและแดง (ถ้ายังไม่เกินวันแดง) · เราเลือกให้เป็น **แดง**
 *    เพราะ "ช้าแล้วไม่มีแผน" อันตรายกว่า "ช้าแล้วมีแผน" — ห้ามปล่อยเป็นเหลืองเงียบๆ
 *    ⚠️ ถ้า IEC ตอบว่าให้เป็นเหลือง ให้แก้ที่ฟังก์ชันนี้จุดเดียว
 */
export function suggestEva(ruleKey, delayDays, { hasImprovePlan = false } = {}) {
  const r = EVA_RULE[ruleKey];
  if (!r || delayDays === null || delayDays === undefined) return 'none';
  const d = Number(delayDays);
  if (!Number.isFinite(d)) return 'none';
  if (d <= 0) return 'G';
  if (r.redDays !== null && r.redDays !== undefined && d > r.redDays) return 'R';
  if (r.yellowDays !== undefined && d > r.yellowDays) return hasImprovePlan ? 'Y' : 'R';
  return 'Y';
}

/** สีที่คนตั้ง ไม่ตรงกับเกณฑ์ไหม — คืน null ถ้าตรง/ประเมินไม่ได้ (เตือนเท่านั้น ห้ามบล็อก) */
export function evaMismatch(ruleKey, eva, delayDays, opts) {
  const s = suggestEva(ruleKey, delayDays, opts);
  if (s === 'none' || !eva || eva === 'none' || s === eva) return null;
  return { set: eva, suggested: s, rule: EVA_RULE[ruleKey]?.label || ruleKey };
}
