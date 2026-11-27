/* ══ 📥 importRegistry — ทะเบียนกลางของ "นำเข้าไฟล์ข้อมูล" ทุกจุดในระบบ (2026-11-24 · คำสั่ง user) ══════════════
   user: *"ปุ่มสำหรับอัพโหลดไฟล์ … มันควรเป็นคำเดียวกัน แต่จะทำยังไงไห้รู้ว่าควรอัพโหลดไฟล์ไหน"* + *"ดูภาษาด้วย"*
   mockup ที่ user เคาะ: https://claude.ai/artifact/3rWWNwmmyHBrGLiRCm7gUm
   🔴 กติกา (UI-CONVENTIONS §6.44):
   1. ปุ่มนำเข้าไฟล์ข้อมูล = `📥 นำเข้า <ชื่อไฟล์>` ↔ `📥 Import <file name>` เท่านั้น — วาดผ่าน `<ImportButton k>`
      ("แนบไฟล์" ↔ "Attach file" = แนบเอกสาร/รูปเข้าใบงาน · คนละเรื่อง ห้ามใช้ปน)
   2. หน้าต่าง/แผงนำเข้าเปิดด้วย `<ImportInfo k>` (ไฟล์ที่รับ · ได้มาจาก · ต้องมีคอลัมน์ · นำเข้าที่ไหน)
   3. ไฟล์อ่านไม่ออก ⇒ ถาม `whichImport(sheets)` ก่อนแจ้ง error — เป็นไฟล์ของจุดอื่น = บอกว่าต้องไปนำเข้าที่ไหน (`<WrongFileNote>`)
   4. จุดนำเข้าใหม่ = เพิ่มแถวที่นี่ + คำแปลใน `src/i18n/en.js` (มีด่าน `import-button-standard`)
   ⚠️ ตัวตรวจ "ไฟล์นี้คืออะไร" ใช้เฉพาะรูปแบบที่มีหัวคอลัมน์บอกชัด — ฟอร์ม PE (อ่านตามตำแหน่งแถว/คอลัมน์) กับ
      Monthly report บัญชี (หัวเดือน + ชื่อแถวกว้างมาก) ไม่มีตัวตรวจ = ไม่เดา (คืน null ไม่ใช่ทายผิด)
   ⚠️ ไฟล์นี้ไม่ยิง DB · ไม่ import react */
import { storeSheetHeader } from './storeStockSheet.js';
import { detectMonitoringKind } from './monitoringSheet.js';
import { isEdiHeaderRow, normHdr } from './ediDetect.js';
import { TEMPLATE_HEADERS as SPARE_TEMPLATE } from './spareImport.js';
import { isCsatSheet } from './csatImport.js';

const low = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const firstRows = (rows, n) => (rows || []).slice(0, n).map(r => (Array.isArray(r) ? r : []));
const rowHas = (row, re) => row.some(c => re.test(low(c)));

/** ตัวตรวจทีละแบบ — รับ rows ของ 1 ชีท (array of arrays) · ตอบ true เมื่อมั่นใจเท่านั้น */
const DETECT = {
  store_stock: (rows) => !!storeSheetHeader(rows),
  sap_mb52: (rows) => firstRows(rows, 30).some(r =>
    rowHas(r, /^material( number| no)?$/) && rowHas(r, /^(sloc|storage location|stor\.? ?loc)/) && rowHas(r, /^unrestr/)),
  esmart: (rows) => {
    const head = firstRows(rows, 12).flat().map(low).join(' ');
    if (/smart supplier|detailed smart|part usage report/.test(head)) return true;
    return firstRows(rows, 40).some(r => rowHas(r, /^replenishment time stamp$/) && rowHas(r, /^part quantity$/));
  },
  edi: (rows) => firstRows(rows, 20).some(r => isEdiHeaderRow(r.map(c => String(c ?? '')))),
  sap_bom: (rows) => firstRows(rows, 40).some(r => r.length >= 4
    && rowHas(r, /^(level|bom level|explosion level)$/) && rowHas(r, /^(component|component no|component material|obj)/)),
  planner_monitoring: (rows) => !!detectMonitoringKind(rows),
  product_csv: (rows) => { const h = firstRows(rows, 1)[0] || []; return rowHas(h, /^mat_no$/) && rowHas(h, /^cycle_time_sec$/); },
  parts_csv: (rows) => { const h = firstRows(rows, 1)[0] || []; return rowHas(h, /^mat_no$/) && rowHas(h, /^qty_per_pkg$/); },
  spare: (rows) => firstRows(rows, 10).some(r => {
    const hs = new Set(r.map(c => normHdr(c)));
    return SPARE_TEMPLATE.filter(t => hs.has(normHdr(t))).length >= 6;
  }),
  kpi_csat: (rows) => isCsatSheet(rows),
};

