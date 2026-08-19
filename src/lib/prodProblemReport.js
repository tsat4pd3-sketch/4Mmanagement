/**
 * prodProblemReport — ใบรายงานปัญหาการผลิต (พิมพ์/บันทึก PDF · A4 แนวตั้ง)
 *
 * ที่มา: feedback หน้างาน 2026-08-19 — "ลง daily ออนไลน์แล้ว แต่ยังต้องเขียนใบนี้ด้วย
 * ทุกครั้งที่มีหยุดผลิต / คุณภาพ / รอ เกิน 30 นาที" → ให้ระบบดึงปัญหามาเติมให้ ไม่ต้องเขียนมือ
 *
 * ⚠️ ไม่มีตารางใหม่ — ข้อมูลมาจากที่บันทึกไว้แล้วทั้งหมด:
 *      ปัญหาคุณภาพ     ← defect_logs
 *      ปัญหาเครื่องจักร ← downtime_logs (นอกแผน · ไม่ใช่กลุ่มรอ)
 *      ปัญหาการรอ      ← downtime_logs ที่ประเภทเป็นการรอ
 *
 * ⚠️ ช่องติ๊กในฟอร์มเป็น "รายการตายตัวบนกระดาษ" — ระบบจับคู่ให้แบบ best-effort จากชื่อประเภท
 *    **แต่ข้อความจริงถูกพิมพ์ลงช่อง "รายละเอียดของปัญหา" เสมอ** ไม่ว่าจะจับคู่ติ๊กได้หรือไม่
 *    → จับคู่ไม่ได้ = ไม่มีข้อมูลหาย แค่ไม่มีเครื่องหมายถูกในช่อง (คนเติมเองได้)
 *
 * ⚠️ ป้ายช่องติ๊กถอดมาจากฟอร์มกระดาษที่สแกนมา — ถ้าตัวสะกดไม่ตรงของจริง แก้ที่ 3 ลิสต์ข้างล่างนี้
 */
