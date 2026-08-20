/*
  Monthly Performance Review — Export .pptx (TSG corporate template)
  ==================================================================
  สร้างไฟล์ PowerPoint "Monthly Performance Review" อัตโนมัติจากข้อมูลจริงในระบบ
  (production_sessions / prod_orders / downtime_logs / defect_logs / mtn_orders)
  ตาม template ทางการ Thai Summit Group: Tahoma · เขียวเข้ม 0D3D14 + ส้ม C0561E
  โครงเรื่อง: Executive Summary → per-dept OEE/A/P/Q drilldown → Loss detail → Focus

  การใช้: import แบบ dynamic จาก MonthlyReviewExport.jsx เท่านั้น (โค้ดหนัก — lazy chunk)
  pptxgenjs ก็ dynamic import ในนี้อีกชั้น เพื่อไม่ปนเข้า bundle หลัก

  Doc control: doc_key 'monthly_review' ใน doc_forms (โลโก้/เลขฟอร์ม override ได้จาก /doc-forms)
*/
import { supabase, supabaseDR } from '../supabaseClient';
import { pairAwareTotal, collapseOps } from '../utils/pairTotals';
import { loadOpInfo, opInfoSync } from '../utils/opItems';
import { wavg, wLoad, wRun, wProd } from '../utils/oee';

/* ── TSG palette (hex ไม่มี # — ตาม pptxgenjs) ── */
const C = {
  greenDark: '0D3D14', green: '2C5F2D', greenTint: 'ECF1E9', greenRow: 'D8E4D0',
  orange: 'C0561E', orangeLight: 'FD8342', gold: 'EBD9B0', palegreen: 'CFE0C8',
  grey: '555555', amber: 'C88A00', white: 'FFFFFF',
};
const FONT = 'Tahoma';

const r1 = v => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const pct = v => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
const num = v => (v == null ? '—' : Number(v).toLocaleString('en-US'));
const hr1 = min => Math.round((min / 60) * 10) / 10;