/**
 * ทะเบียน 11 จุด — `name` = ส่วนหลัง "นำเข้า" บนปุ่ม (ไทย) · ชื่อไฟล์/ระบบต้นทางเขียนเหมือนกันทั้ง 2 ภาษา
 * `to` = ลิงก์หน้าที่นำเข้าไฟล์นี้ (ใช้ในข้อความ "ไฟล์ผิดช่อง")
 */
export const IMPORTS = {
  planner_monitoring: {
    name: 'Monitoring แพลนนิ่ง', file: '1.Monitoring-<เดือน>.xlsx', from: 'ทีมวางแผน (แพลนนิ่ง)',
    cols: 'MAT SAP + แถว PLAN · IN · OUT · BALANCE ต่อพาร์ท · ชีทลูกค้ามีหัว ORDER',
    where: 'Stock Management › Monitoring › กลุ่มแผนผลิต', to: '/line-stock?tab=monitoring',
  },
  store_stock: {
    name: 'Stock_Store', file: 'Stock_Store.xlsm', from: 'สโตร์ (ทะเบียนพาร์ทของแต่ละพื้นที่)',
    cols: "Mat'l SAP · Part Name · STD/PC · MAX · MIN · 1 ชีท = 1 พื้นที่ (R401 · S403 …)",
    where: 'Stock Management › Monitoring › กลุ่มสโตร์', to: '/line-stock?tab=monitoring&mon=st_raw',
  },
  sap_mb52: {
    name: 'MB52 (SAP)', file: 'MB52 export (.xls / .xlsx)', from: 'SAP (MB52)',
    cols: 'Material · SLoc · Unrestr.', where: 'Stock Management › เทียบยอด SAP (MB52)', to: '/line-stock?tab=sapstock',
  },
  edi: {
    name: 'EDI 862/830', file: 'ไฟล์ EDI 862 / 830 · Forecast / Orders ของลูกค้า', from: 'ลูกค้า (EDI / อีเมล)',
    cols: 'Part Number · Quantity · Date (862 มี Time/Dock เพิ่ม)', where: 'Planner & Sales › อัพโหลด (Sales)', to: '/planner-sales?tab=upload',
  },
  esmart: {
    name: 'e-SMART', file: 'ไฟล์ e-SMART (.csv / .xlsx)', from: 'พอร์ทัลลูกค้า (AAT)',
    cols: 'Base · Replenishment time stamp · Part Quantity', where: 'Customer Demand', to: '/customer-demand',
  },
  product_csv: {
    name: 'CSV สินค้า', file: 'product_template.csv', from: 'กรอกตามแม่แบบ (ปุ่ม CSV Template)',
    cols: 'name · mat_no · cycle_time_sec · … (ตามแม่แบบ)', where: 'Product Master › สินค้า', to: '/products?tab=products',
  },
  parts_csv: {
    name: 'CSV พาร์ท', file: 'parts_master_template.csv', from: 'กรอกตามแม่แบบ (ปุ่ม CSV Template)',
    cols: 'mat_no · part_name · qty_per_pkg · … (ตามแม่แบบ)', where: 'Product Master › Material Master', to: '/products?tab=parts',
  },
  sap_bom: {
    name: 'BOM (SAP CS12)', file: 'CS12 Multilevel BOM / BOM & Routing (.xls / .xlsx)', from: 'SAP',
    cols: 'Level · Component · Quantity', where: 'Product Master › BOM', to: '/products?tab=bom',
  },
  spare: {
    name: 'ทะเบียนอะไหล่', file: 'Excel / CSV ตามไฟล์ตัวอย่าง', from: 'ทีมช่าง (คลังอะไหล่)',
    cols: 'รหัส หรือ ชื่ออะไหล่ (อย่างน้อย 1) · หน่วย · ทีม · คงเหลือ …', where: 'ศูนย์อุปกรณ์ › อะไหล่', to: '/equipment?tab=spare',
  },
  pe_form: {
    name: 'ฟอร์ม PE (TSAT)', file: 'PFMEA / Control Plan / PFC ฟอร์ม TSAT (.xlsx)', from: 'PE (ไฟล์ฟอร์มเดิม)',
    cols: 'ชีทขึ้นต้นด้วยเลข OP · PFMEA เริ่มแถว 10 · Control Plan เริ่มแถว 12', where: 'PE Docs', to: '/pe-docs',
  },
  kpi_acct: {
    name: 'Monthly report บัญชี', file: 'Monthly report (.xlsx / .xlsb)', from: 'ฝ่ายบัญชี',
    cols: 'แถวหัวเดือน (Jan… / ม.ค.…) + แถวยอดขาย · COGS ฯลฯ', where: 'OBEYA › ตาราง KPI › ตัวเลขฐาน', to: '/obeya?tab=table',
  },
  /* 🤝 24/11 — ไฟล์ V5 ของ QSM (รายลูกค้า × Delivery/Quality × เดือน) · ตัวแกะ src/utils/csatImport.js · เขียน kpi_csat_scores → trigger รวมเป็น csat_* */
  kpi_csat: {
    name: 'Customer Satisfaction (V5)', file: 'TSAT 4 V5 %Customer Satisfaction FY<ปี> <เดือน> - Rev.xx.xlsx', from: 'QSM (อีเมล Update KPI Customer Satisfaction รายเดือน)',
    cols: 'ชีท STD FAC. (<ปี>) · แถว Customer · Type (Delivery/Quality) · คู่ Result/Score รายเดือน · Total Delivery/Quality · Overall', where: 'OBEYA › ตาราง KPI › ตัวเลขฐาน (ขอบเขต ทั้งโรงงาน)', to: '/obeya?tab=table',
  },
};
export const IMPORT_KEYS = Object.keys(IMPORTS);

