/* ═══════════════════════════════════════════════════════════════════════════════
   สถานะช่องแผน LPA (○ ● ⊗ ? –) — ของกลางที่เดียว (2026-11-24 · คำสั่ง user ข้อ P4/P5)

   เดิมทั้งจอแผนไตรมาส (`qStatus`) และใบพิมพ์แผนรายเดือน (`statusSymbol`) ตัดสินว่า "ตรวจแล้ว"
   จาก **วันที่ตรงเป๊ะ** ทุกชั้น ⇒ Supervisor วางแผนวันจันทร์ ตรวจจริงวันพุธ = ⊗ บนหน้าแผน
   แต่หน้ารายงาน FM-QMR-008 นับว่าสัปดาห์นั้นตรวจแล้ว (2 จอขัดกัน) · และ ⊗ ไม่สนว่าไลน์เดินไหม

   user เลือก (24/11): **นับตามรอบ** — Leader รายวัน · SV รายสัปดาห์ (บล็อก 1-7/8-14/15-21/22+ ตาม
   `weekOfDay` เดียวกับรายงาน) · MGR รายเดือน · GM รายไตรมาส · **วันที่ไลน์ไม่เดิน ไม่ขึ้น ⊗**

   🔴 กติกา:
     · มีใบของชั้นนั้น "ในรอบเดียวกัน" = ● (ช่องที่วางแผนไว้) — ไม่ต้องตรงวัน
     · อ่านผลตรวจไม่ได้ = `?` ห้าม ⊗ (คลาส lpa-read-fail-not-missed)
     · รอบยังไม่จบ (วันสุดท้ายของรอบ ≥ วันนี้) = ○ ยังตรวจทันได้
     · รอบจบแล้วไม่มีใบ: ไลน์ไม่เดินเลยทั้งรอบ = `–` ไม่ได้ผลิต · ไม่รู้ว่าเดินไหม = `?` · เดิน = ⊗
   ⚠️ Pure (ไม่แตะ DB) — รับ `today` เป็นพารามิเตอร์เสมอ (ด่าน "นาฬิกา +400 วัน")
   ═══════════════════════════════════════════════════════════════════════════════ */

export const LPA_LAYER_PERIOD = Object.freeze({ leader: 'day', supervisor: 'week', manager: 'month', gm: 'quarter' });

const pad2 = (n) => String(n).padStart(2, '0');
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1..12
/** บล็อกสัปดาห์ของรายงาน FM-QMR-008: 1-7 W1 · 8-14 W2 · 15-21 W3 · 22+ W4 */
export const weekOfDay = (day) => Math.min(4, Math.ceil(day / 7));

/** ช่วงวันที่ `[from, to]` (YYYY-MM-DD) ของรอบที่ `dateStr` อยู่ ตามชั้นผู้ตรวจ · แกะไม่ออก = null */
export function lpaPeriodRange(layer, dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const ym = `${y}-${pad2(mo)}`;
  switch (LPA_LAYER_PERIOD[layer]) {
    case 'day': return [dateStr, dateStr];
    case 'week': {
      const w = weekOfDay(d), a = (w - 1) * 7 + 1, b = w === 4 ? dim(y, mo) : w * 7;
      return [`${ym}-${pad2(a)}`, `${ym}-${pad2(b)}`];
    }
    case 'month': return [`${ym}-01`, `${ym}-${pad2(dim(y, mo))}`];
    case 'quarter': {
      const qs = Math.floor((mo - 1) / 3) * 3 + 1, qe = qs + 2;
      return [`${y}-${pad2(qs)}-01`, `${y}-${pad2(qe)}-${pad2(dim(y, qe))}`];
    }
    default: return null;
  }
}

/**
 * สถานะช่องแผน 1 ช่อง
 * @param {object} a
 * @param {string} a.layer      leader|supervisor|manager|gm
 * @param {string} a.dateStr    วันที่ของช่อง (YYYY-MM-DD)
 * @param {boolean} a.planned   ช่องนี้วางแผนไว้ไหม
 * @param {Array} a.audits      ใบตรวจ `{ audit_date, layer, auditor_name }` (ที่นับเป็น "ตรวจแล้ว" — คัดก่อนส่ง)
 * @param {string} a.today      วันทำงานวันนี้ (`getWorkDate()`)
 * @param {boolean} [a.readErr] อ่านผลตรวจไม่สำเร็จ
 * @param {(ds:string)=>boolean|null} [a.ranOn]  ไลน์เดินวันนั้นไหม (null = ไม่รู้) · ไม่ส่ง = ไม่รู้
 * @param {(ds:string)=>boolean} [a.isOff]       วันหยุดโรงงาน (ไม่นับว่าต้องเดิน)
 * @returns `{ sym, state, title }` หรือ `null` (ช่องว่าง)
 */
