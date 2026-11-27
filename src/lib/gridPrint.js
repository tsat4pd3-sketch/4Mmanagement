/**
 * gridPrint — ใบพิมพ์ของ "ใบตรวจแบบตาราง" ทุกใบ (2026-11-26 · ขั้น 2 รวมระบบเอกสารกับ e-workflow)
 *
 * · เลขฟอร์ม/Rev/โลโก้/ขนาดกระดาษ/footer = ทะเบียนเอกสาร `/doc-forms` แถว `cfg.docKey` (ห้าม hardcode)
 * · ช่องเซ็น = ขั้นของใบงาน (`signoff.rows` จาก `loadRoundSignoff`) — ยังเซ็นไม่ครบ = แถบเตือนบนใบ
 * · สัญลักษณ์/หัวข้อ = จากช่อง `checkgrid` ของฟอร์ม · สีบนกระดาษ = `GRID_COLORS[].print`
 * · ⚠️ ข้อความบังคับเมื่อมีตัวเติมอัตโนมัติ: บอกว่าระบบเติมได้กี่ข้อจากทั้งหมด (กันใบอ้างเกินจริง — กติกาเดิมของ BBS)
 */
import { getDocForm, fullCode, withDocFoot } from '../utils/docForms';
import tsLogoUrl from '../assets/TS logo.png';
import { cellGlyph, markOf, colorOf } from '../utils/checkGrid';
import { monthsShort, yearDisplay } from '../utils/dateFormat';
import { dateLocale } from '../utils/i18n';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function urlToDataUrl(url) {
  if (!url) return '';
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => resolve(''); fr.readAsDataURL(blob); });
  } catch { return ''; }
}

