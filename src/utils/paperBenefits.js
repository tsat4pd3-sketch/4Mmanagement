/* ══ 📈 Live Benefits — กระดาษที่ระบบทดแทน + เวลาที่ลดได้ (2026-11-26 · คำสั่ง user) ══════════════════
   หน้า `/live-benefits` (หมวด ผู้บริหาร & เดโม) · เอกสาร `docs/modules/live-benefits.md`

   หลัก (user 26/11): "ฟอร์มที่มีระบบ export = ทดแทนกระดาษ (อยากได้ hard copy ค่อยปริ้น) ·
   มองให้ออกว่าใบไหนรายกะ ใบไหนรายเดือน" ⇒
   • รายชื่อฟอร์มมาจาก **ทะเบียนเอกสาร `doc_forms`** (ฟอร์ม export ทุกตัวต้องลงทะเบียนอยู่แล้ว) — ไม่มีลิสต์มือที่นี่
   • "ใบนี้ออกรอบละเท่าไร" = `doc_forms.paper_basis` + `paper_unit` (แก้ได้ที่ /doc-forms)
   • ตัวเลขรายเดือนมาจาก RPC `esm_benefits_rollup(p_from)` ทั้ง 2 project (นับในฐาน ไม่โหลดแถวดิบ)
     RPC คืนแค่ "จำนวน" — ไฟล์นี้เป็นคนประกอบ/คาดการณ์/รวมยอด **ห้ามคิดซ้ำในหน้า**

   🔴 "แผ่น" ≠ "ครั้งที่บันทึก" — ใบรายเดือน 1 แผ่นถูกเติมทุกวัน ⇒ กระดาษนับแผ่น · งานคีย์ Excel นับครั้ง
   🔴 เดือนปัจจุบันยังไม่จบ ⇒ ใบรายกะ/รายเรื่อง คาดการณ์เต็มเดือนได้ (ป้าย "ประมาณการ") ·
      ใบรายเดือนห้ามคูณ (แผ่นของเดือนนี้เปิดครบตั้งแต่ต้นเดือนแล้ว)
   🔴 ฟอร์มที่ยังไม่จัดรอบ / จัดแล้วแต่ยังนับสดไม่ได้ ต้องโชว์บนจอ ห้ามหายเงียบ
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** เดือนแรกที่ดึงมาเทียบ (ก่อนเริ่มทดลองทั้งโรงงาน 1 ต.ค. 2026 = ฐานเทียบ) */
export const BENEFITS_FROM = '2026-09-01';
export const TRIAL_START_MONTH = '2026-10';
export const SHEETS_PER_REAM = 500;

/** รอบการออกใบ — ค่าใน `doc_forms.paper_basis` · `paper:true` = นับเป็นกระดาษที่ทดแทน */
export const PAPER_BASIS = Object.freeze({
  shift:    { label: 'ออกทุกกะ',            short: 'รายกะ',     paper: true,  project: true,  tone: 'var(--blue)' },
  month:    { label: 'เดือนละใบ',           short: 'รายเดือน',  paper: true,  project: false, tone: 'var(--green)' },
  quarter:  { label: 'ทุก 3 เดือน',          short: 'รายไตรมาส', paper: true,  project: false, tone: 'var(--accent)' },   // skill matrix (26/11)
  event:    { label: 'ออกต่อเรื่อง',          short: 'รายเรื่อง',  paper: true,  project: true,  tone: 'var(--amber)' },
  document: { label: 'เอกสารควบคุม/ทะเบียน', short: 'เอกสารควบคุม', paper: false, project: false, tone: 'var(--purple)' },
  report:   { label: 'รายงาน/ส่งออกข้อมูล',   short: 'รายงาน',    paper: false, project: false, tone: 'var(--muted)' },
  other:    { label: 'ป้าย/แม่แบบนำเข้า',     short: 'อื่นๆ',      paper: false, project: false, tone: 'var(--muted)' },
});
export const BASIS_ORDER = ['shift', 'month', 'quarter', 'event', 'document', 'report', 'other'];

/** ฟอร์มที่ถูกนับรวมใต้อีกตัว — MO 2 ฟอร์ม (FM-JIG-008 / FM-MTN-006) แยกด้วยกฎ isMtnFormRow ฝั่ง JS ทำใน SQL ไม่ได้ */
export const COUNTED_WITH = Object.freeze({ mo_report_mtn: 'mo_report' });

/** ฟอร์มที่ทำในระบบแล้วแต่ยังไม่มีแบบพิมพ์ในทะเบียน (จึงไม่อยู่ใน doc_forms) — นับเพราะแทนกระดาษเดิมจริง */
export const EXTRA_FORMS = Object.freeze([
  { doc_key: 'pokayoke_check', title: 'ใบตรวจ Poka-yoke', paper_basis: 'month', paper_unit: 'อุปกรณ์ × กะ', used_route: '/daily-checker?tab=pokayoke', noPrint: true },
]);