export function lpaPlanCellStatus({ layer, dateStr, planned, audits: allAudits = [], today, readErr = false, ranOn = null, isOff = null } = {}) {
  /* A7 (24/11): ใบที่ `signed === false` (ยังไม่มีลายเซ็นผู้ตรวจ) ไม่นับ ● — ขึ้น ◐ "รอเซ็น" แทน
     (ไม่ส่ง `signed` = นับเหมือนเดิม) */
  const audits = (allAudits || []).filter(x => x.signed !== false);
  const unsigned = (allAudits || []).filter(x => x.signed === false);
  const sameDay = audits.find(x => x.layer === layer && x.audit_date === dateStr);
  if (sameDay) return { sym: '●', state: 'done', title: `ตรวจแล้ว${sameDay.auditor_name ? ` · ${sameDay.auditor_name}` : ''}` };
  const sameDayU = unsigned.find(x => x.layer === layer && x.audit_date === dateStr);
  if (sameDayU && !planned) return { sym: '◐', state: 'unsigned', title: `ตรวจแล้วแต่ยังไม่เซ็น${sameDayU.auditor_name ? ` · รอ ${sameDayU.auditor_name}` : ''}` };
  if (!planned) return null;
  if (readErr) return { sym: '?', state: 'unknown', title: 'อ่านผลตรวจไม่ได้ — ยังบอกไม่ได้ว่าตรวจแล้วหรือยัง' };
  const range = lpaPeriodRange(layer, dateStr);
  if (!range) return { sym: '○', state: 'planned', title: 'วางแผนตรวจ' };
  const [from, to] = range;
  const inPeriod = (audits || []).find(x => x.layer === layer && x.audit_date >= from && x.audit_date <= to);
  if (inPeriod) return { sym: '●', state: 'done', title: `ตรวจแล้วในรอบนี้ (${inPeriod.audit_date})${inPeriod.auditor_name ? ` · ${inPeriod.auditor_name}` : ''}` };
  const inPeriodU = unsigned.find(x => x.layer === layer && x.audit_date >= from && x.audit_date <= to);
  if (inPeriodU) return { sym: '◐', state: 'unsigned', title: `ตรวจแล้ว (${inPeriodU.audit_date}) แต่ยังไม่เซ็น${inPeriodU.auditor_name ? ` · รอ ${inPeriodU.auditor_name}` : ''}` };
  if (!today || to >= today) return { sym: '○', state: 'planned', title: 'วางแผนตรวจ' };
  // รอบจบแล้ว ไม่มีใบ — ไลน์เดินในรอบนี้ไหม (นับเฉพาะวันที่ไม่ใช่วันหยุด จนถึงเมื่อวาน)
  if (typeof ranOn !== 'function') return { sym: '?', state: 'unknown', title: 'ไม่รู้ว่าไลน์เดินไหม — ยังตัดสินว่าขาดตรวจไม่ได้' };
  let anyRun = false, anyUnknown = false;
  for (let ds = from; ds <= to && ds < today; ds = nextDay(ds)) {
    if (isOff && isOff(ds)) continue;
    const r = ranOn(ds);
    if (r === true) { anyRun = true; break; }
    if (r == null) anyUnknown = true;
  }
  if (anyRun) return { sym: '⊗', state: 'missed', title: 'เลยกำหนด — ยังไม่ตรวจ' };
  if (anyUnknown) return { sym: '?', state: 'unknown', title: 'อ่านตารางกะไม่ได้ — ยังบอกไม่ได้ว่าไลน์เดินไหม' };
  return { sym: '–', state: 'no_run', title: 'ไลน์ไม่ได้ผลิตในรอบนี้ — ไม่นับขาดตรวจ' };
}