export async function printGridSheet({ defName, cfg, sheet, month, days, employees = [], cells = {}, notes = {}, signoff = null, autoSourceLabel = '' }) {
  const docKey = cfg?.docKey || null;
  const df = docKey ? await getDocForm(docKey, { title: defName }, sheet?.section ? { section: sheet.section } : {}) : { title: defName };
  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const code = docKey ? fullCode(df) : '';
  const marks = cfg?.marks || [];
  const items = cfg?.items || [];
  const autoItems = items.filter(i => i.auto);
  const rows = signoff?.rows || [];
  const imgs = await Promise.all(rows.map(r => urlToDataUrl(r.sigUrl)));
  const fmtAt = (s) => (s ? new Date(s).toLocaleDateString(dateLocale(), { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
  const [yy, mm] = String(month || '').split('-').map(Number);
  const monthLabel = yy && mm ? `${monthsShort()[mm - 1] || mm} ${yearDisplay(yy)}` : '—';
  const dayCols = Array.from({ length: days }, (_, i) => i + 1);

  const body = employees.map((e, i) => {
    const tds = dayCols.map(d => {
      const c = cells[`${e.id}|${d}`];
      const col = c ? colorOf(markOf(cfg, c.mark)?.color).print : '#111';
      return `<td class="d" style="color:${col}">${esc(cellGlyph(cfg, c))}</td>`;
    }).join('');
    return `<tr><td class="n">${i + 1}</td><td class="c">${esc(e.employee_id_code || '')}</td><td class="nm">${esc(e.name || '')}</td>${tds}`
      + `${cfg?.rowNote ? `<td class="rm">${esc(notes[e.id] || '')}</td>` : ''}</tr>`;
  }).join('');
  const blanks = Array.from({ length: Math.max(0, 14 - employees.length) }, (_, i) =>
    `<tr><td class="n">${employees.length + i + 1}</td><td class="c"></td><td class="nm"></td>${dayCols.map(() => '<td class="d"></td>').join('')}${cfg?.rowNote ? '<td class="rm"></td>' : ''}</tr>`).join('');

  const sigHtml = rows.length
    ? rows.map((r, i) => `<div class="sig"><div style="font-size:8.5px">${esc(r.label)}</div><div class="im">${imgs[i] ? `<img src="${imgs[i]}" alt="">` : ''}</div><div class="ln">${esc(r.name || '')}${r.at ? ` · ${esc(fmtAt(r.at))}` : ''}</div></div>`).join('')
    : '<div class="sig"><div style="font-size:8.5px">ผู้ตรวจสอบ</div><div class="im"></div><div class="ln"></div></div>';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(defName || '')} ${esc(sheet?.line_name || '')} ${esc(month || '')}</title>
<style>
  @page { size: ${df.paper_size || 'A4'} ${df.orientation || 'landscape'}; margin: 8mm; }
  * { box-sizing: border-box; } body { font-family: 'Sarabun', Tahoma, sans-serif; font-size: 9px; color: #111; margin: 0; }
  .hd { display: flex; align-items: flex-start; gap: 8px; border: 1px solid #000; padding: 4px 6px; } .hd img { height: 26px; }
  .hd .mid { flex: 1; text-align: center; } .hd .t { font-size: 13px; font-weight: 700; } .hd .sub { font-size: 9.5px; margin-top: 1px; }
  .hd .rt { min-width: 150px; font-size: 8.5px; line-height: 1.5; border-left: 1px solid #000; padding-left: 6px; }
  table.g { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
  table.g th, table.g td { border: 1px solid #000; text-align: center; padding: 0; height: 15px; overflow: hidden; }
  table.g th { background: #eee; font-size: 8px; } td.n, th.n { width: 16px; } td.c, th.c { width: 42px; font-size: 8px; }
  td.nm, th.nm { width: 92px; text-align: left; padding-left: 3px; font-size: 8px; white-space: nowrap; }
  td.rm, th.rm { width: 74px; text-align: left; padding-left: 3px; font-size: 7.5px; } td.d { font-size: 8.5px; font-weight: 700; }
  .bot { display: flex; gap: 8px; margin-top: 5px; align-items: flex-start; } .box { border: 1px solid #000; padding: 4px 6px; flex: 1; }
  .box h4 { margin: 0 0 3px; font-size: 9.5px; } .ag { font-size: 8px; line-height: 1.45; } .lg { display: inline-block; margin-right: 10px; font-size: 8.5px; }
  .sig { width: 150px; flex: none; text-align: center; border: 1px solid #000; padding: 4px; } .sig .im { height: 34px; display: flex; align-items: center; justify-content: center; }
  .sig .im img { max-height: 34px; max-width: 100%; } .sig .ln { border-top: 1px dotted #555; margin-top: 2px; padding-top: 2px; font-size: 8.5px; }
  .warn { border: 1px solid #b45309; background: #fffbeb; color: #7c2d12; font-size: 8px; padding: 3px 6px; margin-top: 4px; line-height: 1.5; }
</style></head><body>
<div class="hd">${logo ? `<img src="${logo}" alt="">` : ''}
  <div class="mid"><div class="t">${esc(df.title || defName || '')}</div><div class="sub">ประจำเดือน ${esc(monthLabel)}</div>
    <div class="sub">ส่วนงาน ${esc(sheet?.section || '-')} · พื้นที่ ${esc(sheet?.line_name || '-')}</div></div>
  <div class="rt">${code ? `<div>ฟอร์ม: ${esc(code)}</div>` : ''}${signoff?.docNo ? `<div>เลขที่: ${esc(signoff.docNo)}</div>` : ''}</div>
</div>
<table class="g"><thead><tr><th class="n">ที่</th><th class="c">รหัส</th><th class="nm">ชื่อ-สกุล</th>${dayCols.map(d => `<th>${d}</th>`).join('')}${cfg?.rowNote ? '<th class="rm">หมายเหตุ</th>' : ''}</tr></thead>
<tbody>${body}${blanks}</tbody></table>
<div class="bot">
  ${items.length ? `<div class="box"><h4>${esc(cfg?.itemsTitle || 'หัวข้อตรวจ')}</h4>${items.map(i => `<div class="ag"><b>${i.seq}.</b> ${esc(i.text)}${i.auto ? ' ◆' : ''}</div>`).join('')}</div>` : ''}
  <div class="box" style="max-width:230px"><h4>สัญลักษณ์</h4>${marks.map(m => `<span class="lg"><b style="color:${colorOf(m.color).print}">${esc(m.needsItem ? `1-${items.length}` : m.glyph)}</b> ${esc(m.label)}</span>`).join('')}</div>
  ${sigHtml}
</div>
${rows.length && signoff?.status !== 'approved' ? `<div class="warn">ใบนี้ยังเซ็นไม่ครบตามสายเซ็น (${esc(defName || '')}${signoff?.docNo ? ` · ${esc(signoff.docNo)}` : ' · ยังไม่เปิดรอบเซ็น'}) — ช่องที่ว่าง = ยังไม่มีผู้เซ็น</div>` : ''}
${!rows.length ? '<div class="warn">ยังอ่านสายเซ็นของใบนี้ไม่ได้ — ช่องเซ็นเว้นว่างไว้</div>' : ''}
${autoItems.length ? `<div class="warn">◆ = ข้อที่ระบบเติมให้อัตโนมัติจาก<b>${esc(autoSourceLabel)}</b> (${autoItems.length} ข้อ จากทั้งหมด ${items.length} ข้อ) — ข้อที่เหลือมาจากการสังเกตของผู้ตรวจเท่านั้น ใบนี้จึงไม่ได้ยืนยันว่าตรวจครบทุกข้อทุกวัน</div>` : ''}
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(docKey ? withDocFoot(html, docKey, sheet?.section ? { section: sheet.section } : {}) : html);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  return true;
}
