/* ── ใบบันทึกการเปลี่ยนแปลง (Changing Point Control Record · FM-PD2-037) — ตัวสร้างใบชุดเดียว ──
   (2026-11-05 · คำสั่ง user) "ต้องกด export ทางเดียวถึงจะเห็นแบบกระดาษ" + "ใบที่ export ไม่ตรง ไม่มีตาราง detail"

   🔴 จอ (ปุ่มสลับ "ใบ Changing Point" ในแท็บ 4M) กับใบพิมพ์ (ปุ่ม Export) **วาดจาก HTML ชุดเดียวกันนี้**
      ⇒ ห้ามวาดใบซ้ำในหน้า (จะกลายเป็น layout ชุดที่ 2 ที่ต้องตามแก้)
   ไฟล์นี้ pure (ไม่แตะ supabase) — โหลดข้อมูลที่ `Report.jsx` แล้วส่งเข้า `buildChangePointSheet()`

   สัญลักษณ์ในปฏิทิน (1 ช่อง = 1 วัน × 1 กะ):
   · `X` มีการเปลี่ยนแปลง · `O` เปิดกะแล้วไม่มีการเปลี่ยนแปลง
   · `-` ไม่มีการทำงาน (ไลน์ไม่ได้เปิดกะนั้น — ตาม `production_sessions` ฝั่ง DR ผ่าน `utils/runDays.js`)
   · `?` อ่านข้อมูลกะไม่ได้ — 🔴 **ห้ามบีบเป็น `-`** (ไม่รู้ ≠ ไม่ได้ทำงาน) และต้องเขียนบนใบ
   · ว่าง = ยังไม่ถึงวัน · เสาร์-อาทิตย์ทาพื้นเทาเสมอ (ตามใบจริง) แต่สัญลักษณ์ใช้กฎเดียวกับวันธรรมดา
   ใบที่นับ = ทุกสถานะ **ยกเว้น `rejected`** (คำสั่ง user 05/11) */
import { CHECKLIST_ITEMS, CATEGORY_COLOR, matchChecklistItem } from './changePointChecklist.js';

export const CPC_MARK = { hit: 'X', ok: 'O', no_run: '-', unknown: '?', future: '' };

const THAI_MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** กะของใบ — ใช้เวลาที่บันทึก (created_at) ตามเวลาไทยเสมอ: 08:00–19:59 = กะเช้า (กฎเดิมของใบนี้) */
export function cpcShiftOf(log) {
  if (!log?.created_at) return 'day';
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hourCycle: 'h23' }).format(new Date(log.created_at)));
  return (h >= 8 && h < 20) ? 'day' : 'night';
}

/** ใบไหนเข้าใบ Changing Point — ทุกสถานะยกเว้นถูกตีกลับ */
export const cpcCounts = (log) => log?.status !== 'rejected';

/**
 * @param {object} p
 * @param {string} p.month  'YYYY-MM'
 * @param {object[]} p.logs four_m_logs ของไลน์ (ครอบครัวไลน์) ในเดือนนั้น
 * @param {(date:string, shift:'day'|'night') => boolean|null} p.ranOn  เปิดกะไหม · null = ไม่รู้
 * @param {string} p.today  วันทำงานปัจจุบัน 'YYYY-MM-DD' (ส่งเข้ามา — เทสตรึงค่าได้)
 */