import { getDocForm, fullCode, withDocFoot, sigAt } from '../utils/docForms';
import tsLogoUrl from '../assets/TS logo.png';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function urlToDataUrl(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

/* ── ช่องติ๊กตามฟอร์มกระดาษ (label = ที่พิมพ์บนใบ · match = คำที่ใช้จับคู่กับชื่อประเภทในระบบ) ── */
export const QUALITY_BOXES = [
  { label: 'เหล็กคิดปกติ',   match: ['เหล็กคิด', 'เหล็กติด'] },
  { label: 'T/L NG',         match: ['t/l', 'tl ng'] },
  { label: 'ขอบงาน-รูรั่ง',   match: ['ขอบงาน', 'รูรั่', 'รูรั่ว', 'ขอบเยิน'] },
  { label: 'รอยเปื้อนครูด',   match: ['รอยเปื้อน', 'ครูด', 'ขีดข่วน'] },
  { label: 'ชิ้นงานแตก',     match: ['แตก', 'ร้าว'] },
  { label: 'ชิ้นงานเสียรูป',  match: ['เสียรูป', 'บิดเบี้ยว', 'บิด', 'โก่ง', 'งอ'] },
  { label: 'GAP NG',         match: ['gap'] },
  { label: 'ชิ้นงานย่น',     match: ['ย่น', 'ยับ'] },
];
export const MACHINE_BOXES = [
  { label: 'โรบอท',   match: ['โรบอท', 'robot', 'rb-', 'rb '] },
  { label: 'PLC',     match: ['plc'] },
  { label: 'Bending', match: ['bend', 'ดัด', 'พับ'] },
  { label: 'Laser',   match: ['laser', 'เลเซอร์', 'ls-'] },
  { label: 'Jig',     match: ['jig', 'จิ๊ก', 'จิก'] },
  { label: 'Station', match: ['station', 'สเตชั่น', 'sp-'] },
];
export const WAIT_BOXES = [
  { label: 'เหล็ก',       match: ['เหล็ก', 'material', 'วัตถุดิบ', 'พาร์ท'] },
  { label: 'Rack',        match: ['rack', 'แร็ค', 'ชั้นวาง'] },
  { label: 'Box',         match: ['box', 'กล่อง', 'ภาชนะ', 'ตะกร้า'] },
  { label: 'คัดแยก',      match: ['คัดแยก', 'คัด'] },
  { label: 'ขัดสนิม',     match: ['ขัดสนิม', 'สนิม'] },
  { label: 'พนักงานขาด',  match: ['พนักงาน', 'คนขาด', 'ขาดคน', 'รอคน'] },
];

/** คำที่บอกว่า downtime รายการนี้เป็น "การรอ" ไม่ใช่ "เครื่องจักรเสีย" */
const WAIT_WORDS = ['รอ', 'ขาด', 'คัดแยก', 'ขัดสนิม', 'material', 'wait'];

const norm = s => String(s || '').toLowerCase();
const hit = (text, boxes) => {
  const t = norm(text);
  const on = new Set();
  boxes.forEach(b => { if (b.match.some(m => t.includes(m))) on.add(b.label); });
  return on;
};

const hhmm = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * แปลง downtime/defect ของกะหนึ่ง → เนื้อหา 3 คอลัมน์ของฟอร์ม (pure — เทสได้)
 * @param minMinutes เกณฑ์นาทีของ downtime ที่ถือว่าต้องออกใบ (หน้างานใช้ 30 นาที)
 */
export function buildProblemReport({ downtimes = [], defects = [], minMinutes = 30 }) {
  const dtAll = downtimes.filter(d => d.dr_downtime_types?.category !== 'planned');
  const long = dtAll.filter(d => (Number(d.duration_min) || 0) >= minMinutes);
  const short = dtAll.length - long.length;

  const isWait = d => {
    const t = norm(d.dr_downtime_types?.name_th) + ' ' + norm(d.description);
    return WAIT_WORDS.some(w => t.includes(w));
  };
  const machineDt = long.filter(d => !isWait(d));
  const waitDt = long.filter(isWait);

  const col = (rows, boxes, textOf) => {
    const checked = new Set();
    const details = [];
    rows.forEach(r => {
      const txt = textOf(r);
      hit(txt, boxes).forEach(x => checked.add(x));
      details.push(txt);
    });
    return { checked, details };
  };

  const q = col(defects, QUALITY_BOXES, d => {
    const name = d.dr_defect_types?.name_th || 'ไม่ระบุประเภท';
    const n = (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0);
    return `${name}${n ? ` ${n} ชิ้น` : ''}${d.description ? ` — ${d.description}` : ''}`;
  });
  const m = col(machineDt, MACHINE_BOXES, d =>
    `${d.dr_downtime_types?.name_th || 'ไม่ระบุประเภท'}${d.machine_no ? ` (${d.machine_no})` : ''}`
    + ` ${Math.round(Number(d.duration_min) || 0)} นาที${d.description ? ` — ${d.description}` : ''}`);
  const w = col(waitDt, WAIT_BOXES, d =>
    `${d.dr_downtime_types?.name_th || 'ไม่ระบุประเภท'} ${Math.round(Number(d.duration_min) || 0)} นาที`
    + `${d.description ? ` — ${d.description}` : ''}`);

  const span = rows => {
    const st = rows.map(r => r.started_at).filter(Boolean).sort();
    const en = rows.map(r => r.ended_at).filter(Boolean).sort();
    return { from: hhmm(st[0]), to: hhmm(en[en.length - 1]) };
  };
  const who = rows => [...new Set(rows.map(r => r.reported_by_name).filter(Boolean))].join(', ');

  const qtyNg = defects.reduce((a, d) => a + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0), 0);

  return {
    quality: { ...q, qty: qtyNg, time: span(defects), by: who(defects), count: defects.length },
    machine: { ...m, time: span(machineDt), by: who(machineDt), count: machineDt.length,
               minutes: machineDt.reduce((a, d) => a + (Number(d.duration_min) || 0), 0) },
    wait:    { ...w, time: span(waitDt), by: who(waitDt), count: waitDt.length,
               minutes: waitDt.reduce((a, d) => a + (Number(d.duration_min) || 0), 0) },
    meta: { minMinutes, skippedShort: short, hasAny: defects.length + long.length > 0 },
  };
}

