/**
 * ตัวอย่างเอกสาร (specimen) สำหรับหน้าทะเบียน /doc-forms — 2026-08-06 คำสั่ง user
 * ("หน้าควบคุมเอกสาร สามารถมีปุ่มกดทดลอง export เป็น PDF ได้มั้ย")
 *
 * ⚠️ ขอบเขต: แสดง **เฉพาะส่วนที่ทะเบียนคุม** — โลโก้ / เลขฟอร์ม / Rev / Effective / ชื่อเอกสาร /
 * ช่องลายเซ็น (+ชื่อผู้เซ็นประจำส่วนงาน) / legend / footer / ผู้ออกเอกสาร / Revision History
 * **เนื้อหาใบจริงมาจากหน้าที่ใช้งาน** (ตาราง/ข้อมูลผลิต) ไม่ได้จำลองมาที่นี่ — จำลองแล้วจะกลาย
 * เป็น layout ชุดที่สองที่ต้องตามแก้ตลอด (ผิดหลัก single source of truth)
 *
 * มีลายน้ำ "ตัวอย่าง" ทับทุกหน้า + แถบเตือนหัวกระดาษ เพื่อไม่ให้ใบที่พิมพ์ออกไปถูกเข้าใจผิด
 * ว่าเป็นเอกสารจริงที่ผ่านการอนุมัติ
 */
import { fullCode, sigAt } from '../utils/docForms';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {object} df       ผลจาก docFormSync/getDocForm (merge ฐาน+scope แล้ว)
 * @param {object} o        { logoUrl, route, scopeLabel, issuedName, revisions }
 */
