/**
 * mktProductionOrderDoc — ใบแจ้งจัดทำ (ใบสั่งทำชิ้นส่วน) F-MKT-001 + ใบแจ้งรายการชิ้นส่วนประกอบ F-MKT-002
 * ทะเบียน = คอลัมน์ `production_order_*` บน `mkt_awards` (Main) · 2026-10-30 · Q-neX เฟส 1
 *
 * ที่มา: ชุดตัวอย่าง FORD ที่ user ส่ง — Marketing ออกใบนี้ถึง "ผู้จัดการทั่วไปฝ่ายโรงงาน" ตอนได้งาน
 *   = รอยต่อ "New Model → โรงงาน" ที่ IEC §7.12 บอกว่าระบบยังไม่มี (ของจริงมีอยู่แล้วเป็นกระดาษ)
 *
 * 🔴 กฎ (ต้นแบบ src/lib/prodProblemDoc.js — ห้ามเปลี่ยนโดยไม่อ่าน docs/modules/mkt-rfq.md)
 *   1. ออกใบ = เขียนทะเบียนก่อน แล้วค่อยพิมพ์ · เขียนไม่สำเร็จ = ห้ามพิมพ์ต่อเงียบ (ใบลอยไม่มีเลข)
 *   2. พิมพ์ซ้ำ = ใบเดิม จาก snapshot เสมอ + นับ reprint_count · ไม่ออกเลขใหม่
 *   3. snapshot ไม่ตรงข้อมูลปัจจุบัน = จอต้องบอก (snapshotDrift) ห้ามพิมพ์ของใหม่ทับเลขเดิม
 *   4. เลขฟอร์ม/Rev/ช่องเซ็น/footer อ่านจาก doc_forms (`mkt_production_order` · `mkt_production_parts`)
 *      ห้าม hardcode · ทะเบียนล่ม = fallback ค่าที่ seed ไว้ (ใบยังพิมพ์ได้)
 */