const MONTH_EN = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
const monthLabel = (monthKey) => { // '2026-05' → 'MAY 2026'
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_EN[m - 1]} ${y}`;
};
const nextMonthLabel = (monthKey) => {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m, 1); // เดือนถัดไป
  return `${MONTH_EN[d.getMonth()][0]}${MONTH_EN[d.getMonth()].slice(1).toLowerCase()}`;
};

/* ── ดึงข้อมูลเกินเพดาน 1000 แถว — วนหน้า (pattern เดียวกับ Report.jsx) ── */
async function fetchAll(builder) {
  const out = [];
  const PAGE = 1000;
  for (let i = 0; i < 30; i++) {
    const { data, error } = await builder.range(i * PAGE, (i + 1) * PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

/* ═══════════════════════════════════════════════════════════════════
   1) รวบรวม + aggregate ข้อมูลรายเดือน
   sections = [{ code, lines: [lineName...] }] — ไลน์ leaf ใน scope ที่เลือกแล้ว
   คืน { monthKey, depts: [{ code, oee,a,p,q, output, ppm, dtHr, lines:[...], dtGroups:[...], story }] }
═══════════════════════════════════════════════════════════════════ */
export async function buildMonthlyReviewData({ monthKey, sections }) {
  const [y, m] = monthKey.split('-').map(Number);
  const from = `${monthKey}-01`;
  const to = `${monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;

  const allLineNames = sections.flatMap(s => s.lines);
  if (!allLineNames.length) throw new Error('ไม่มีไลน์ใน scope ที่เลือก');

  // กะที่ปิดแล้วของเดือน (ค่า OEE stamp ตอนปิดกะ — ห้ามคำนวณซ้ำ)
  const sessions = await fetchAll(
    supabaseDR.from('production_sessions')
      .select('id, line_name, work_date, shift, oee, oee_a, oee_p, oee_q, shift_min, actual_qty, qty_ok')
      .gte('work_date', from).lte('work_date', to)
      .in('line_name', allLineNames)
      .in('status', ['closed'])
      .order('work_date').order('id'),   // ⚠️ ต้องมีตัวตัดสินท้ายที่ unique ไม่งั้นแถววันเดียวกันสลับข้ามหน้า
  );
  const sessIds = sessions.map(s => s.id);
  const sessById = Object.fromEntries(sessions.map(s => [s.id, s]));

  // downtime / defect / orders — ดึงเป็น chunk ตาม session_id
  const downtimes = []; const defects = []; const orders = [];
  for (const ids of chunk(sessIds, 150)) {
    const [dt, df, od] = await Promise.all([
      supabaseDR.from('downtime_logs')
        .select('id, session_id, machine_no, description, duration_min, started_at, dr_downtime_types(name, category)')
        .in('session_id', ids),
      supabaseDR.from('defect_logs').select('session_id, qty_ng, qty_suspect').in('session_id', ids),
      supabaseDR.from('prod_orders').select('session_id, mat_no, qty, qty_ok, qty_actual, status').in('session_id', ids),
    ]);
    downtimes.push(...(dt.data || []));
    defects.push(...(df.data || []));
    orders.push(...(od.data || []));
  }

  // pair map สำหรับนับ output แบบ 1 คู่/stroke (กฎ pairAwareTotal)
  await loadOpInfo(); // map รายการขั้นตอน (OP งานขับนัท) — output เด็คไม่นับซ้ำ
  const mats = [...new Set(orders.map(o => o.mat_no).filter(Boolean))];
  const pairMap = {};
  for (const ms of chunk(mats, 200)) {
    const { data } = await supabaseDR.from('dr_products').select('mat_no, pair_mat_no').in('mat_no', ms);
    (data || []).forEach(p => { if (p.pair_mat_no) pairMap[p.mat_no] = p.pair_mat_no; });
  }

  // การแก้ไขจากใบซ่อม MO ที่เปิดจาก downtime (best-effort)
  const moByDt = {};
  try {
    for (const ids of chunk(downtimes.map(d => d.id), 150)) {
      const { data } = await supabaseDR.from('mtn_orders')
        .select('source_downtime_id, mo_no, root_cause, solution, mtn_dept, status')
        .in('source_downtime_id', ids);
      (data || []).forEach(o => { moByDt[o.source_downtime_id] = o; });
    }
  } catch { /* ตาราง/สิทธิ์ไม่พร้อม — ข้าม */ }

  // NG ต่อกะ (ยึด defect_logs · นับ suspect เป็นของเสียตามกฎ Q) — ใช้ถ่วงน้ำหนัก Q
  const ngBySession = {};
  defects.forEach(d => { ngBySession[d.session_id] = (ngBySession[d.session_id] || 0) + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0); });

  /* ── aggregate ต่อกลุ่มไลน์ ── */
  // เฉลี่ยถ่วงน้ำหนักตามกฎ OEE (util กลาง oeeAvg.js): A/OEE ถ่วงเวลารับภาระ · P ถ่วงเวลาเดินเครื่อง · Q ถ่วงจำนวนผลิต
  // เดิมเป็น mean ธรรมดา → เด็คที่ส่งผู้บริหารไม่ตรงกับ /oee-analytics ของเดือนเดียวกัน (แก้ 2026-08-05)
  const plannedMinOf = (sid) => downtimes
    .filter(d => d.session_id === sid && d.dr_downtime_types?.category === 'planned')
    .reduce((a, d) => a + (Number(d.duration_min) || 0), 0);
  const aggSessions = (ss) => {
    const rows = ss.map(s => ({
      oee: s.oee == null ? null : Number(s.oee), oee_a: s.oee_a == null ? null : Number(s.oee_a),
      oee_p: s.oee_p == null ? null : Number(s.oee_p), oee_q: s.oee_q == null ? null : Number(s.oee_q),
      shift_min: s.shift_min, plannedMin: plannedMinOf(s.id),
      actual_qty: s.actual_qty, qty_ng: ngBySession[s.id] || 0,
    }));
    return {
      oee: wavg(rows, r => r.oee, wLoad), a: wavg(rows, r => r.oee_a, wLoad),
      p: wavg(rows, r => r.oee_p, wRun), q: wavg(rows, r => r.oee_q, wProd),
      nSess: ss.length,
    };
  };
  const outputOf = (ss) => {
    const ids = new Set(ss.map(s => s.id));
    const perMat = {}; let nullMat = 0;
    orders.filter(o => ids.has(o.session_id)).forEach(o => {
      let qty = 0;
      if (o.status === 'confirmed') qty = Number(o.qty_ok ?? o.qty) || 0;
      else if (o.status === 'carry_over') qty = Number(o.qty_actual) || 0; // ผลิตจริงส่วนที่ยกยอด (กฎ 2026-07-23)
      else return;
      // ⚠️ pairAwareTotal คืน { target, produced } — ใช้ชื่อฟิลด์อื่นจะได้ undefined → NaN ทั้งเด็ค
      if (o.mat_no) perMat[o.mat_no] = { mat_no: o.mat_no, target: 0, produced: (perMat[o.mat_no]?.produced || 0) + qty };
      else nullMat += qty;
    });
    return pairAwareTotal(collapseOps(Object.values(perMat), opInfoSync()), mt => pairMap[mt] || null).produced + nullMat;
  };
  const dtStats = (ss) => {
    const ids = new Set(ss.map(s => s.id));
    const dts = downtimes.filter(d => ids.has(d.session_id));
    const unplanned = dts.filter(d => d.dr_downtime_types?.category !== 'planned');
    return {
      dtHr: hr1(unplanned.reduce((a, d) => a + (Number(d.duration_min) || 0), 0)),
      unplanned,
    };
  };
  const ppmOf = (ss, output) => {
    const ids = new Set(ss.map(s => s.id));
    const ng = defects.filter(d => ids.has(d.session_id)).reduce((a, d) => a + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0), 0);
    const base = output + ng;
    return base > 0 ? Math.round((ng / base) * 1e6) : 0;
  };

  // จัดกลุ่ม downtime ตามประเภท + รายละเอียดรายครั้ง (สำหรับสไลด์ loss detail)
  const dtGroupsOf = (unplanned) => {
    const g = {};
    unplanned.forEach(d => {
      const k = d.dr_downtime_types?.name || 'อื่น ๆ';
      g[k] = g[k] || { name: k, min: 0, count: 0, items: [] };
      g[k].min += Number(d.duration_min) || 0;
      g[k].count += 1;
      g[k].items.push(d);
    });
    return Object.values(g).sort((a, b) => b.min - a.min).map(grp => ({
      ...grp,
      min: Math.round(grp.min),
      items: grp.items.sort((a, b) => (Number(b.duration_min) || 0) - (Number(a.duration_min) || 0)).slice(0, 4)
        .map(d => {
          const s = sessById[d.session_id];
          const mo = moByDt[d.id];
          return {
            date: s?.work_date || '', machine: d.machine_no || '', desc: d.description || '',
            min: Math.round(Number(d.duration_min) || 0),
            fix: mo ? [mo.solution, mo.mo_no ? `(${mo.mo_no})` : ''].filter(Boolean).join(' ') : '',
          };
        }),
    }));
  };

  const depts = sections.map(sec => {
    const ss = sessions.filter(s => sec.lines.includes(s.line_name));
    const agg = aggSessions(ss);
    const output = outputOf(ss);
    const { dtHr, unplanned } = dtStats(ss);
    const lines = [...new Set(ss.map(s => s.line_name))].sort().map(ln => {
      const ls = ss.filter(s => s.line_name === ln);
      const la = aggSessions(ls);
      const lo = outputOf(ls);
      const ld = dtStats(ls);
      return { name: ln, ...la, output: lo, dtHr: ld.dtHr, ppm: ppmOf(ls, lo), dtGroups: dtGroupsOf(ld.unplanned) };
    }).filter(l => l.nSess > 0);
    return {
      code: sec.code, ...agg, output, dtHr, ppm: ppmOf(ss, output),
      lines, dtGroups: dtGroupsOf(unplanned),
    };
  }).filter(d => d.nSess > 0);

  if (!depts.length) throw new Error('เดือนนี้ไม่มีกะที่ปิดแล้วใน scope ที่เลือก');
  return { monthKey, from, to, depts };
}