export function buildDocFormPreviewHtml(df, o = {}) {
  const size = `${df.paper_size || 'A4'} ${df.orientation || 'portrait'}`;
  const land = (df.orientation || 'portrait') === 'landscape';
  const code = fullCode(df);
  const blocks = Array.isArray(df.sig_blocks) ? df.sig_blocks : [];
  const revs = o.revisions || [];

  const sigCells = blocks.length ? blocks.map((_, i) => {
    const { label, name } = sigAt(df, i);
    return `<td style="border:1px solid #000;vertical-align:top;padding:4px 6px;height:74px">
      <div style="font-size:10px;font-weight:700">${esc(label)}</div>
      <div style="height:38px"></div>
      <div style="border-top:1px dotted #999;text-align:center;font-size:9px;padding-top:2px;color:${name ? '#000' : '#999'}">
        ${name ? esc(name) : 'ลงชื่อ ....................'}
      </div>
    </td>`;
  }).join('') : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>ตัวอย่าง ${esc(code || df.title || '')}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @media print { @page { size: ${size}; margin: 8mm } body { -webkit-print-color-adjust:exact; print-color-adjust:exact } .noprint{display:none} }
  body { font-family:'Sarabun',sans-serif; color:#000; background:#fff; margin:0; padding:10mm; position:relative }
  .sheet { max-width:${land ? '297mm' : '210mm'}; margin:0 auto; position:relative; z-index:1 }
  .wm { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:0 }
  .wm span { font-size:${land ? 110 : 80}px; font-weight:800; color:rgba(200,60,60,.10); transform:rotate(-30deg); white-space:nowrap; letter-spacing:6px }
  table { border-collapse:collapse; width:100% }
  .warn { border:1.5px solid #c0392b; background:#fdf1f0; color:#a03028; font-size:11px; font-weight:700; padding:6px 10px; border-radius:5px; margin-bottom:9px }
  .muted { color:#666 }
</style></head><body>
<div class="wm"><span>ตัวอย่าง · SPECIMEN</span></div>
<div class="sheet">
  <div class="warn">⚠️ ตัวอย่างสำหรับตรวจทะเบียนเอกสารเท่านั้น — ไม่ใช่เอกสารจริง ห้ามใช้แทนใบที่ออกจากระบบ</div>

  <!-- หัวเอกสาร: ส่วนที่ทะเบียนคุม -->
  <table style="border:1px solid #000">
    <tr>
      <td style="border:1px solid #000;width:${land ? 150 : 120}px;text-align:center;padding:6px">
        ${o.logoUrl ? `<img src="${o.logoUrl}" style="max-height:38px;max-width:100%;object-fit:contain"/>` : '<span class="muted" style="font-size:10px">— ไม่มีโลโก้ —</span>'}
      </td>
      <td style="border:1px solid #000;text-align:center;padding:6px">
        <div style="font-size:${land ? 16 : 14}px;font-weight:700">${esc(df.title || '(ยังไม่ตั้งชื่อเอกสาร)')}</div>
        ${o.scopeLabel ? `<div style="font-size:11px;margin-top:3px">ส่วนงาน: <b>${esc(o.scopeLabel)}</b></div>` : ''}
      </td>
      <td style="border:1px solid #000;width:150px;font-size:10px;padding:5px 7px;line-height:1.75">
        <div>เลขฟอร์ม: <b>${esc(df.form_code || '—')}</b></div>
        <div>Rev: <b>${esc(df.rev || '—')}</b></div>
        <div>Effective: <b>${esc(df.effective_date || '—')}</b></div>
        <div>กระดาษ: <b>${esc(size)}</b></div>
      </td>
    </tr>
  </table>

  <!-- ตัวเนื้อหา: ของจริงมาจากหน้าที่ใช้งาน -->
  <div style="border:1px dashed #aaa;border-top:none;padding:${land ? '34px' : '48px'} 12px;text-align:center;color:#888;font-size:12px;line-height:2">
    เนื้อหาของเอกสาร (ตาราง/ข้อมูล) มาจากหน้าที่ใช้งานจริง<br>
    <b style="color:#555">${esc(o.route || '—')}</b><br>
    <span style="font-size:11px">ทะเบียนคุมเฉพาะ หัวเอกสาร · ช่องลายเซ็น · legend · footer</span>
  </div>

  ${blocks.length ? `<table style="border:1px solid #000;border-top:none"><tr>${sigCells}</tr></table>` : ''}

  ${df.legend ? `<div style="border:1px solid #000;border-top:none;padding:5px 8px;font-size:10px;white-space:pre-wrap">${esc(df.legend)}</div>` : ''}

  <div style="display:flex;justify-content:space-between;gap:12px;font-size:9.5px;color:#555;margin-top:6px">
    <span>${esc(df.footer_note || '')}</span>
    <span>${esc(code)}${df.effective_date ? ` · Effective: ${esc(df.effective_date)}` : ''}</span>
  </div>
  ${o.issuedName ? `<div style="font-size:9.5px;color:#555;margin-top:2px">ผู้ออกเอกสาร: ${esc(o.issuedName)}</div>` : ''}

  ${revs.length ? `<div style="margin-top:12px">
    <div style="font-size:11px;font-weight:700;margin-bottom:4px">ประวัติการแก้ไขเอกสาร (Revision History)</div>
    <table style="border:1px solid #000;font-size:9.5px">
      <tr style="background:#eee">
        ${['#', 'วันที่บันทึก', 'Rev', 'Issued', 'รายละเอียด', 'ผู้รับผิดชอบ', 'อนุมัติ']
      .map(h => `<th style="border:1px solid #000;padding:3px 5px;text-align:left">${h}</th>`).join('')}
      </tr>
      ${revs.map((r, i) => `<tr>
        <td style="border:1px solid #000;padding:3px 5px">${i + 1}</td>
        <td style="border:1px solid #000;padding:3px 5px">${esc(r.record_date || '')}</td>
        <td style="border:1px solid #000;padding:3px 5px">${esc(r.rev || '')}</td>
        <td style="border:1px solid #000;padding:3px 5px">${esc(r.issued_date || '')}</td>
        <td style="border:1px solid #000;padding:3px 5px">${esc(r.description || '')}</td>
        <td style="border:1px solid #000;padding:3px 5px">${esc(r.responsible || '')}</td>
        <td style="border:1px solid #000;padding:3px 5px">${esc(r.approved_name || '')}</td>
      </tr>`).join('')}
    </table></div>` : ''}
</div>
<script>window.onload=()=>setTimeout(()=>window.print(),350)</script>
</body></html>`;
}
