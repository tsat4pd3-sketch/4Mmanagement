/**
 * qaSheetPrint — พิมพ์/บันทึก PDF ใบตรวจตามมาตรฐาน QA (Inspection Check Sheet) · 2026-11-05 (คำสั่ง user)
 *
 * pattern เดียวกับฟอร์มพิมพ์อื่น (BBS/LPA/MO/Scrap): window.open + print
 * เลขฟอร์ม/Rev/ช่องลายเซ็น/โลโก้/footer อ่านจากทะเบียนกลาง doc_key 'qa_inspection_sheet' — ห้าม hardcode
 *
 * 🔴 ความซื่อสัตย์ของใบ (ห้ามถอด):
 *   · จุดที่ยังไม่ได้ตรวจ ต้องพิมพ์ออกมาด้วย (แถวว่าง + "ยังไม่ตรวจ") และหัวใบบอก "ตรวจแล้ว X / Y จุด"
 *     — พิมพ์แต่จุดที่มีผล = ใบดูเหมือนตรวจครบ
 *   · ใบที่ยังไม่ปิด (status ≠ 'done') = แถบเตือน "ใบยังไม่ปิด ผลอาจยังเปลี่ยน"
 *   · ผู้ตรวจ = รหัสที่บันทึกไว้ชนะบัญชีที่ login (`inspectorForExport` · ผู้เรียกเตรียมให้) · หาลายเซ็นไม่ได้ = เว้นช่อง + บอกเหตุผลบนใบ
 */
import { getDocForm, fullCode, withDocFoot, sigAt } from '../utils/docForms';
import tsLogoUrl from '../assets/TS logo.png';
import { buildQaPrintRows, pieceCell } from '../utils/qaPrintRows.js';
export { buildQaPrintRows, pieceCell };