/* ═══════════════════════════════════════════════════════════════════
   2) rule-based story — สร้างประโยค readout จากตัวเลขจริง
═══════════════════════════════════════════════════════════════════ */
function lowestDriver(d) { // ตัวไหนฉุด OEE: เทียบ gap จากเป้ามาตรฐาน A90 P90 Q99
  const gaps = [['A', (d.a ?? 100) - 90], ['P', (d.p ?? 100) - 90], ['Q', (d.q ?? 100) - 99]];
  gaps.sort((x, y) => x[1] - y[1]);
  return gaps[0][0];
}
function execStory(depts) {
  const out = [];
  const qStable = depts.every(d => (d.q ?? 0) >= 99);
  if (qStable) out.push('Quality is stable on all departments; OEE loss is mainly ' + (lowestDriver(depts[0]) === 'A' ? 'Availability.' : 'Performance.'));
  if (depts.length >= 2) {
    const sorted = [...depts].sort((a, b) => (b.oee ?? 0) - (a.oee ?? 0));
    const gap = r1((sorted[0].oee ?? 0) - (sorted[1].oee ?? 0));
    if (gap >= 0.5) out.push(`${sorted[0].code} leads ${sorted[1].code} by +${gap} pts OEE, supported by stronger ${lowestDriver(sorted[1]) === 'A' ? 'Availability' : 'Performance'}.`);
  }
  const drill = depts.map(d => `${d.code} ${d.lines.map(l => l.name).join('/')}`).join(' and ');
  out.push(`Drilldown focus: ${drill}.`);
  return out;
}
function deptStory(d) {
  const out = [];
  const drv = lowestDriver(d);
  out.push(`${d.code} story: ${drv} is the lever; ${drv === 'A' ? 'P and Q do not explain the main OEE gap' : 'recover cycle stability while holding Quality'}.`);
  if (d.lines.length >= 2) {
    const sorted = [...d.lines].sort((a, b) => (b.oee ?? 0) - (a.oee ?? 0));
    const best = sorted[0]; const worst = sorted[sorted.length - 1];
    const gap = r1((best.oee ?? 0) - (worst.oee ?? 0));
    if (gap >= 0.5) out.push(`${worst.name} trails ${best.name} by ${gap} pts OEE — keep ${best.name} as benchmark and move ${worst.name} through ${lowestDriver(worst) === 'A' ? 'Availability recovery' : 'Performance recovery'}.`);
  }
  const topDt = d.dtGroups[0];
  if (topDt) out.push(`Top downtime: ${topDt.name} ${hr1(topDt.min)}h (${topDt.count} events) — confirm owner and closure date in daily meeting.`);
  return out;
}
function lineReadout(l) {
  const drv = lowestDriver(l);
  return drv === 'A' ? 'Availability' : drv === 'P' ? 'Performance' : 'Quality';
}

