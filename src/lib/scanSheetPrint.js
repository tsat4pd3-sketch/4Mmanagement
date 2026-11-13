/* 🗒️ สร้าง HTML ใบสแกนประจำไลน์ (A4) — ตัวพิมพ์อย่างเดียว ไม่แตะ DB (2026-10-28)
   ทะเบียนเอกสาร = doc_key `scan_sheet` (อ่านเลขฟอร์ม/Rev จาก /doc-forms · ห้าม hardcode)
   QR = รูปแบบข้อความของระบบ (`ESM:<ชนิด>:<id>`) ไม่ใช่ลิงก์ — แผ่นนี้ใช้ยิงในแอป (ช่องที่มีปุ่ม 📷)
   รหัสสั้นกว่าลิงก์ ⇒ QR โปร่งกว่า ยิงติดเร็วจากระยะ ๓๐–๕๐ ซม. */
import { buildQrPayload } from '../utils/qrCode.js';

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * @param {{ line: {id,name}, downtime: Array<{id,name_th,category}>, defects: Array<{id,name_th}>,
 *           formCode?: string, printedAt?: string, toSvg: (payload:string)=>Promise<string> }} a
 * @returns {Promise<string>} HTML ทั้งหน้า (ยังไม่ครอบ withDocFoot)
 */
export async function buildScanSheetHtml({ line, downtime = [], defects = [], formCode = '', printedAt = '', toSvg }) {
  const cell = async (kind, row, tag) => `<div class="c">
      <div class="q">${await toSvg(buildQrPayload(kind, row.id))}</div>
      <div class="t"><div class="n">${esc(row.name_th)}</div>${tag ? `<div class="g">${esc(tag)}</div>` : ''}</div>
    </div>`;
  const dtCells = [];
  for (const t of downtime) dtCells.push(await cell('downtime_type', t, t.category === 'planned' ? 'ในแผน' : ''));
  const ngCells = [];
  for (const t of defects) ngCells.push(await cell('defect_type', t, ''));
  const lineQr = await toSvg(buildQrPayload('line', line.id));

  return `<html><head><meta charset="utf-8"><title>ใบสแกนประจำไลน์ ${esc(line.name)}</title>
<style>
  @page { size: A4 portrait; margin: 9mm; }
  body { font-family: Sarabun, Tahoma, sans-serif; margin: 0; color: #000; }
  .fc { font-size: 9px; color: #555; text-align: right; }
  .hd { display: flex; align-items: center; gap: 5mm; border: 0.6mm solid #000; border-radius: 2mm; padding: 3mm; margin-bottom: 4mm; }
  .hd .q { width: 30mm; height: 30mm; flex: none; }
  .hd .ln { font-size: 26px; font-weight: 800; line-height: 1.1; }
  .hd .sub { font-size: 12px; color: #333; margin-top: 1.5mm; line-height: 1.5; }
  h2 { font-size: 15px; margin: 4mm 0 2mm; padding: 1.2mm 2.5mm; background: #000; color: #fff; border-radius: 1.5mm; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5mm; }
  .c { display: flex; align-items: center; gap: 2mm; border: 0.35mm solid #999; border-radius: 1.5mm; padding: 1.8mm;
       page-break-inside: avoid; break-inside: avoid; min-height: 27mm; box-sizing: border-box; }
  .q { width: 23mm; height: 23mm; flex: none; }
  .q svg { width: 100%; height: 100%; display: block; }
  .t { min-width: 0; }
  .n { font-size: 13px; font-weight: 800; line-height: 1.2; word-break: break-word; }
  .g { font-size: 10px; color: #555; margin-top: 0.8mm; }
  .empty { font-size: 12px; color: #555; padding: 2mm 0; }
</style></head><body>
${formCode ? `<div class="fc">${esc(formCode)}</div>` : ''}
<div class="hd">
  <div class="q">${lineQr}</div>
  <div>
    <div class="ln">🏭 ${esc(line.name)}</div>
    <div class="sub">ใบสแกนประจำไลน์ — ยิงด้วยเครื่อง handheld ที่ช่องที่มีปุ่ม 📷 แทนการเลือกจากรายการ<br/>
      QR มุมซ้าย = ไลน์นี้ · ⏱ = ประเภท Downtime · 🔴 = ประเภทงานเสีย${printedAt ? ` · พิมพ์ ${esc(printedAt)}` : ''}</div>
  </div>
</div>
<h2>⏱ ประเภท Downtime (${downtime.length})</h2>
${dtCells.length ? `<div class="grid">${dtCells.join('')}</div>` : '<div class="empty">— ไม่ได้เลือก —</div>'}
<h2>🔴 ประเภทงานเสีย (${defects.length})</h2>
${ngCells.length ? `<div class="grid">${ngCells.join('')}</div>` : '<div class="empty">— ไม่ได้เลือก —</div>'}
<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>
</body></html>`;
}