export function buildChangePointSheet({ month, logs = [], ranOn = () => null, today }) {
  const [y, m] = String(month || '').split('-').map(Number);
  if (!y || !m) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const date = `${month}-${pad(d)}`;
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { d, date, weekend: dow === 0 || dow === 6, future: !!today && date > today };
  });

  const used = (logs || []).filter(cpcCounts);
  const hits = {};        // itemId -> Set(`${d}|${shift}`)
  const unmatchedIds = new Set();
  for (const l of used) {
    const item = matchChecklistItem(l);
    if (!item) { unmatchedIds.add(l.id); continue; }
    const d = Number(String(l.work_date).slice(8, 10));
    (hits[item.id] ||= new Set()).add(`${d}|${cpcShiftOf(l)}`);
  }

  let unknownCells = 0;
  const rows = CHECKLIST_ITEMS.map(item => ({
    item,
    shifts: ['day', 'night'].map(shift => ({
      shift,
      cells: days.map(day => {
        let state;
        if (hits[item.id]?.has(`${day.d}|${shift}`)) state = 'hit';   // ของจริงเกิดแล้ว ชนะทุกเงื่อนไข
        else if (day.future) state = 'future';
        else {
          const ran = ranOn(day.date, shift);
          state = ran === true ? 'ok' : ran === false ? 'no_run' : 'unknown';
        }
        if (state === 'unknown') unknownCells++;
        return { state, weekend: day.weekend };
      }),
    })),
  }));

  const details = [...used].sort((a, b) =>
    String(a.work_date).localeCompare(String(b.work_date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));

  return {
    month, y, m, monthLabel: THAI_MONTHS[m], yearBE: y + 543,
    days, rows, details, unmatchedIds,
    unmatchedCount: unmatchedIds.size,
    pendingCount: used.filter(l => l.status !== 'approved').length,
    unknownCells,
  };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtD = (iso) => { const s = String(iso || ''); return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : ''; };

/* CSS ของใบ — scope ใต้ `.cpc` (วางบนจอได้โดยไม่ชนสไตล์แอป) · บนจอฟอนต์ ≥11px · พิมพ์ย่อลง */
export const CPC_CSS = `
.cpc{font-family:'Sarabun',sans-serif;color:#000;background:#fff;font-size:11px;min-width:1100px}
.cpc table{border-collapse:collapse;width:100%}
.cpc td,.cpc th{border:1px solid #555;padding:2px 3px}
.cpc .hd-title{background:#ffff00;text-align:center;font-weight:700;font-size:20px;line-height:1.4}
.cpc .hd-title small{display:block;font-size:16px}
.cpc .hd-unit th{background:#a7f3c4;font-size:11px}
.cpc .hd-unit td{border:none;border-bottom:1px dotted #555;font-size:12px;color:#1f3fbf}
.cpc .day{width:24px;text-align:center;font-weight:700;color:#1f3fbf}
.cpc .we{background:#bdbdbd}
.cpc .cat{font-weight:700;text-align:center;writing-mode:vertical-rl;transform:rotate(180deg);font-size:15px;width:34px}
.cpc .lbl{white-space:nowrap;color:#1f3fbf}
.cpc .sh{width:22px;text-align:center;color:#1f3fbf;font-weight:700}
.cpc .sh.n{background:#ffc000}
.cpc .mk{text-align:center;font-weight:700}
.cpc .mk.hit{color:#c00;background:#fde2e2}
.cpc .mk.no_run{color:#666}
.cpc .mk.unknown{color:#b45309;background:#fef3c7}
.cpc .mk.we.hit{background:#f5b5b5}
.cpc .green{background:#a7f3c4;font-weight:700;text-align:center;color:#1f3fbf}
.cpc .yellow{background:#ffff00;font-weight:700;text-align:center;color:#1f3fbf}
.cpc .dt td{height:20px;vertical-align:top}
.cpc .warn{margin-top:6px;padding:4px 8px;border:1px solid #d97706;background:#fffbeb;color:#92400e;font-size:12px}
.cpc .foot{display:flex;justify-content:space-between;font-size:11px;margin-top:4px}
@media print{
  @page{size:A3 landscape;margin:8mm}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cpc{min-width:0;font-size:9px}
  .cpc .hd-title{font-size:16px}.cpc .hd-title small{font-size:13px}
  .cpc .day{width:auto;font-size:8px}.cpc .cat{font-size:11px}
  .cpc .warn{font-size:9px}
}`;

/**
 * HTML ของใบ (ไม่รวม <html>/<body>) — ใช้ทั้งบนจอและใบพิมพ์
 * @param {object} sheet ผลจาก buildChangePointSheet
 * @param {object} meta  { line, section, logoDataUrl, docNo, revision, effectiveDate, legend,
 *                         revisions:[{rev, issued_date, description, responsible}], issuedName, issuedSig,
 *                         names:{[uuid]:string}, fmtDate:(iso)=>string }
 */
export function changePointSheetHtml(sheet, meta = {}) {
  if (!sheet) return '';
  const names = meta.names || {};
  const nm = (id) => (id ? esc(names[id] || '') : '');
  const fmt = meta.fmtDate || fmtD;
  const dayCols = sheet.days.map(d => `<th class="day${d.weekend ? ' we' : ''}">${d.d}</th>`).join('');

  const grid = sheet.rows.map((r, idx) => {
    const first = idx === 0 || sheet.rows[idx - 1].item.category !== r.item.category;
    const span = sheet.rows.filter(x => x.item.category === r.item.category).length * 2;
    const c = CATEGORY_COLOR[r.item.category] || { bg: '#999', fg: '#fff' };
    return r.shifts.map((s, si) => `<tr>
      ${first && si === 0 ? `<td class="cat" rowspan="${span}" style="background:${c.bg};color:${c.fg}">${esc(r.item.category)}</td>` : ''}
      ${si === 0 ? `<td class="lbl" rowspan="2">${esc(r.item.label)}</td>` : ''}
      <td class="sh${s.shift === 'night' ? ' n' : ''}">${s.shift === 'day' ? 'D' : 'N'}</td>
      ${s.cells.map(cell => `<td class="mk ${cell.state}${cell.weekend ? ' we' : ''}">${CPC_MARK[cell.state]}</td>`).join('')}
    </tr>`).join('');
  }).join('');

  // ตาราง detail — ใบจริงมี 10 บรรทัด ⇒ อย่างน้อย 10 แถว (ช่องว่างไว้เขียนมือ) · เกินกว่านั้นแสดงครบทุกใบ
  const detailRows = sheet.details.map(l => `<tr>
      <td style="white-space:nowrap">${esc(fmtD(l.work_date))}</td>
      <td>${esc(l.category)}${sheet.unmatchedIds.has(l.id) ? ' ★' : ''}</td>
      <td>${esc(l.description)}${l.status !== 'approved' ? ' <i style="color:#92400e">(รออนุมัติ)</i>' : ''}</td>
      <td>${esc(l.line_name)}</td>
      <td>${nm(l.created_by)}</td>
      <td>${nm(l.sv_approved_by)}</td>
      <td>${nm(l.approved_by)}</td>
    </tr>`);
  while (detailRows.length < 10) detailRows.push('<tr>' + '<td>&nbsp;</td>'.repeat(7) + '</tr>');

  const legendLines = String(meta.legend || 'O = ไม่มีการเปลี่ยนแปลงในวันนั้น\nX = กรณีมีการเปลี่ยนแปลงในวันนั้น')
    .split('\n').filter(Boolean);
  legendLines.push('- = ไม่มีการทำงาน (ไม่ได้เปิดกะ)');
  if (sheet.unknownCells) legendLines.push('? = อ่านข้อมูลการเปิดกะไม่ได้');

  const revs = (meta.revisions && meta.revisions.length ? meta.revisions : [{}]).map(r => `<tr>
      <td style="text-align:center">${esc(r.rev ?? '')}</td>
      <td style="text-align:center">${r.issued_date ? esc(fmt(r.issued_date)) : ''}</td>
      <td style="text-align:center">${esc(r.description || '')}</td>
      <td style="text-align:center">${esc(r.responsible || '')}</td>
    </tr>`).join('');

  const warns = [];
  if (sheet.unmatchedCount) warns.push(`★ ${sheet.unmatchedCount} ใบจัดเข้าหัวข้อในตารางด้านบนไม่ได้ (รายละเอียดไม่ตรงคำของหัวข้อใด) — ไม่ได้กา X แต่แสดงในตาราง detail แล้ว`);
  if (sheet.pendingCount) warns.push(`มี ${sheet.pendingCount} ใบที่ยังไม่ผ่านการอนุมัติครบ (ช่องผู้อนุมัติยังว่าง)`);
  if (sheet.unknownCells) warns.push(`? ${sheet.unknownCells} ช่อง อ่านข้อมูลการเปิดกะไม่สำเร็จ — ไม่รู้ว่าวันนั้นทำงานหรือไม่`);

  return `<div class="cpc">
  <table>
    <tr>
      <td style="width:110px;text-align:center;vertical-align:middle">${meta.logoDataUrl ? `<img src="${meta.logoDataUrl}" style="max-width:96px;max-height:64px;object-fit:contain"/>` : ''}</td>
      <td class="hd-title">ใบบันทึกการเปลี่ยนแปลง<small>Changing Point Control Record</small></td>
      <td style="width:360px;padding:0;vertical-align:top">
        <table class="hd-unit">
          <tr><th colspan="2">หน่วยงาน/หน้างานที่เกี่ยวข้อง</th></tr>
          <tr><td style="width:60px">แผนก</td><td>${esc(meta.section)}</td></tr>
          <tr><td>ส่วน</td><td>${esc(meta.section)}</td></tr>
          <tr><td>Line</td><td>${esc(meta.line)}</td></tr>
        </table>
      </td>
    </tr>
  </table>
  <table>
    <tr>
      <th colspan="3" style="text-align:right;font-weight:400;color:#1f3fbf">Month (เดือน)</th>
      <th colspan="${sheet.days.length}" style="font-weight:400">เดือน <b style="font-size:1.3em">${esc(sheet.monthLabel)}</b> พ.ศ. <b>${sheet.yearBE}</b></th>
    </tr>
    <tr><th colspan="3" style="text-align:left;font-weight:400;color:#1f3fbf">Detail (รายละเอียด)</th>${dayCols}</tr>
    ${grid}
  </table>
  <table class="dt">
    <tr>
      <td class="green" style="width:90px">วันที่เปลี่ยน</td>
      <td class="green" style="width:80px">เปลี่ยนอะไร<br/>ด้าน 4M</td>
      <td class="green">รายละเอียดการเปลี่ยนแปลง และ แก้ไขอย่างไร / อบรมก่อนเริ่มงานอย่างไร</td>
      <td class="green" style="width:130px">พื้นที่หน่วยงาน</td>
      <td class="green" style="width:130px">ผู้เปลี่ยนแปลง</td>
      <td class="yellow" style="width:110px">ติดตามผลทำงาน<br/>หัวหน้างาน</td>
      <td class="yellow" style="width:110px">ประกันคุณภาพ<br/>หัวหน้างาน</td>
    </tr>
    ${detailRows.join('')}
  </table>
  <table>
    <tr>
      <td class="green" style="width:34%">สัญลักษณ์และการลงบันทึก</td>
      <td class="green" colspan="4">บันทึกการเปลี่ยนแปลง (Revision Record)</td>
      <td class="green" colspan="2">Production Department</td>
    </tr>
    <tr>
      <td rowspan="${(meta.revisions?.length || 1) + 1}" style="vertical-align:top">
        กำหนดให้ลงข้อมูลการเปลี่ยนแปลงดังนี้<br/>${legendLines.map(esc).join('<br/>')}
      </td>
      <td style="text-align:center">Rev.</td><td style="text-align:center">Issued date</td>
      <td style="text-align:center">Description of Change</td><td style="text-align:center">Responsible</td>
      <td style="text-align:center">Approved</td><td style="text-align:center">Issued</td>
    </tr>
    ${revs.replace('</tr>', `<td rowspan="${meta.revisions?.length || 1}"></td><td rowspan="${meta.revisions?.length || 1}" style="text-align:center;vertical-align:bottom">${meta.issuedSig ? `<img src="${meta.issuedSig}" style="max-height:30px;max-width:80px;object-fit:contain"/><br/>` : ''}${esc(meta.issuedName || '')}</td></tr>`)}
  </table>
  <div class="foot"><span>${esc(meta.docNo || '')}${meta.revision != null && meta.revision !== '' ? ` Rev.${esc(meta.revision)}` : ''}</span><span>Effective Date : ${esc(meta.effectiveDate || '-')}</span></div>
  ${warns.length ? `<div class="warn">${warns.map(esc).join('<br/>')}</div>` : ''}
</div>`;
}

/** เอกสารเต็มสำหรับหน้าต่างพิมพ์ */
export function changePointPrintDoc(bodyHtml) {
  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/><title>Changing Point Control Record</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');body{margin:0;padding:8mm;background:#fff}${CPC_CSS}</style>
</head><body>${bodyHtml}<script>window.onload = () => window.print();</script></body></html>`;
}