/* ═══════════════════════════════════════════════════════════════════
   3) วาดสไลด์ pptxgenjs ตาม template TSG
═══════════════════════════════════════════════════════════════════ */
export async function generateMonthlyReviewPptx(data, { logoDataUrl, presenter, position, orgLine, docForm }) {
  const { default: PptxGen } = await import('pptxgenjs');
  const pres = new PptxGen();
  pres.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in
  const MON = monthLabel(data.monthKey);
  const NEXT = nextMonthLabel(data.monthKey);
  let pageNo = 0;

  const T = (t, o) => ({ text: t, options: o });
  const footer = (s) => {
    pageNo += 1;
    if (pageNo === 1) return;
    if (logoDataUrl) s.addImage({ data: logoDataUrl, x: 0.42, y: 6.92, w: 0.4, h: 0.42 });
    s.addText('THAI SUMMIT GROUP', { x: 0.86, y: 6.92, w: 3, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: C.greenDark, align: 'left', valign: 'middle', margin: 0 });
    s.addText(String(pageNo), { x: 12.3, y: 6.95, w: 0.7, h: 0.35, fontFace: FONT, fontSize: 12, color: C.grey, align: 'right', margin: 0 });
  };
  const head = (s, title, subtitle) => {
    s.addText(title, { x: 0.5, y: 0.28, w: 11.9, h: 0.95, fontFace: FONT, fontSize: 30, bold: true, color: C.greenDark, align: 'left', valign: 'top', margin: 0 });
    if (subtitle) s.addText(subtitle, { x: 0.55, y: 1.05, w: 11.9, h: 0.5, fontFace: FONT, fontSize: 17, bold: true, color: C.green, align: 'left', valign: 'top', margin: 0 });
  };
  const stat = (s, x, y, valueTxt, label, w = 2.6) => {
    s.addText(valueTxt, { x, y, w, h: 0.62, fontFace: FONT, fontSize: 30, bold: true, color: C.orange, align: 'center', margin: 0 });
    s.addText(label, { x, y: y + 0.58, w, h: 0.32, fontFace: FONT, fontSize: 11, color: C.grey, align: 'center', margin: 0 });
  };
  const bullets = (s, items, x, y, w, fs = 13) => {
    s.addText(items.map((t, i) => T(t, { bullet: { code: '2022' }, breakLine: i < items.length - 1, paraSpaceAfter: 6 })),
      { x, y, w, h: 0.42 * items.length + 0.2, fontFace: FONT, fontSize: fs, color: C.green, align: 'left', valign: 'top', margin: 0 });
  };
  // ตาราง TSG: หัวเขียวเข้ม ตัวขาว · แถวสลับ tint
  const tsgTable = (s, headRow, rows, opts = {}) => {
    const tableRows = [
      headRow.map(h => ({ text: h, options: { fontFace: FONT, fontSize: 11.5, bold: true, color: C.white, fill: { color: C.greenDark }, align: 'center', valign: 'middle' } })),
      ...rows.map((row, ri) => row.map((cell, ci) => ({
        text: String(cell ?? '—'),
        options: {
          fontFace: FONT, fontSize: opts.fontSize || 11.5, color: C.green, bold: ci === 0,
          fill: { color: ri % 2 === 0 ? C.greenTint : C.white },
          align: ci === 0 || opts.leftCols?.includes(ci) ? 'left' : 'center', valign: 'middle',
        },
      }))),
    ];
    // rowH: ตัวเลขเดียว = ทุกแถว · ส่ง headRowH มาด้วย = หัวตารางเตี้ยกว่าแถวข้อมูล
    const rowH = opts.headRowH != null ? [opts.headRowH, ...rows.map(() => opts.rowH ?? 0.34)] : (opts.rowH ?? 0.34);
    s.addTable(tableRows, { x: opts.x ?? 0.5, y: opts.y ?? 2.0, w: opts.w ?? 12.3, colW: opts.colW, border: { type: 'solid', color: C.greenRow, pt: 0.75 }, rowH, autoPage: false });
  };

  /* ── Slide 1: Title ── */
  {
    const s = pres.addSlide();
    s.background = { color: C.greenDark };
    if (logoDataUrl) s.addImage({ data: logoDataUrl, x: 5.87, y: 0.55, w: 1.6, h: 1.66 });
    s.addText(`MONTHLY PERFORMANCE REVIEW ${MON}`, { x: 0.8, y: 2.7, w: 11.7, h: 0.9, fontFace: FONT, fontSize: 40, bold: true, color: C.white, align: 'center', margin: 0 });
    if (presenter) s.addText(presenter, { x: 0.8, y: 3.75, w: 11.7, h: 0.45, fontFace: FONT, fontSize: 16, color: C.white, align: 'center', margin: 0 });
    if (position) s.addText(position, { x: 0.8, y: 4.15, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 14, color: C.palegreen, align: 'center', margin: 0 });
    if (orgLine) s.addText(orgLine, { x: 0.8, y: 4.5, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 14, color: C.palegreen, align: 'center', margin: 0 });
    s.addText('My Quality Declaration', { x: 0.8, y: 5.35, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: C.gold, align: 'center', margin: 0 });
    s.addText('“I will not accept, produce and deliver non-quality work”', { x: 0.8, y: 5.72, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 14, italic: true, color: C.gold, align: 'center', margin: 0 });
    s.addText('“ผมจะไม่รับ, ไม่ทำ และไม่ส่งมอบงานที่ไม่มีคุณภาพ”', { x: 0.8, y: 6.08, w: 11.7, h: 0.4, fontFace: FONT, fontSize: 13, italic: true, color: C.gold, align: 'center', margin: 0 });
    pageNo = 1;
  }

  /* ── Slide 2: Agenda ── */
  {
    const s = pres.addSlide();
    head(s, `MONTHLY PERFORMANCE REVIEW ${MON}`, 'Agenda');
    const items = [
      `EXECUTIVE SUMMARY : ${data.depts.map(d => d.code).join(' <> ')} OEE / A / P / Q`,
      ...data.depts.map(d => `${d.code} REVIEW : Overall → ${d.lines.map(l => l.name).join(' / ')}`),
      `KEY LOSS DRIVER & ${NEXT.toUpperCase()} FOCUS`,
    ];
    items.forEach((t, i) => {
      const y = 2.0 + i * 0.95;
      s.addShape('ellipse', { x: 0.7, y, w: 0.55, h: 0.55, fill: { color: C.orange } });
      s.addText(String(i + 1), { x: 0.7, y, w: 0.55, h: 0.55, fontFace: FONT, fontSize: 20, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0 });
      s.addText(t, { x: 1.5, y: y + 0.02, w: 10.6, h: 0.55, fontFace: FONT, fontSize: 17, bold: true, color: C.greenDark, align: 'left', valign: 'middle', margin: 0 });
    });
    footer(s);
  }

  /* ── Slide 3: Executive summary ── */
  {
    const s = pres.addSlide();
    head(s, `EXECUTIVE SUMMARY : ${data.depts.map(d => d.code).join(' <> ')} OEE / A / P / Q`, `${MON} PERFORMANCE STORY`);
    const n = data.depts.length;
    const statW = Math.min(2.9, 12.3 / (n * 2));
    data.depts.forEach((d, i) => {
      stat(s, 0.6 + i * statW, 1.75, pct(d.oee), `${d.code} OEE`, statW - 0.15);
      stat(s, 0.6 + (n + i) * statW, 1.75, `${d.dtHr}h`, `${d.code} DT`, statW - 0.15);
      s.addText(`A ${pct(d.a)} | P ${pct(d.p)} | Q ${pct(d.q)}`, { x: 0.6 + i * statW, y: 2.72, w: statW - 0.15, h: 0.3, fontFace: FONT, fontSize: 10.5, color: C.green, align: 'center', margin: 0 });
    });
    tsgTable(s,
      ['Dept / Line', 'OEE', 'A', 'P', 'Q', 'Output', 'PPM', 'DT Hr'],
      data.depts.map(d => [`${d.code} Overall`, pct(d.oee), pct(d.a), pct(d.p), pct(d.q), num(d.output), num(d.ppm), d.dtHr]),
      { y: 3.3, rowH: 0.4 });
    bullets(s, execStory(data.depts), 0.6, 3.5 + (data.depts.length + 1) * 0.42 + 0.35, 12.1);
    footer(s);
  }

  /* ── Slide 4: OEE breakdown all areas ── */
  {
    const s = pres.addSlide();
    head(s, 'OEE BREAKDOWN : WHY OEE MOVED', 'A / P / Q COMPARISON');
    const rows = [];
    data.depts.forEach(d => {
      rows.push([`${d.code} Overall`, pct(d.oee), pct(d.a), pct(d.p), pct(d.q), `OEE constrained by ${lowestDriver(d)}`, lowestDriver(d) === 'A' ? 'Recover downtime' : 'Cycle stability']);
      d.lines.forEach(l => {
        rows.push([l.name, pct(l.oee), pct(l.a), pct(l.p), pct(l.q), `${lineReadout(l)} focus`, l.dtGroups[0] ? `${l.dtGroups[0].name}` : 'Hold standard']);
      });
    });
    tsgTable(s, ['Area', 'OEE', 'Availability', 'Performance', 'Quality', 'Primary readout', 'Focus'], rows,
      { y: 1.85, rowH: 0.38, colW: [2.1, 1.2, 1.4, 1.5, 1.2, 2.7, 2.2], fontSize: 11 });
    footer(s);
  }

  /* ── per dept: overview + loss detail ── */
  for (const d of data.depts) {
    // Overview
    {
      const s = pres.addSlide();
      head(s, `${d.code} REVIEW : OVERALL OEE / A / P / Q`, `${d.code} OVERVIEW`);
      [['OEE', d.oee], ['A', d.a], ['P', d.p], ['Q', d.q]].forEach(([lb, v], i) => {
        stat(s, 0.6 + i * 3.05, 1.8, pct(v), lb === 'OEE' ? `Overall ${d.code}` : lb === 'A' ? 'Availability' : lb === 'P' ? 'Performance' : 'Quality', 2.9);
      });
      // กันชนขอบล่าง: ไลน์เยอะ → ตัดแถวโชว์ 6 + ลดจำนวน bullet
      const showLines = d.lines.slice(0, 6);
      tsgTable(s,
        ['Line', 'OEE', 'A', 'P', 'Q', 'Output', 'PPM', 'DT Hr'],
        showLines.map(l => [l.name, pct(l.oee), pct(l.a), pct(l.p), pct(l.q), num(l.output), num(l.ppm), l.dtHr]),
        { y: 3.05, rowH: 0.4 });
      const storyY = 3.25 + (showLines.length + 1) * 0.44 + 0.35;
      bullets(s, deptStory(d).slice(0, showLines.length > 3 ? 2 : 3), 0.6, storyY, 12.1, showLines.length > 4 ? 11.5 : 13);
      footer(s);
    }
    // Loss detail (top downtime + การแก้ไข)
    {
      const s = pres.addSlide();
      head(s, `${d.code} LOSS DETAIL : TOP DOWNTIME`, `FROM OEE LOSS TO ACTION FOCUS — ${MON}`);
      const rows = [];
      d.dtGroups.slice(0, 3).forEach(g => {
        const detail = g.items.map((it, i) =>
          `(${i + 1}) ${it.date.slice(8, 10)}/${it.date.slice(5, 7)} ${it.machine ? it.machine + ' ' : ''}${it.desc || '-'} (${it.min} min)${it.fix ? ` → ${it.fix}` : ''}`).join('\n');
        rows.push([`${g.name}\n${hr1(g.min)}h / ${g.count} ครั้ง`, detail || '—', NEXT]);
      });
      if (!rows.length) rows.push(['—', 'No unplanned downtime recorded this month', '—']);
      tsgTable(s, ['Loss / เวลาสูญเสีย', 'รายละเอียดปัญหา + การแก้ไข', 'Target'], rows,
        { y: 1.72, rowH: 1.28, headRowH: 0.32, colW: [2.4, 8.6, 1.3], fontSize: 10, leftCols: [1] });
      bullets(s, [
        `${d.code}: attack top downtime categories first; OEE will move through ${lowestDriver(d) === 'A' ? 'Availability' : 'Performance'}.`,
        'Use daily line meeting to confirm top stop category and owner — escalate repeats until closure.',
      ], 0.6, 6.12, 12.1, 11.5);
      footer(s);
    }
  }

  /* ── Key loss driver & next-month focus ── */
  {
    const s = pres.addSlide();
    head(s, `KEY LOSS DRIVER & ${NEXT.toUpperCase()} FOCUS`, 'WHAT TO SAY IN REVIEW');
    const allGroups = {};
    data.depts.forEach(d => d.dtGroups.forEach(g => {
      allGroups[g.name] = allGroups[g.name] || { name: g.name, min: 0, count: 0 };
      allGroups[g.name].min += g.min; allGroups[g.name].count += g.count;
    }));
    const top = Object.values(allGroups).sort((a, b) => b.min - a.min).slice(0, 3);
    top.forEach((g, i) => stat(s, 0.6 + i * 4.1, 1.9, `${hr1(g.min)}h`, `${g.name} (${g.count} ครั้ง)`, 3.9));
    const worstDept = [...data.depts].sort((a, b) => (a.oee ?? 0) - (b.oee ?? 0))[0];
    const worstLine = data.depts.flatMap(d => d.lines).sort((a, b) => (a.oee ?? 0) - (b.oee ?? 0))[0];
    bullets(s, [
      ...execStory(data.depts).slice(0, 2),
      worstLine ? `${worstLine.name} OEE ${pct(worstLine.oee)} is the priority line — drill down to ${worstLine.dtGroups[0]?.name || 'loss'} recurrence and confirm action dates.` : '',
      `${NEXT} focus: lift ${lowestDriver(worstDept) === 'A' ? 'Availability' : 'Performance'} before chasing other levers; report next month as A/P/Q movement, not only action completion.`,
    ].filter(Boolean), 0.6, 3.3, 12.1, 14);
    footer(s);
  }

  /* ── Closing ── */
  {
    const s = pres.addSlide();
    s.background = { color: C.greenDark };
    s.addText('Before We Build Parts, We Build People', { x: 0.8, y: 3.0, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 32, bold: true, color: C.white, align: 'center', margin: 0 });
    s.addText('Thank you', { x: 0.8, y: 3.95, w: 11.7, h: 0.5, fontFace: FONT, fontSize: 18, color: C.gold, align: 'center', margin: 0 });
    if (docForm?.form_code) s.addText([docForm.form_code, docForm.rev].filter(Boolean).join(' '), { x: 10.8, y: 7.05, w: 2.3, h: 0.3, fontFace: FONT, fontSize: 9, color: C.palegreen, align: 'right', margin: 0 });
  }

  const fname = `Monthly_Performance_Review_${MON.replace(' ', '_')}.pptx`;
  await pres.writeFile({ fileName: fname });
  return fname;
}