/* ── ใบพิมพ์ ─────────────────────────────────────────────────────────────── */
export async function printProdProblemReport({ session, downtimes, defects, minMinutes = 30, section = null, extra = {} }) {
  const df = await getDocForm('prod_problem_report', {
    title: 'ใบรายงานปัญหาการผลิต',
    sig_blocks: ['ผู้รายงาน', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'],
  }, section ? { section } : {});
  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const code = fullCode(df);
  const R = buildProblemReport({ downtimes, defects, minMinutes });

  const sigs = [sigAt(df, 0), sigAt(df, 1), sigAt(df, 2)];
  const box = (on, label) => `<div class="cb">${on ? '☑' : '☐'} ${esc(label)}</div>`;
  const boxes = (list, checked) =>
    list.map(b => box(checked.has(b.label), b.label)).join('') + `<div class="cb">☐ ______________</div>`;

  const detail = arr => (arr.length
    ? arr.map(t => `• ${esc(t)}`).join('<br>')
    : '<span class="none">— ไม่มีรายการในกะนี้ —</span>');

  const thDate = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>ใบรายงานปัญหาการผลิต ${esc(session.line_name)} ${esc(session.work_date)}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 7mm; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background:#fff }
  body { font-family:'Sarabun',sans-serif; color:#000; font-size:11px }
  #sheet { width: 196mm }
  table { border-collapse: collapse; width:100% }
  td, th { border:1px solid #000; padding:3px 5px; vertical-align:top }

  .hd { display:flex; border:1.5px solid #000; align-items:stretch }
  .hd .lg { width:74px; display:flex; align-items:center; justify-content:center; border-right:1px solid #000; padding:3px }
  .hd .lg img { max-width:100%; max-height:44px }
  .hd .mid { flex:1; padding:3px 8px }
  .hd .mid h1 { margin:0; font-size:17px; font-weight:800; letter-spacing:6px; text-align:center }
  .hd .mid .f { margin-top:2px; display:flex; gap:6px; align-items:baseline }
  .hd .mid .f b { flex:0 0 auto; font-weight:600 }
  .hd .mid .f span { flex:1; border-bottom:1px dotted #000; min-height:13px }
  .hd .rt { width:196px; border-left:1px solid #000; display:flex; flex-direction:column }
  .hd .rt .sg { display:flex; flex:1 }
  .hd .rt .sg div { flex:1; border-left:1px solid #000; text-align:center; font-size:8.5px; padding:2px }
  .hd .rt .sg div:first-child { border-left:none }
  .hd .rt .dt { border-top:1px solid #000; padding:2px 5px; font-size:9.5px }

  .cols th { background:#f0f0f0; text-align:center; font-weight:800; font-size:12px }
  .rowlab { width:64px; text-align:center; font-weight:600; font-size:10.5px;
            writing-mode:vertical-rl; transform:rotate(180deg); white-space:nowrap }
  .cb { font-size:10px; line-height:1.5; white-space:nowrap }
  .cbs { display:grid; grid-template-columns:1fr 1fr; gap:0 6px; margin-bottom:3px }
  .lbl { font-size:10px; margin-top:3px }
  .val { min-height:14px; font-size:10px }
  .none { color:#777 }
  .fill { border-bottom:1px dotted #000; display:inline-block; min-width:96px }
  .body td { height:auto }
  .sec-detail { min-height:112px }
  .sec-fix { min-height:86px }
  .copy { font-size:9.5px; display:flex; flex-wrap:wrap; gap:2px 16px; padding:3px 5px; border:1px solid #000; border-top:none }
  .note { font-size:9px; color:#555; margin-top:3px; display:flex; justify-content:space-between }
</style></head><body>
<div id="sheet">

  <div class="hd">
    <div class="lg">${logo ? `<img src="${logo}" alt="">` : ''}</div>
    <div class="mid">
      <h1>${esc(df.title || 'ใบรายงานปัญหาการผลิต')}</h1>
      <div class="f"><b>ปัญหา :</b><span>${esc(extra.problem || '')}</span></div>
      <div class="f"><b>ส่วนผลิต/แผนก :</b><span>${esc(extra.dept || section || '')}</span></div>
      <div class="f"><b>Line/พื้นที่ :</b><span>${esc(session.line_name || '')}</span></div>
    </div>
    <div class="rt">
      <div class="sg">${sigs.map(s => `<div>${esc(s.label)}</div>`).join('')}</div>
      <div class="dt">วันที่แจ้ง <span class="fill">${esc(thDate(session.work_date))}</span></div>
      <div class="dt">${session.shift === 'day' ? '☑' : '☐'} กะ01 &nbsp;&nbsp; ${session.shift === 'night' ? '☑' : '☐'} กะ02</div>
    </div>
  </div>

  <table class="body">
    <tr class="cols">
      <th class="rowlab" style="writing-mode:horizontal-tb; transform:none"></th>
      <th>ปัญหาคุณภาพ</th><th>ปัญหาเครื่องจักร</th><th>ปัญหาการรอ</th>
    </tr>
    <tr>
      <td class="rowlab">เกิดปัญหาอะไร</td>
      ${[
        ['q', QUALITY_BOXES, R.quality, true],
        ['m', MACHINE_BOXES, R.machine, false],
        ['w', WAIT_BOXES, R.wait, false],
      ].map(([, list, data, showQty]) => `
        <td>
          <div class="cbs">${boxes(list, data.checked)}</div>
          <div class="lbl">รายละเอียดของปัญหา :</div>
          <div class="val sec-detail">${detail(data.details)}</div>
          ${showQty ? `<div class="lbl">จำนวน : <span class="fill">${data.qty ? esc(String(data.qty)) + ' ชิ้น' : ''}</span></div>` : ''}
          <div class="lbl">ผู้รายงาน : <span class="fill">${esc(data.by || '')}</span></div>
          <div class="lbl">หน่วยงาน : <span class="fill">${esc(extra.dept || section || '')}</span></div>
        </td>`).join('')}
    </tr>
    <tr>
      <td class="rowlab">เกิดขึ้นเมื่อไร / ที่ไหน</td>
      ${[R.quality, R.machine, R.wait].map(d => `
        <td><div class="lbl">เวลา : <span class="fill">${esc(d.time.from)}</span> - <span class="fill">${esc(d.time.to)}</span></div></td>`).join('')}
    </tr>
    <tr>
      <td class="rowlab">แก้ไขอย่างไร</td>
      ${[R.quality, R.machine, R.wait].map(() => `
        <td>
          <div class="lbl">วิธีการแก้ไข :</div>
          <div class="val sec-fix"></div>
          <div class="lbl">ผู้แก้ไข : <span class="fill"></span></div>
          <div class="lbl">หน่วยงาน : <span class="fill"></span></div>
        </td>`).join('')}
    </tr>
    <tr>
      <td colspan="4" style="padding:4px 6px">
        <u style="font-weight:700">ผลการตรวจติดตามการแก้ไขปัญหา</u>
        <div style="display:flex; gap:10px">
          <div style="flex:1">
            <div class="lbl">สรุปผลการดำเนินการ :</div>
            <div style="min-height:52px"></div>
          </div>
          <div style="width:150px; font-size:9.5px; text-align:center">
            ผู้รายงาน<div style="height:22px"></div>
            <div style="border-top:1px dotted #000">วันที่</div>
            ผู้อนุมัติ<div style="height:22px"></div>
            <div style="border-top:1px dotted #000">วันที่</div>
          </div>
        </div>
      </td>
    </tr>
  </table>

  <div class="copy">
    <b>สำเนา :</b>
    ${['MTN', 'คลังสินค้า', 'ฝ่ายผลิต', 'ฝ่ายวางแผน', 'JIG MTN', 'DIE MTN', 'สโตร์']
      .map(x => `<span>☐ ${esc(x)}</span>`).join('')}
    <span>☐ ____________</span>
  </div>

  <div class="note">
    <span>ดึงจากระบบ ESM · กะ${session.shift === 'night' ? 'ดึก' : 'เช้า'} ${esc(thDate(session.work_date))} ·
      เกณฑ์ downtime ≥ ${R.meta.minMinutes} นาที${R.meta.skippedShort ? ` (ไม่รวมรายการสั้นกว่านั้น ${R.meta.skippedShort} รายการ)` : ''}</span>
    <span>${esc(code)}</span>
  </div>
</div>
<script>
  (function () {
    function fit() {
      var el = document.getElementById('sheet');
      var maxH = 283 * (96 / 25.4);      // A4 สูง 297mm − ขอบ 2×7mm
      el.style.zoom = 1;
      var h = el.scrollHeight;
      if (h > maxH) el.style.zoom = Math.max(0.5, (maxH / h) * 0.995);
      window.focus(); window.print();
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ setTimeout(fit, 60); });
    else window.addEventListener('load', function(){ setTimeout(fit, 160); });
  })();
</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(withDocFoot(html, 'prod_problem_report', section ? { section } : {}));
  w.document.close();
  return true;
}