import { supabase } from '../supabaseClient';
import { docFormSync, withDocFoot, sigAt, fullCode } from '../utils/docForms';
import { checkWriteRows } from '../utils/dbWrite';
import { fmtDateFull, todayLocal } from '../utils/dateFormat';
import { nextProductionOrderNo, buildProductionOrderSnapshot, PROCESS_TYPES } from '../utils/mktRfq';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('th-TH'));
const n2 = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** เนื้อ HTML ของ 2 ใบ (หน้า 1 = F-MKT-001 · หน้า 2 = F-MKT-002) — อ่านจาก snapshot เท่านั้น */
export function buildProductionOrderHtml({ snapshot: S, docNo, issued, reprint = 0 }) {
  const f1 = docFormSync('mkt_production_order', { title: 'ใบสั่งทำชิ้นส่วน (ใบแจ้งจัดทำ)', form_code: 'F-MKT-001',
    sig_blocks: ['ผู้จัดทำ (เจ้าหน้าที่/วิศวกร)', 'ผู้ตรวจสอบ (ผู้จัดการส่วน)', 'ผู้อนุมัติ (ผู้จัดการฝ่าย)'] });
  const f2 = docFormSync('mkt_production_parts', { title: 'ใบแจ้งรายการชิ้นส่วนประกอบ', form_code: 'F-MKT-002',
    sig_blocks: ['REPORTED & CHECK BY', 'CHECKED BY', 'APPROVED BY'] });
  const sig1 = (f1.sig_blocks || []).map((_, i) => sigAt(f1, i));
  const sig2 = (f2.sig_blocks || []).map((_, i) => sigAt(f2, i));
  const parts = S?.parts || [];
  const vol = S?.annual_volume;
  const perMonth = vol != null ? Math.round(vol / 12) : null;
  const sigRow = (sigs) => sigs.length ? `<div class="sig">${sigs.map(s => `<div>${esc(s.name || '')}<br><b>${esc(s.label)}</b><br><span class="d">วันที่ ______/______/______</span></div>`).join('')}</div>` : '';
  const head = (f) => `<div class="hd"><div><b>THAI SUMMIT GROUP</b><br><span class="t">${esc(f.title)}</span></div>
    <div class="r">${esc(fullCode(f))}<br>เลขที่ <b>${esc(docNo)}</b>${reprint ? `<br><span class="d">พิมพ์ซ้ำครั้งที่ ${reprint}</span>` : ''}</div></div>`;
  const page1 = `
${head(f1)}
<table class="hdr"><tr>
  <td>เรียน <b>ผู้จัดการทั่วไปฝ่ายโรงงาน</b></td><td class="r">วันที่ออกใบ ${issued?.at ? fmtDateFull(issued.at) : '—'}</td></tr><tr>
  <td colspan="2">บริษัทฯ ตกลงรับเป็นผู้จัดทำชิ้นส่วนตามรายการข้างล่างนี้ ซึ่งเป็นผลิตภัณฑ์ภายใต้ลูกค้า <b>${esc(S?.customer || '—')}</b>
  รุ่น <b>${esc(S?.model || '—')}</b> (อ้างอิง ${esc(S?.rfq_no || '—')}${S?.po_no ? ` · PO ${esc(S.po_no)}` : ''}${S?.to_no ? ` · TO ${esc(S.to_no)}` : ''})</td>
</tr></table>
<div class="sec">① รายละเอียด (Information)</div>
<table class="grid">
  <tr><th style="width:26%">Part No.</th><td>${parts.map(p => esc(p.part_no)).join('<br>') || '—'}</td><th style="width:22%">Material SAP No.</th><td class="muted">(ออกหลังเปิดใน SAP)</td></tr>
  <tr><th>Part Name</th><td>${parts.map(p => esc(p.part_name || '—')).join('<br>') || '—'}</td><th>ชนิดงาน</th><td>${esc(PROCESS_TYPES[S?.process_type] || S?.process_type || '—')}</td></tr>
  <tr><th>ประมาณการขายลูกค้า (ชิ้น/ปี)</th><td>${n0(vol)}${S?.volume_source ? ` <span class="muted">(ที่มา: ${esc(S.volume_source)})</span>` : ''}</td><th>ประมาณการสั่งซื้อ (ชิ้น/เดือน)</th><td>${n0(perMonth)}</td></tr>
  <tr><th>APW / MPW</th><td>${n0(S?.apw)} / ${n0(S?.mpw)}</td><th>SOP ที่ลูกค้ากำหนด</th><td>${S?.sop_date_customer ? fmtDateFull(S.sop_date_customer) : '—'}</td></tr>
  <tr><th>ราคาชิ้น (THB/pc)</th><td>${n2(S?.unit_price)}</td><th>ค่าแม่พิมพ์/JIG (THB)</th><td>${n2(S?.tooling_price)}</td></tr>
</table>
<div class="sec">② สิ่งที่ส่งมาด้วย / รายละเอียดการผลิตชิ้นส่วน</div>
<table class="grid">
  <tr><th style="width:26%">Drawing / CAD rev</th><td>${parts.map(p => esc(p.cad_revision || '—')).join(', ') || '—'}</td><th style="width:22%">วัตถุดิบ / ความหนา</th><td>${parts.map(p => `${esc(p.material_spec || '—')}${p.thickness_mm != null ? ` · ${esc(p.thickness_mm)} mm` : ''}`).join('<br>') || '—'}</td></tr>
  <tr><th>ผิว / เคลือบ</th><td colspan="3">${parts.map(p => esc(p.coating || '—')).join(' · ') || '—'}</td></tr>
  <tr><th>โปรเจค NPI</th><td colspan="3">${S?.npi_project_id ? 'ผูกแล้ว (ดูที่ /npi)' : '<span class="muted">ยังไม่ผูกโปรเจค NPI</span>'}</td></tr>
</table>
<div class="sec">③ บริษัท/ฝ่ายที่รับดำเนินการ</div>
<table class="grid"><tr><th style="width:26%">ฝ่ายโรงงาน</th><td>________________________</td><th style="width:22%">ผู้สร้างแม่พิมพ์</th><td>________________________</td></tr></table>
${sigRow(sig1)}
<div class="note">ออกโดย ${esc(issued?.by || '—')} · ข้อมูลจากระบบ ESM /rfq · เลข SAP Material ออกทีหลังโดยผู้เปิด production order ใน SAP</div>`;
  const rows = [];
  parts.forEach((p, i) => {
    rows.push({ item: `${i + 1}`, part_no: p.part_no, part_name: p.part_name, qty: 1, remark: p.coating || '' });
    (p.subs || []).forEach((s, j) => rows.push({ item: `${i + 1}.${j + 1}`, part_no: s.part_no, part_name: s.part_name || p.part_name, qty: s.qty_per ?? 1, remark: s.material_spec || '' }));
  });
  const page2 = `
<div class="pb"></div>
${head(f2)}
<table class="hdr"><tr><td>ลูกค้า <b>${esc(S?.customer || '—')}</b> · รุ่น <b>${esc(S?.model || '—')}</b></td><td class="r">REF.TS.NO. ${esc(docNo)}</td></tr></table>
<table class="grid"><thead><tr><th style="width:40px">ITEM</th><th>PART NO.</th><th>PART NAME</th><th style="width:60px">QTY/SET</th><th style="width:70px">MAKE</th><th style="width:80px">PURCHASE</th><th style="width:90px">CUSTOMER SUPPLY</th><th>REMARK</th></tr></thead>
<tbody>${rows.map(r => `<tr><td class="c">${esc(r.item)}</td><td>${esc(r.part_no)}</td><td>${esc(r.part_name || '')}</td><td class="c">${esc(r.qty)}</td><td></td><td></td><td></td><td>${esc(r.remark)}</td></tr>`).join('')}
${!rows.length ? '<tr><td colspan="8" class="c">ไม่มีรายการพาร์ทใน RFQ นี้</td></tr>' : ''}</tbody></table>
<div class="note">ช่อง MAKE / PURCHASE / CUSTOMER SUPPLY ให้ฝ่ายโรงงานกรอก</div>
${sigRow(sig2)}`;
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(docNo)}</title>
<style>
  @media print { @page { size: A4 portrait; margin: 12mm } .pb { page-break-before: always } }
  body { font-family: 'Sarabun', Tahoma, sans-serif; font-size: 11.5px; color: #111; margin: 0; padding: 10px 14px }
  .hd { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: 6px; margin-bottom: 8px }
  .hd .t { font-size: 15px; font-weight: 700 } .r { text-align: right } .c { text-align: center } .muted { color: #666 } .d { font-size: 10px; color: #444 }
  table { width: 100%; border-collapse: collapse } table.hdr td { padding: 2px 4px; vertical-align: top }
  table.grid th, table.grid td { border: 1px solid #333; padding: 4px 6px; vertical-align: top } table.grid th { background: #eee; text-align: left; font-size: 11px }
  .sec { font-weight: 700; margin: 10px 0 4px } .sig { display: flex; gap: 12px; margin-top: 22px }
  .sig > div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; font-size: 11px } .note { font-size: 10px; color: #444; margin-top: 8px }
</style></head><body>${page1}${page2}</body></html>`;
  return withDocFoot(body, 'mkt_production_order');
}

function printHtml(html) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  w.focus(); setTimeout(() => w.print(), 350);
  return true;
}

/**
 * ออกใบใหม่ (เฉพาะ award ที่ยังไม่มีเลขใบ): เลขที่ → snapshot → เขียน mkt_awards → พิมพ์
 * @returns { ok, award, reason } · ok=false = ไม่ได้พิมพ์ (ผู้เรียกต้องบอก user ห้ามเงียบ)
 */
export async function issueProductionOrder({ rfq, parts, award, actorName }) {
  if (!award?.id) return { ok: false, reason: 'ยังไม่ได้บันทึกผลได้งาน' };
  if (award.outcome !== 'awarded') return { ok: false, reason: 'ออกใบแจ้งจัดทำได้เฉพาะงานที่ได้ (AWARDED)' };
  if (award.production_order_no) return { ok: false, reason: 'ใบนี้ออกเลขแล้ว — ใช้พิมพ์ซ้ำ' };
  const { data: nos, error: eNo } = await supabase.from('mkt_awards').select('production_order_no').not('production_order_no', 'is', null);
  if (eNo) return { ok: false, reason: `อ่านเลขใบเดิมไม่ได้ (${eNo.message}) — ไม่ออกเลขที่อาจซ้ำ` };
  const docNo = nextProductionOrderNo((nos || []).map(r => r.production_order_no), todayLocal());
  if (!docNo) return { ok: false, reason: 'ออกเลขที่ใบไม่สำเร็จ' };
  const issuedAt = new Date().toISOString();
  const snapshot = buildProductionOrderSnapshot({ rfq, parts, award, issuedBy: actorName || null, issuedAt });
  const res = await supabase.from('mkt_awards').update({
    production_order_no: docNo, production_order_snapshot: snapshot,
    production_order_issued_at: issuedAt, production_order_issued_by: actorName || null,
  }).eq('id', award.id).is('production_order_no', null).select('*');
  // RLS ปฏิเสธ UPDATE = 0 แถวไม่มี error ⇒ นับแถวก่อนพิมพ์ (กฎเขียน DB ข้อ 2) · 0 แถวเพราะคนอื่นออกไปก่อน = ไม่พิมพ์ซ้ำซ้อน
  if (!checkWriteRows(res, 'ออกใบแจ้งจัดทำ', { zeroMsg: 'ไม่ได้ออกใบ — ไม่มีสิทธิ์ หรือมีคนออกใบนี้ไปแล้ว (โหลดหน้าใหม่)' })) return { ok: false, reason: 'เขียนทะเบียนไม่สำเร็จ' };
  const printed = printHtml(buildProductionOrderHtml({ snapshot, docNo, issued: { by: actorName, at: issuedAt } }));
  return { ok: true, award: res.data[0], printed };
}

/** พิมพ์ซ้ำใบเดิม — snapshot เสมอ · นับ reprint_count แบบ best-effort (นับไม่ได้ก็ยังพิมพ์ได้) */
export async function reprintProductionOrder({ award }) {
  const S = award?.production_order_snapshot;
  if (!award?.production_order_no || !S) return { ok: false, reason: 'ใบนี้ไม่มีเนื้อใบที่บันทึกไว้ — ออกใบใหม่แทน' };
  const n = (award.reprint_count || 0) + 1;
  const { error } = await supabase.from('mkt_awards').update({ reprint_count: n }).eq('id', award.id);
  const printed = printHtml(buildProductionOrderHtml({
    snapshot: S, docNo: award.production_order_no,
    issued: { by: award.production_order_issued_by, at: award.production_order_issued_at }, reprint: n,
  }));
  return { ok: true, printed, counted: !error };
}