/** ข้อความบนปุ่ม (คีย์ไทยที่ส่งเข้า `tr()`) */
export const importLabel = (k) => `นำเข้า ${IMPORTS[k]?.name || ''}`.trim();

/** ไฟล์นี้เป็นของจุดนำเข้าไหน — ดูทุกชีท · ไม่มั่นใจ = null (ห้ามเดา)
 *  @param sheets [{ name, rows }] · @param except คีย์ของจุดที่กำลังนำเข้า (ไม่ตอบตัวเอง) */
export function whichImport(sheets = [], except = '') {
  const order = ['store_stock', 'sap_mb52', 'esmart', 'edi', 'sap_bom', 'product_csv', 'parts_csv', 'spare', 'planner_monitoring', 'kpi_csat'];
  for (const k of order) {
    if (k === except) continue;
    if ((sheets || []).some(s => { try { return DETECT[k](s?.rows || []); } catch { return false; } })) return k;
  }
  return null;
}

/** ไฟล์นี้หน้าตาเป็นของจุด `k` ไหม (ใช้กับตัวอ่านที่ "หลวม" — อ่านอะไรก็ได้แถว — ให้ถามก่อนแกะ) */
export function isImportOf(k, sheets = []) {
  const fn = DETECT[k];
  if (!fn) return false;
  return (sheets || []).some(s => { try { return fn(s?.rows || []); } catch { return false; } });
}

/** ข้อความ (tab/comma) → rows แบบเดียวกับ sheet_to_json(header:1) — ให้ไฟล์ข้อความใช้ตัวตรวจชุดเดียวกัน */
export function rowsFromText(text = '') {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).slice(0, 60);
  const sep = lines.some(l => l.includes('\t')) ? '\t' : ',';
  return lines.map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim()));
}
