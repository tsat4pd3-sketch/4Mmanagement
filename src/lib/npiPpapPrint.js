/* ═══ ใบ PPAP Submission Checklist (รายการเอกสาร PPAP ต่อพาร์ท) — พิมพ์จาก /npi ═══
   รายงานภายใน (ยังไม่มีเลขฟอร์มทางการ) → ห่อด้วย withDocFoot(html, 'npi_ppap_checklist')
   doc_control ตั้งเลขฟอร์ม/Rev/ช่องลายเซ็นเองที่ /doc-forms — ห้าม hardcode ที่นี่ (UI §6.6)
   ⚠️ ฝั่งเอกสาร: ห้ามใช้ InfoMore/พับข้อความ — ทุกอย่างต้องอยู่บนกระดาษ */
import { docFormSync, withDocFoot, sigAt } from '../utils/docForms';
import { DELIV_STATUS, PPAP_STATUS, ppapProgress } from '../utils/npi';
import { fmtDateFull } from '../utils/dateFormat';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function buildPpapChecklistHtml({ project, part, delivs, phases, today }) {
  const df = docFormSync('npi_ppap_checklist', { title: 'PPAP Submission Checklist', sig_blocks: ['Prepared By', 'Checked By', 'Approved By'] });
  const rows = (delivs || []).filter(d => d.ppap_element).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const prog = ppapProgress(delivs);
  const phaseLabel = (code) => (phases || []).find(p => p.phase_code === code)?.label || code;
  const sigs = (df.sig_blocks || []).map((_, i) => sigAt(df, i));
  const body = `
<!doctype html><html><head><meta charset="utf-8"><title>PPAP Checklist ${esc(part.part_no)}</title>
<style>
  @media print { @page { size: A4 portrait; margin: 12mm } }
  body { font-family: 'Sarabun', Tahoma, sans-serif; font-size: 11.5px; color: #111; margin: 0; padding: 10px 14px }
  h1 { font-size: 16px; margin: 0 0 2px } .sub { font-size: 11px; color: #444; margin-bottom: 8px }
  table { width: 100%; border-collapse: collapse } th, td { border: 1px solid #333; padding: 4px 6px; vertical-align: top }
  th { background: #eee; font-size: 11px } .c { text-align: center } .r { text-align: right }
  .hdr td { border: none; padding: 1px 4px } .box { border: 1px solid #333; padding: 6px 8px; margin-bottom: 8px }
  .sig { display: flex; gap: 12px; margin-top: 18px } .sig > div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; font-size: 11px }
  .note { font-size: 10px; color: #444; margin-top: 6px }
</style></head><body>
<h1>${esc(df.title || 'PPAP Submission Checklist')}</h1>
<div class="sub">${esc(project?.name || '')} · ${esc(project?.project_code || '')} · ลูกค้า ${esc(project?.customer || part.customer || '—')}</div>
<div class="box"><table class="hdr"><tr>
  <td><b>Part No.</b> ${esc(part.part_no)}</td><td><b>Part Name</b> ${esc(part.part_name || '—')}</td><td><b>MAT No.</b> ${esc(part.mat_no || '—')}</td></tr><tr>
  <td><b>PPAP Level</b> ${esc(part.ppap_level)}</td><td><b>สถานะ PPAP</b> ${esc(PPAP_STATUS[part.ppap_status]?.label || part.ppap_status)}</td><td><b>PSW No.</b> ${esc(part.psw_no || '—')}</td></tr><tr>
  <td><b>ส่งลูกค้า</b> ${part.psw_submitted_at ? fmtDateFull(part.psw_submitted_at) : '—'}</td><td><b>ลูกค้าอนุมัติ</b> ${part.psw_approved_at ? fmtDateFull(part.psw_approved_at) : '—'}</td><td><b>พิมพ์เมื่อ</b> ${fmtDateFull(today)}</td>
</tr></table></div>
<table><thead><tr><th class="c" style="width:28px">#</th><th>รายการเอกสาร (PPAP element)</th><th style="width:90px">เฟส</th><th class="c" style="width:90px">สถานะ</th><th class="c" style="width:70px">กำหนด</th><th class="c" style="width:70px">เสร็จ</th><th style="width:90px">ผู้อนุมัติ</th><th>หมายเหตุ / อ้างอิง</th></tr></thead>
<tbody>${rows.map((d, i) => `<tr>
  <td class="c">${i + 1}</td><td>${esc(d.label)}${d.required === false ? ' <i>(ไม่บังคับ)</i>' : ''}</td><td>${esc(phaseLabel(d.phase_code))}</td>
  <td class="c">${esc(DELIV_STATUS[d.status]?.label || d.status)}</td><td class="c">${d.due_date ? fmtDateFull(d.due_date) : ''}</td><td class="c">${d.done_at ? fmtDateFull(d.done_at) : ''}</td>
  <td>${esc(d.approved_by || '')}</td><td>${esc(d.note || '')}${d.file_url ? ' 📎' : ''}</td></tr>`).join('')}
${!rows.length ? '<tr><td colspan="8" class="c">ไม่มีรายการที่ติ๊กว่าเป็น PPAP element ในแม่แบบของพาร์ทนี้</td></tr>' : ''}
</tbody></table>
<div class="note">อนุมัติแล้ว ${prog.done}/${prog.total} รายการ (${prog.pct}%) · รายการที่ตั้งเป็น "ไม่ต้องใช้" ไม่นับ · ข้อมูลจากระบบ ESM /npi</div>
${sigs.length ? `<div class="sig">${sigs.map(s => `<div>${esc(s.name || '')}<br>${esc(s.label)}</div>`).join('')}</div>` : ''}
</body></html>`;
  return withDocFoot(body, 'npi_ppap_checklist');
}

export function printPpapChecklist(args) {
  const html = buildPpapChecklistHtml(args);
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html); w.document.close();
  w.focus(); setTimeout(() => w.print(), 350);
  return true;
}