/** ตัวชี้วัดเวลา (kind='flow' จาก RPC) · `ratio` = val เป็นจำนวนย่อย คิดเป็น % ของ n */
export const FLOW_METRICS = Object.freeze([
  { key: 'mo_accept_min',   label: 'แจ้งซ่อม → ช่างรับงาน',          unit: 'นาที', src: 'dr',   better: 'lower',
    before: 'เขียนใบแล้วเดินไปห้องช่าง รอคนมาบอก', after: 'ช่างเห็นบนจอทันทีที่แจ้ง' },
  { key: 'mo_fix_min',      label: 'แจ้งซ่อม → ซ่อมเสร็จ',           unit: 'นาที', src: 'dr',   better: 'lower',
    before: 'ซ่อมเสร็จแล้วเดินกลับมาให้เซ็นรับ', after: 'กดรับงาน · ลงอะไหล่ · ปิดงานบนจอ' },
  { key: 'mo_linked',       label: 'ใบซ่อมที่เปิดต่อจาก downtime/ผลตรวจ AM', unit: '%', src: 'dr', better: 'higher', ratio: true,
    before: 'เขียนอาการซ้ำลงใบซ่อม', after: 'ระบบดึงอาการจากที่ลงไว้แล้ว' },
  { key: 'close_lag_h',     label: 'ปิดกะหลังเลิกกะ',               unit: 'ชม.', src: 'dr',   better: 'lower',
    before: 'รวบรวมใบแล้วคีย์สรุปทีหลัง', after: 'ยอดกะพร้อมเมื่อกดปิดกะ' },
  { key: 'fourm_approve_h', label: '4M ยื่น → อนุมัติครบ',           unit: 'ชม.', src: 'main', better: 'lower',
    before: 'เดินใบไปหาหัวหน้าแล้วต่อไป QA', after: 'อนุมัติบนจอ แจ้งเตือนผู้อนุมัติทันที' },
]);

/** 'YYYY-MM' ของวันทำงาน (`getWorkDate()` → 'YYYY-MM-DD') */
export const monthOf = (dateStr) => String(dateStr || '').slice(0, 7);

/** รายการเดือนตั้งแต่ from ถึง to (รวมปลาย) · 'YYYY-MM' */
export function monthKeysBetween(from, to) {
  const out = [];
  let [y, m] = String(from).split('-').map(Number);
  const [ty, tm] = String(to).split('-').map(Number);
  if (!y || !m || !ty || !tm) return out;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
    if (out.length > 240) break;
  }
  return out;
}