export const QA_SHEET_DOC_KEY = 'qa_inspection_sheet';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function urlToDataUrl(url) {
  if (!url) return '';
  if (String(url).startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

/**
 * @param {object} p
 * @param {object} p.sheet       แถว qa_inspection_sheets
 * @param {object[]} p.items     มาตรฐานจุดตรวจของพาร์ท (qa_inspection_items · active)
 * @param {object[]} p.results   qa_inspection_results ของใบ
 * @param {object[]} p.pieces    qa_inspection_pieces ของใบ
 * @param {object[]} p.actions   qa_inspection_actions ของใบ
 * @param {{ name, signatureUrl, note, code }} p.inspector  จาก inspectorForExport (ผู้เรียกเตรียม)
 * @param {string} p.stageLabel  ป้ายช่วงการตรวจ (ถ้ามี)
 * @returns {Promise<boolean>} false = เปิดหน้าต่างพิมพ์ไม่ได้ (popup ถูกบล็อก)
 */
export async function printQaSheet({ sheet, items = [], results = [], pieces = [], actions = [], inspector = {}, stageLabel = '' }) {
  const df = await getDocForm(QA_SHEET_DOC_KEY, {
    title: 'ใบตรวจตามมาตรฐาน (Inspection Check Sheet)',
    sig_blocks: ['ผู้ตรวจ', 'ผู้ทบทวน'],
    orientation: 'landscape',
  });
  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const sigImg = await urlToDataUrl(inspector?.signatureUrl);
  const code = fullCode(df);
  const { rows, pieceCols, checkedN, totalN, ngN } = buildQaPrintRows({ items, results });
  const shiftLabel = sheet?.shift === 'day' ? 'กะเช้า' : sheet?.shift === 'night' ? 'กะดึก' : (sheet?.shift || '-');
  const resultLabel = sheet?.result === 'pass' ? 'ผ่าน (OK)' : sheet?.result === 'fail' ? 'ไม่ผ่าน (NG)' : 'ยังไม่สรุป';
  const closed = sheet?.status === 'done';
  const pcCols = Array.from({ length: pieceCols }, (_, i) => i + 1);

  const trs = rows.map(r => {
    const cells = pcCols.map(n => `<td class="v ${r.values[n - 1] === 'ng' ? 'ng' : ''}">${esc(pieceCell(r.itemType, r.values[n - 1]))}</td>`).join('');
    const j = r.judgement === 'ok' ? 'OK' : r.judgement === 'ng' ? 'NG' : r.judgement === 'na' ? 'ข้าม' : '';
    return `<tr class="${r.checked ? '' : 'nc'}"><td class="b">${esc(r.balloon ?? '')}</td>`
      + `<td class="ch">${esc(r.characteristic || '')}${r.retired ? ' <i>(ปิดใช้แล้ว)</i>' : ''}</td>`
      + `<td class="sp">${esc(r.spec)}</td><td class="me">${esc(r.method)}</td>${cells}`
      + `<td class="j ${r.judgement === 'ng' ? 'ng' : ''}">${r.checked ? esc(j) : '<span class="pend">ยังไม่ตรวจ</span>'}</td>`
      + `<td class="q">${r.qtyChecked ?? ''}</td><td class="q">${r.qtyNg ?? ''}</td><td class="nt">${esc(r.note)}</td></tr>`;
  }).join('') || `<tr><td colspan="${8 + pieceCols}" style="padding:8px">— พาร์ทนี้ยังไม่มีมาตรฐานจุดตรวจ —</td></tr>`;

  const pieceSummary = pieces.length
    ? pieces.map(p => `<span class="pc ${p.result === 'fail' ? 'ng' : ''}">รอบ ${esc(p.round_no ?? '-')} ชิ้นที่ ${esc(p.piece_no)}: ${p.result === 'fail' ? 'NG' : p.result === 'pass' ? 'OK' : esc(p.result || '-')}`
        + `${p.disposition ? ` · ${esc(p.disposition)}` : ''}${p.remark ? ` · ${esc(p.remark)}` : ''}</span>`).join('')
    : '<span class="muted">— ไม่ได้บันทึกแบบทีละชิ้น —</span>';
  const actHtml = actions.length
    ? actions.map(a => `<div>รอบ ${esc(a.round_no)}: ${esc(a.action_text)} <span class="muted">(${esc(a.action_by || a.recorded_by || '')})</span></div>`).join('')
    : '<span class="muted">— ไม่มี —</span>';

  const sig0 = sigAt(df, 0), sig1 = sigAt(df, 1);
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>QA ${esc(sheet?.part_no || '')} ${esc(sheet?.work_date || '')} รอบ ${esc(sheet?.round_no || '')}</title>
<style>
  @page { size: ${df.paper_size || 'A4'} ${df.orientation || 'landscape'}; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun', Tahoma, sans-serif; font-size: 9px; color: #111; margin: 0; }
  .hd { display: flex; gap: 8px; border: 1px solid #000; padding: 4px 6px; align-items: flex-start; }
  .hd img { height: 26px; }
  .hd .mid { flex: 1; text-align: center; }
  .hd .t { font-size: 13px; font-weight: 700; }
  .hd .sub { font-size: 9.5px; margin-top: 1px; }
  .hd .rt { min-width: 170px; font-size: 8.5px; line-height: 1.5; border-left: 1px solid #000; padding-left: 6px; }
  .lbl { color: #555; }
  table.g { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.g th, table.g td { border: 1px solid #000; padding: 2px 3px; text-align: center; vertical-align: middle; }
  table.g th { background: #eee; font-size: 8px; }
  table.g td.b { width: 22px; font-weight: 700; } table.g td.ch { text-align: left; } table.g td.sp { text-align: left; white-space: nowrap; }
  table.g td.me { font-size: 8px; } table.g td.v { width: 34px; } table.g td.j { width: 54px; font-weight: 700; white-space: nowrap; } table.g td.q { width: 28px; }
  table.g td.nt { text-align: left; font-size: 8px; max-width: 140px; }
  .ng { color: #b91c1c; font-weight: 700; } tr.nc td { color: #777; } .pend { color: #b45309; font-weight: 700; }
  .row { display: flex; gap: 8px; margin-top: 5px; align-items: stretch; }
  .box { border: 1px solid #000; padding: 4px 6px; flex: 1; line-height: 1.5; }
  .box h4 { margin: 0 0 2px; font-size: 9.5px; }
  .pc { display: inline-block; margin-right: 10px; } .muted { color: #777; }
  .sig { width: 170px; text-align: center; border: 1px solid #000; padding: 4px; }
  .sig .im { height: 34px; display: flex; align-items: center; justify-content: center; }
  .sig .im img { max-height: 34px; max-width: 100%; }
  .sig .ln { border-top: 1px dotted #555; margin-top: 2px; padding-top: 2px; font-size: 8.5px; }
  .sig .why { font-size: 7.5px; color: #b45309; margin-top: 2px; }
  .warn { border: 1px solid #b45309; background: #fffbeb; color: #7c2d12; font-size: 8.5px; padding: 3px 6px; margin-top: 4px; }
</style></head><body>
<div class="hd">
  ${logo ? `<img src="${logo}" alt="">` : ''}
  <div class="mid">
    <div class="t">${esc(df.title || 'ใบตรวจตามมาตรฐาน (Inspection Check Sheet)')}</div>
    <div class="sub">P/N ${esc(sheet?.part_no || '-')} · ${esc(sheet?.part_name || '')}</div>
    <div class="sub">ไลน์ ${esc(sheet?.line_name || '-')} · วันที่ ${esc(sheet?.work_date || '-')} · ${esc(shiftLabel)} · รอบที่ ${esc(sheet?.round_no ?? '-')}
      ${stageLabel ? ` · ${esc(stageLabel)}` : ''}${sheet?.lot_no ? ` · Lot ${esc(sheet.lot_no)}` : ''}${sheet?.machine_no ? ` · เครื่อง ${esc(sheet.machine_no)}` : ''}</div>
  </div>
  <div class="rt">
    ${code ? `<div><span class="lbl">ฟอร์ม:</span> ${esc(code)}</div>` : ''}
    <div><span class="lbl">ผู้ตรวจ:</span> ${esc(inspector?.name || sheet?.inspector_name || '')}</div>
    <div><span class="lbl">รหัสพนักงาน:</span> ${esc(inspector?.code || sheet?.inspector_code || '')}</div>
    <div><span class="lbl">ตรวจแล้ว:</span> <b>${checkedN} / ${totalN}</b> จุด · NG <b class="${ngN ? 'ng' : ''}">${ngN}</b></div>
    <div><span class="lbl">ผลสรุปใบ:</span> <b class="${sheet?.result === 'fail' ? 'ng' : ''}">${esc(resultLabel)}</b></div>
  </div>
</div>
${closed ? '' : '<div class="warn">⚠ ใบนี้ยังไม่ปิด — ผลตรวจอาจยังเปลี่ยนได้ ใบพิมพ์นี้เป็นภาพ ณ เวลาที่พิมพ์</div>'}
${checkedN < totalN ? `<div class="warn">มีจุดที่ยังไม่ได้ตรวจ ${totalN - checkedN} จุด (แถวสีเทา "ยังไม่ตรวจ")</div>` : ''}
<table class="g">
  <thead><tr>
    <th>Balloon</th><th>รายการตรวจ</th><th>สเปค</th><th>วิธีตรวจ</th>
    ${pcCols.map(n => `<th>ชิ้น ${n}</th>`).join('')}
    <th>ผล</th><th>ตรวจ</th><th>NG</th><th>หมายเหตุ</th>
  </tr></thead>
  <tbody>${trs}</tbody>
</table>
<div class="row">
  <div class="box"><h4>ผลรายชิ้น</h4>${pieceSummary}</div>
  <div class="box"><h4>การแก้ไขหลังพบผิดปกติ</h4>${actHtml}</div>
  <div class="sig">
    <div style="font-size:8.5px">${esc(sig0.label || 'ผู้ตรวจ')}</div>
    <div class="im">${sigImg ? `<img src="${sigImg}" alt="">` : ''}</div>
    <div class="ln">${esc(inspector?.name || sheet?.inspector_name || sig0.name || '')}</div>
    ${!sigImg && inspector?.note ? `<div class="why">${esc(inspector.note)}</div>` : ''}
  </div>
  <div class="sig">
    <div style="font-size:8.5px">${esc(sig1.label || 'ผู้ทบทวน')}</div>
    <div class="im"></div>
    <div class="ln">${esc(sig1.name || '')}</div>
  </div>
</div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(withDocFoot(html, QA_SHEET_DOC_KEY));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}