function nextDay(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/* ═══ เติมแผนทั้งไตรมาส (P3 · 2026-11-24 · คำสั่ง user "ข้ามวันที่ผ่าน") ═══════════════════════════
   เดิมเติมทับทั้ง 3 เดือน รวมวันที่ผ่านไปแล้ว ⇒ ออกแผนวันนี้แต่ ต.ค.–เมื่อวานขึ้น ⊗ เต็มจอทันที
   และเขียนทับสิ่งที่วางไว้/แก้มือในอดีต
   🔴 กติกา: **วันก่อน `today` = คงของเดิมทุกช่อง** · เติมเฉพาะวันทำงานตั้งแต่ `today`
      · SV รายบล็อกสัปดาห์ / MGR รายเดือน / GM รายไตรมาส — รอบที่วางไว้แล้วในวันที่ผ่านมา = ไม่วางซ้ำ
      · สถานีแจกครบทุกจุดภายในวันที่เหลือของเดือน (เดือนที่ผ่านหมดแล้ว = ไม่แตะ)
   Pure — `today` ต้องส่งมาเสมอ */
const dOf = (mk, d) => `${mk}-${pad2(d)}`;
const BLOCKS = [[1, 7], [8, 14], [15, 21], [22, 31]];

/**
 * @param {object} a
 * @param {Array<{mk:string, working:number[], existing:Object<number,object>}>} a.months  3 เดือนของไตรมาส (เรียงตามเวลา)
 * @param {string[]} a.stations
 * @param {string} a.today  YYYY-MM-DD
 * @returns `{ byMonth: { [mk]: daysMap }, filledDays, keptDays }`
 */
export function lpaAutoFillQuarter({ months = [], stations = [], today } = {}) {
  const byMonth = {};
  let filledDays = 0, keptDays = 0;
  const isPast = (mk, d) => dOf(mk, d) < today;
  // GM: วางไว้แล้วในวันที่ผ่านมาของไตรมาสนี้ไหม
  const gmDone = months.some(({ mk, existing = {} }) => Object.values(existing).some(x => x?.plan_gm && isPast(mk, x.day)));
  let gmPlaced = gmDone;
  months.forEach(({ mk, working = [], existing = {} }, mi) => {
    const kept = {};
    Object.values(existing).forEach(x => { if (x && isPast(mk, x.day)) { kept[x.day] = x; keptDays++; } });
    const future = working.filter(d => !isPast(mk, d));
    if (!future.length || !stations.length) { byMonth[mk] = { ...kept }; return; }
    const perDay = Math.max(1, Math.ceil(stations.length / future.length));
    const keptHas = (flag, a = 1, b = 31) => Object.values(kept).some(x => x[flag] && x.day >= a && x.day <= b);
    const svDays = BLOCKS.filter(([a, b]) => !keptHas('plan_supervisor', a, b))
      .map(([a, b]) => future.find(d => d >= a && d <= b)).filter(Boolean);
    let mgrDay = null;
    if (!keptHas('plan_manager')) {
      const wk2 = working.filter(d => d >= 8 && d <= 14);
      const pref = wk2[1] || wk2[0] || working[Math.floor(working.length / 2)];
      mgrDay = future.includes(pref) ? pref : (future.find(d => d > pref) || future[0]);
    }
    let gmDay = null;
    if (!gmPlaced) {
      const pref = mi === 0 ? (working.find(d => d >= 15) || working[Math.floor(working.length / 2)]) : null;
      gmDay = pref && future.includes(pref) ? pref : future[0];
      gmPlaced = true;
    }
    const days = { ...kept };
    let si = 0;
    future.forEach(d => {
      const stns = [];
      for (let k = 0; k < perDay && si < stations.length; k++) { stns.push(stations[si]); si++; }
      if (!stns.length) stns.push(stations[(si + d) % stations.length]);   // แจกครบแล้ว วันที่เหลือตรวจซ้ำ
      days[d] = { ...(existing[d]?.id ? { id: existing[d].id } : {}), day: d, station: stns.join(', '),
        plan_leader: true, plan_supervisor: svDays.includes(d), plan_manager: d === mgrDay, plan_gm: d === gmDay };
      filledDays++;
    });
    byMonth[mk] = days;
  });
  return { byMonth, filledDays, keptDays };
}