const daysInMonth = (mk) => { const [y, m] = mk.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** ตัวคูณคาดการณ์เต็มเดือน · เดือนที่จบแล้ว = 1 · เดือนอนาคต = null · today = 'YYYY-MM-DD' (วันทำงาน) */
export function projectFactor(monthKey, today) {
  const cur = monthOf(today);
  if (!cur || !monthKey) return null;
  if (monthKey < cur) return 1;
  if (monthKey > cur) return null;
  const day = Number(String(today).slice(8, 10));
  if (!day) return null;
  return daysInMonth(monthKey) / day;
}

/** ชั่วโมงคนที่ไม่ต้องคีย์ Excel = ครั้งที่บันทึก × นาทีต่อครั้ง ÷ 60 · ไม่รู้ = null */
export function keyingHours(entries, minPerEntry) {
  if (!Number.isFinite(entries) || !Number.isFinite(minPerEntry) || minPerEntry < 0) return null;
  return (entries * minPerEntry) / 60;
}

/**
 * ประกอบตารางกระดาษ
 * @param forms  แถว doc_forms ({doc_key,title,form_code,paper_basis,paper_unit,used_route,is_active})
 * @param rows   แถว RPC kind='paper' ของทั้ง 2 project ({key,month_key,n,val})
 * @param today  วันทำงาน 'YYYY-MM-DD'
 * @param from   เดือนแรก 'YYYY-MM'
 */
export function buildPaperModel({ forms = [], rows = [], today, from = monthOf(BENEFITS_FROM) }) {
  const cur = monthOf(today);
  const months = monthKeysBetween(from, cur);
  const byKey = new Map();
  for (const r of rows || []) {
    if (!r || !months.includes(r.month_key)) continue;   // ทิ้งเดือนอนาคต (แผน LPA ล่วงหน้า · OJT ที่นัดไว้)
    const m = byKey.get(r.key) || {};
    const prev = m[r.month_key] || { sheets: 0, entries: 0 };
    m[r.month_key] = { sheets: prev.sheets + (Number(r.n) || 0), entries: prev.entries + (Number(r.val) || 0) };
    byKey.set(r.key, m);
  }
  const all = [...(forms || []).filter(f => f && f.is_active !== false), ...EXTRA_FORMS
    .filter(x => !(forms || []).some(f => f?.doc_key === x.doc_key))];

  const items = all.map(f => {
    const basis = PAPER_BASIS[f.paper_basis] ? f.paper_basis : null;
    const countedWith = COUNTED_WITH[f.doc_key] || null;
    const data = byKey.get(f.doc_key) || null;
    const meta = basis ? PAPER_BASIS[basis] : null;
    const byMonth = {};
    for (const mk of months) {
      const v = data?.[mk];
      if (!v) { byMonth[mk] = data ? { sheets: 0, entries: 0 } : null; continue; }
      const k = projectFactor(mk, today);
      // ใบรายเดือน: แผ่นห้ามคูณ (เปิดครบตั้งแต่ต้นเดือน) แต่ "ครั้งที่บันทึก" ยังเติมทุกวัน ⇒ คาดการณ์ครั้งได้ทุกชนิด
      byMonth[mk] = { sheets: v.sheets, entries: v.entries,
        sheetsProj: k == null ? null : (meta?.project ? Math.round(v.sheets * k) : v.sheets),
        entriesProj: k == null ? null : Math.round(v.entries * k) };
    }
    return { ...f, basis, meta, countedWith, counted: !!data, byMonth,
      status: !basis ? 'unclassified' : (!meta.paper ? 'excluded' : (data ? 'counted' : (countedWith ? 'counted_with' : 'not_countable'))) };
  });

  const paperItems = items.filter(i => i.status === 'counted');
  const totals = {};
  for (const mk of months) {
    const t = { sheets: 0, entries: 0, sheetsProj: 0, entriesProj: 0 };
    for (const i of paperItems) {
      const v = i.byMonth[mk];
      if (!v) continue;
      t.sheets += v.sheets; t.entries += v.entries;
      t.sheetsProj += v.sheetsProj ?? v.sheets; t.entriesProj += v.entriesProj ?? v.entries;
    }
    totals[mk] = t;
  }
  const trialMonths = months.filter(mk => mk >= TRIAL_START_MONTH);
  const sinceTrial = trialMonths.reduce((a, mk) => ({ sheets: a.sheets + totals[mk].sheets, entries: a.entries + totals[mk].entries }),
    { sheets: 0, entries: 0 });

  const byBasis = {};
  for (const b of BASIS_ORDER) byBasis[b] = items.filter(i => i.basis === b);

  return {
    months, cur, items, totals, sinceTrial, trialMonths, byBasis,
    unclassified: items.filter(i => i.status === 'unclassified'),
    notCountable: items.filter(i => i.status === 'not_countable'),
    partialMonth: projectFactor(cur, today) > 1,
  };
}

/** ประกอบตัวชี้วัดเวลา · คืน [{...metric, byMonth:{m:{n,val}}}] · ratio → val เป็น % (ปัด 0 ตำแหน่ง) */
export function buildFlowModel(rows = [], months = []) {
  return FLOW_METRICS.map(m => {
    const byMonth = {};
    for (const mk of months) {
      const r = (rows || []).find(x => x && x.key === m.key && x.month_key === mk);
      if (!r || !(Number(r.n) > 0)) { byMonth[mk] = null; continue; }
      const n = Number(r.n); const raw = Number(r.val);
      byMonth[mk] = { n, val: m.ratio ? Math.round((raw / n) * 100) : (Number.isFinite(raw) ? raw : null) };
    }
    return { ...m, byMonth };
  });
}

/** ตัวอย่างน้อยกว่านี้ = ไม่ตัดสินแนวโน้ม (เคสจริง 26/11: 4M พ.ย. อนุมัติแค่ 5 ใบ = ใบที่เร็วรอดมา ไม่ใช่ "ดีขึ้น") */
export const MIN_FLOW_SAMPLE = 30;

const cmp = (metric, a, b) => {
  const va = metric.byMonth[a].val; const vb = metric.byMonth[b].val;
  return { from: va, to: vb, fromMonth: a, toMonth: b,
    improved: va === vb ? null : (metric.better === 'lower' ? vb < va : vb > va) };
};

/**
 * แนวโน้ม 2 มุม — ห้ามโชว์มุมเดียว (ดีขึ้นจากฐานเทียบ แต่แย่ลงจากเดือนก่อน = ต้องเห็นทั้งคู่)
 *   vsBase: เดือนแรกที่มีตัวอย่างพอ → เดือนล่าสุดที่มีตัวอย่างพอ
 *   vsPrev: เดือนก่อนหน้า → เดือนล่าสุด (ทั้งคู่ต้องมีตัวอย่างพอ)
 * เดือนที่ n < minN ไม่ถูกใช้ตัดสิน · คืน null เมื่อเทียบไม่ได้
 */
export function flowTrend(metric, months = [], { minN = MIN_FLOW_SAMPLE } = {}) {
  const ok = months.filter(mk => metric.byMonth?.[mk]?.val != null && metric.byMonth[mk].n >= minN);
  if (ok.length < 2) return { vsBase: null, vsPrev: null };
  const last = ok[ok.length - 1];
  const prevIdx = months.indexOf(last) - 1;
  const prev = prevIdx >= 0 && ok.includes(months[prevIdx]) ? months[prevIdx] : null;
  return {
    vsBase: cmp(metric, ok[0], last),
    vsPrev: prev && prev !== ok[0] ? cmp(metric, prev, last) : null,
  };
}
