/* ═══ 📗 อัพโหลดไฟล์ Monitoring ของแพลนนิ่ง — ช่องทางที่ 4 ของความต้องการลูกค้า (2026-09-23) ═══
   user 23/09: *"ไฟล์ที่แพลนนิ่งบอกว่าใช้วางแผนงานรายการอื่น"* (1.Monitoring-<เดือน>.xlsx)
   ลูกค้าที่ไม่ส่ง EDI — TSPK · TSESA · TSLA · TSRA · GWM · Argen — แพลนนิ่งคุมด้วยไฟล์นี้มือ

   🔴 กติกาของจอนี้
   1. **ดูก่อนเขียนเสมอ** — กดอัพโหลดแล้วขึ้นสรุปว่าจะเขียนอะไรกี่แถว ต้องกดยืนยันอีกที
      (ไฟล์นี้แตะ 5 ตารางพร้อมกัน รวมสต็อกจริง — พลาดแล้วตามแก้ยาก)
   2. **ชีทที่แกะไม่ได้ / แถวที่ตกเลข SAP / ยอดติดลบ / บล็อกซ้ำ ต้องขึ้นจอทุกตัว ห้ามเงียบ**
   3. **ยอดคงเหลือติดลบไม่เขียนทับสต็อก** — ในไฟล์นี้แปลว่า "ยังไม่ได้ผลิต" ไม่ใช่ของติดลบ
   4. **ประวัติการส่งลง `monitoring_shipments` เท่านั้น** ห้ามลง `customer_shipping_orders`
      (/dept-dashboard กรอง due_date วันนี้/พรุ่งนี้ แล้วนับ "ส่งแล้วกี่ใบ" ⇒ ตัวเลขส่งมอบจะเฟ้อ)
   5. **LOT/Packing ไม่เขียนทับ `kanban_standards`** — ตารางนั้นมี 30 ไฟล์พึ่งพา (kanban card ·
      OEE · Heijunka · QR) · จอนี้แค่**เทียบให้เห็นว่าต่างกันตรงไหน** แล้วให้คนไปแก้เอง
      (กฎเดิมของระบบ: ระบบเสนอ คนตัดสิน)
   ═══════════════════════════════════════════════════════════════════════════════ */
import { useState, useCallback, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import fetchAllRows from '../utils/fetchAllRows';
import { parseMonitoringWorkbook, monitoringToRecords, sheetReport, stockAdjustPlan, stockSeedKept } from '../utils/monitoringSheet';
import { refStockOf, inflowDestOf } from '../utils/partRefStock';
import { buildBoardPlan, writeBoardPlan, BoardPlanPreview } from './MonitorImport';
import MatLabel from './MatLabel';
import { ImportInfo, WrongFileNote } from './ImportKit';
import { importLabel, whichImport } from '../utils/importRegistry';

import { tr } from '../utils/i18n';
/* วันที่งาน (ตัด 08:00 — งานกะดึกข้ามวันนับเป็นวันก่อนหน้า)
   ⚠️ ห้ามใช้ toISOString() — คืน UTC ทำให้วันที่เพี้ยนสำหรับไทย (กฎ Date/Time ใน CLAUDE.md)
   (ยังไม่มี util กลางของ getWorkDate — ทุกหน้าประกาศเองเหมือนกันหมด) */
const getWorkDate = () => {
  const d = new Date();
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const monthKeyOf = (d) => String(d || '').slice(0, 7);
const fmt = (n) => (Number(n) || 0).toLocaleString();
const CHUNK = 400;   // กันคำขอยาวเกินเพดาน proxy (กฎเหล็กการเขียน DB ข้อ 5)

const readStock = () => fetchAllRows(
  supabaseDR, 'line_stock_summary', 'line_name, mat_no, qty_on_hand', q => q.order('line_name').order('mat_no'));

async function insertChunked(table, rows, label) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    if (!checkWrite(await supabaseDR.from(table).insert(rows.slice(i, i + CHUNK)), label)) return false;
  }
  return true;
}

export default function MonitoringUpload({ canUpload, canBoard = true, fullName, onImported, asModal = false, onClose }) {
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(null);       // 📥 ไฟล์ของจุดนำเข้าอื่น (importRegistry) · null = ไม่รู้/ไม่ผิดช่อง
  const [preview, setPreview] = useState(null);   // { fileName, month, rec, parsed, stockPlan, kbDiff, board }
  const fileRef = useRef(null);

  /* ── อ่านไฟล์ → แกะ → เตรียมสิ่งที่จะเขียน (ยังไม่เขียน) ─────────────────── */
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setBusy(true); setPreview(null); setWrong(null);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheets = wb.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }),
      }));
      const today = getWorkDate();
      const parsed = parseMonitoringWorkbook(sheets, { asOf: today });
      if (!parsed.press.length && !parsed.customer.length) {
        /* 📥 ไฟล์ของจุดนำเข้าอื่น (เช่น Stock_Store ของสโตร์) = บอกว่าต้องไปนำเข้าที่ไหน · ไม่รู้จัก = ข้อความเดิม */
        const other = whichImport(sheets, 'planner_monitoring');
        if (other) setWrong(other);
        else toast.error('แกะไฟล์นี้ไม่ได้ — ไม่พบชีทแบบ Monitoring (ไลน์ปั๊ม / ชีทลูกค้า)');
        if (fileRef.current) fileRef.current.value = '';
        setBusy(false); return;
      }

      /* ไลน์ของพาร์ท + ยอดคงเหลือปัจจุบัน — อ่านจากทะเบียนจริง ไม่เดาในไฟล์ */
      const { data: prodRows, error: prodErr } = await fetchAllRows(
        supabaseDR, 'dr_products', 'mat_no, name, line_name, is_active, is_operation', q => q.order('mat_no'));
      if (prodErr) { toast.error(`${tr("อ่านทะเบียนสินค้าไม่สำเร็จ")}: ${prodErr.message} — ${tr("ยังไม่เขียนอะไร")}`); setBusy(false); return; }
      /* 🔴 ทะเบียนลูกค้า — ชื่อชีท (TSPK / TSESA+LA) → ลูกค้าจริง
         เดิมไม่เขียน customer เลย ⇒ ใบทั้งหมดไปกองใน "— ไม่ระบุลูกค้า —" ที่จอ 🚚 Delivery
         (แพลนนิ่งรายงาน 24/09 ว่า "ลูกค้า TSESA ไม่ขึ้น") · ไม่มีในทะเบียน = null ห้ามเดา */
      const { data: custRows, error: custErr } = await fetchAllRows(
        supabaseDR, 'customers', 'code, name, aliases, is_active', q => q.eq('is_active', true).order('code'));
      if (custErr) toast.info('อ่านทะเบียนลูกค้าไม่ได้ — ใบที่นำเข้าจะไม่มีชื่อลูกค้า (ส่วนอื่นยังนำเข้าได้)');
      const norm = (s) => String(s ?? '').replace(/[\s-]/g, '').toUpperCase();
      const lineOfMat = {}, nameOfMat = {};
      (prodRows || []).forEach(p => {
        const k = norm(p.mat_no);
        if (!k) return;
        if (p.line_name && !lineOfMat[k]) lineOfMat[k] = p.line_name;
        if (!nameOfMat[k]) nameOfMat[k] = p.name || '';
      });

      /* 📦 BALANCE ชีทไลน์ปั๊ม = ยอดผลิต ไม่ใช่ที่อยู่ของ (user 09/10) ⇒ ลงคลังตามกฎรับเข้า แบบตั้งต้นเท่านั้น
         ตัวเลือกคลัง = `refStockOf` ตัวเดียวกับจุดเรียกเติม (พาร์ทล็อตสโตร์ = ที่ไลน์ · นอกนั้นตามกฎ)
         🔴 อ่านกฎ/ล็อตไม่ได้ = **ไม่ลงยอดผลิตเลย** (ถอยไปลงที่ไลน์ = บั๊กเดิมกลับมา) */
      const [ruleR] = await Promise.all([
        supabaseDR.from('stock_inflow_rules').select('match_type, match_value, dest_line_name, is_active, mode').eq('is_active', true),
      ]);
      const stockRulesOk = !ruleR.error;
      if (!stockRulesOk) toast.info(`${tr("อ่านกฎรับเข้าคลังไม่ได้ — รอบนี้ไม่ลงยอดคงเหลือจากชีทไลน์ปั๊ม (ส่วนอื่นนำเข้าได้")}): ${ruleR.error.message}`);
      const rules = ruleR.data || [];
      const fgDest = inflowDestOf('1', rules.filter(r => r.match_type === 'prefix'));
      const stockLocOf = (mat, line) => {
        if (!stockRulesOk) return null;
        const ref = refStockOf(mat, { lineName: line, products: prodRows || [], rules });
        if (ref.kind === 'produce' && fgDest && ref.loc === fgDest) return null;   // คลัง FG = ชีทลูกค้าเป็นเจ้าของยอด
        return { loc: ref.loc, seedOnly: true };
      };

      const month = monthKeyOf(today);
      const rec = monitoringToRecords(parsed, {
        monthKey: month, today, customers: custRows || [],
        lineOfMat: (m) => lineOfMat[norm(m)] || null,
        stockLocOf,
      });
      /* 🔎 สรุปรายชีท — จอต้องบอกได้ว่าชีทไหนให้ 0 ใบ **เพราะอะไร**
         "อ่านถูกแล้วไม่มีของ" กับ "อ่านไม่ออก" หน้าตาเหมือนกันบนจอถ้าไม่แยกข้อความ */
      const bySheet = sheetReport(parsed, { today, customers: custRows || [] });

      /* สต็อก: คิดส่วนต่างจากยอดปัจจุบัน (ลง ledger เป็น adjust — ย้อนได้ ตรวจได้) */
      const { data: stkRows, error: stkErr } = await readStock();
      if (stkErr) { toast.error(`${tr("อ่านยอดคงเหลือไม่สำเร็จ")}: ${stkErr.message} — ${tr("ยังไม่เขียนอะไร")}`); setBusy(false); return; }
      const stockPlan = stockAdjustPlan(rec.stock, stkRows, norm);
      const stockKept = stockSeedKept(rec.stock, stkRows, norm);

      /* 🔴 LOT size กับ Packing **คนละเรื่อง ห้ามยุบเป็นรายการเดียว** (12/10 · คำสั่ง user)
         · **LOT size** = ขนาดล็อตผลิต — คุมว่า "สะสมครบเท่าไหร่ถึงออกใบสั่งผลิต"
           (`utils/pullAccumulator.js`) และเข้าสูตรจำนวนบัตร (`utils/kanbanCalc.js`: Total = Max + lot)
         · **Packing** = จำนวนชิ้นต่อกล่อง/ต่อบัตร — คุมการบรรจุ/ส่งของ ไม่เกี่ยวกับจังหวะเปิดใบ
         รวมเป็นแถวเดียวแล้วนับ "47 พาร์ทไม่ตรง" = ตอบไม่ได้ว่าต้องไปคุยกับใครเรื่องอะไร
         และเรื่องหนึ่งที่ยังตกลงไม่ได้ ไปค้างอีกเรื่องที่ชัดอยู่แล้ว ⇒ แยกเป็น 3 กอง ตัดสินแยกกัน
         (เทียบอย่างเดียว ไม่เขียนทับทะเบียน — ทะเบียนนี้ใช้ร่วมกับบัตรคานบัง/OEE/Heijunka/ป้าย QR) */
      const { data: kbRows, error: kbErr } = await fetchAllRows(
        supabaseDR, 'kanban_standards', 'mat_no, qty_per_kanban, lot_size', q => q.order('mat_no'));
      if (kbErr) toast.info('อ่านทะเบียน kanban ไม่ได้ — ข้ามการเทียบ LOT/Packing (ส่วนอื่นยังนำเข้าได้)');
      const kb = {};
      (kbRows || []).forEach(k => { kb[norm(k.mat_no)] = k; });
      const kbDiff = { lot: [], pack: [], noStd: [] };
      rec.lots.forEach(l => {
        const cur = kb[norm(l.mat_no)];
        if (!cur) { kbDiff.noStd.push(l); return; }
        if (l.lot_size != null && Number(cur.lot_size) !== l.lot_size) {
          kbDiff.lot.push({ ...l, file: l.lot_size, std: cur.lot_size });
        }
        if (l.qty_per_kanban != null && Number(cur.qty_per_kanban) !== l.qty_per_kanban) {
          kbDiff.pack.push({ ...l, file: l.qty_per_kanban, std: cur.qty_per_kanban });
        }
      });

      /* 🔴 ชั้นบอร์ด (ตาราง 13 ชีท) แกะจาก `sheets` ชุดเดียวกัน — อ่านไฟล์ครั้งเดียว เขียนครั้งเดียว
         (08/10 คำสั่ง user: *"จุดอัพโหลดควรมีจุดเดียวแล้วโปรแกรมใช้ด้วยกัน"*) */
      const board = buildBoardPlan(sheets, { today });
      setPreview({ fileName: file.name, month, parsed, rec, stockPlan, stockKept, kbDiff, nameOfMat, norm, today, bySheet, board });
    } catch (e) {
      toast.error(`${tr("อ่านไฟล์ไม่สำเร็จ")}: ${e.message}`);
    }
    setBusy(false);
  }, []);

  /* ── เขียนจริง (หลังกดยืนยัน) ────────────────────────────────────────────── */
  const doImport = useCallback(async () => {
    if (!preview) return;
    const { rec, month, stockPlan, nameOfMat, norm, today, board } = preview;
    setBusy(true);
    const by = fullName || 'Monitoring import';
    let ok = true;

    /* ⓪ ตารางบอร์ด 13 ชีท — เขียนก่อน เพราะชั้นนี้ไม่ลบอะไร (ล้ม = หยุด ยังไม่แตะชั้นที่ลบของเก่า) */
    let boardRes = null;
    if (canBoard && board?.made?.length) {
      boardRes = await writeBoardPlan(board.made, { fullName });
      if (!boardRes.ok) {
        setBusy(false);
        toast.error('เขียนตารางบอร์ดไม่สำเร็จ — ยังไม่แตะ Forecast/ออเดอร์/สต็อก กดยืนยันใหม่ได้เลย');
        return;
      }
    }

    // ① FC รายเดือน — ลบของรอบก่อนของเดือนนี้ก่อน (อัพซ้ำได้ ไม่เกิดแถวซ้ำ)
    ok = ok && checkWrite(await supabaseDR.from('customer_forecasts')
      .delete().eq('source', 'monitoring').eq('period_month', `${month}-01`), 'ล้าง forecast รอบก่อน');
    if (ok && rec.forecasts.length) {
      ok = await insertChunked('customer_forecasts', rec.forecasts.map(f => ({
        mat_no: f.mat_no, part_name: f.part_name || null, customer_part_no: f.customer_part_no,
        customer: f.customer || null,
        period_month: f.period_month, qty: f.qty, source: 'monitoring', note: f.note,
      })), 'บันทึก forecast');
    }

    // ② ออเดอร์ล่วงหน้า — เฉพาะดิวตั้งแต่วันนี้ไป (ดิวเก่าเป็นประวัติ ไม่ใช่ backlog)
    const future = rec.orders.filter(o => !o.past);
    /* 🔴 ลบ+ใส่ ต้องอยู่ใน transaction เดียว ⇒ ผ่าน RPC `fn_monitoring_orders_replace` (16/11)
       เดิมเป็น **2 คำขอแยกกัน**: ถ้าตัวใส่ล้มหลังตัวลบสำเร็จ (เน็ตสะดุด/ไฟล์ใหญ่)
       **ออเดอร์หายทั้งชุด ไม่มีอะไรย้อนให้** — จอขึ้นว่าบันทึกไม่สำเร็จ แต่ของเดิมหายไปแล้ว
       (ร้ายกว่านั้น: `shipping_phase_alerts` ผูก FK `on delete cascade` = หายตามไปด้วย)
       และ RPC ปิด audit รายแถวในตัว แล้วเขียน **audit สรุป 1 แถว** (`BULK_REPLACE`) แทน N แถว
       — ตารางนี้กิน **28.2% ของ `audit_log` ทั้งตาราง** เพราะลบทั้งชุดแล้วเขียนใหม่ทุกรอบอัปโหลด
       ⚠️ ส่งทั้งก้อนในคำขอเดียว (แบ่ง chunk ไม่ได้ ไม่งั้นหมดความเป็น transaction เดียว)
          — ไฟล์ปกติหลักร้อยถึงพันแถว ≈ ไม่กี่ร้อย KB · ถ้าวันหนึ่งไฟล์ใหญ่กว่านี้มาก
          ต้องเปลี่ยนไปใช้ staging table ฝั่ง DB ไม่ใช่กลับไปแบ่ง chunk */
    if (ok) {
      const { data: repRows, error: eRep } = await supabaseDR.rpc('fn_monitoring_orders_replace', {
        p_rows: future.map(o => ({
          mat_no: o.mat_no, part_name: o.part_name || nameOfMat[norm(o.mat_no)] || null,
          customer: o.customer || null, customer_part_no: o.customer_part_no,
          due_date: o.due_date, qty: o.qty, note: o.note,
        })),
        p_by: by,
      });
      ok = checkWrite({ error: eRep }, 'บันทึกออเดอร์');
      /* 🔴 RPC ตัดแถวที่ไม่มีรหัส/ไม่มีดิวทิ้ง (ใส่ไม่ได้อยู่ดี — คอลัมน์เป็น NOT NULL)
         แต่ **ตัดแล้วต้องบอก ห้ามเงียบ** ไม่งั้นคนอัปโหลดเข้าใจว่าเข้าครบ */
      const inserted = Array.isArray(repRows) ? (repRows[0]?.inserted ?? null) : null;
      if (ok && inserted != null && inserted < future.length) {
        toast.info(`⚠️ ${tr("ออเดอร์เข้า")} ${inserted} ${tr("จาก")} ${future.length} ${tr("แถว")} — ${future.length - inserted} ${tr("แถวไม่มีรหัสพาร์ทหรือไม่มีวันดิว")}`);
      }
    }

    // ③ ประวัติการส่ง → ตารางของตัวเอง (ห้ามปนกับใบส่งของ)
    /* 🔴 `sheet` ห้ามส่ง null — เป็นส่วนหนึ่งของคีย์ upsert ซึ่งต้องเป็น **คอลัมน์ล้วน**
       (คอลัมน์ฝั่ง DB เป็น NOT NULL DEFAULT '' โดยเจตนา · ดู migration 20261006) */
    const hist = [
      ...rec.shipped.filter(s => s.due_date < today)
        .map(s => ({ mat_no: s.mat_no, ship_date: s.due_date, qty: s.qty, kind: 'out', sheet: s.sheet || '' })),
      ...rec.orders.filter(o => o.past)
        .map(o => ({ mat_no: o.mat_no, ship_date: o.due_date, qty: o.qty, kind: 'requirement',
                     sheet: (String(o.note || '').split('·')[1] || '').trim() })),
    ];
    const seen = new Set(), histUniq = [];
    hist.forEach(h => {
      const k = `${h.mat_no}|${h.ship_date}|${h.kind}|${h.sheet}`;
      if (seen.has(k)) return;
      seen.add(k); histUniq.push({ ...h, created_by_name: by });
    });
    if (ok && histUniq.length) {
      for (let i = 0; i < histUniq.length && ok; i += CHUNK) {
        ok = checkWrite(await supabaseDR.from('monitoring_shipments')
          .upsert(histUniq.slice(i, i + CHUNK), { onConflict: 'mat_no,ship_date,kind,sheet', ignoreDuplicates: true }),
          'บันทึกประวัติการส่ง');
      }
    }

    // ④ MIN/MAX ต่อไลน์
    if (ok && rec.levels.length) {
      const lv = rec.levels.map(l => ({
        line_name: l.line_name, mat_no: l.mat_no, min_qty: l.min_qty,
        max_qty: l.max_qty != null && l.max_qty >= l.min_qty ? l.max_qty : null,
        note: l.note, updated_by_name: by,
      }));
      for (let i = 0; i < lv.length && ok; i += CHUNK) {
        ok = checkWrite(await supabaseDR.from('line_part_levels')
          .upsert(lv.slice(i, i + CHUNK), { onConflict: 'line_name,mat_no' }), 'บันทึก MIN/MAX');
      }
    }

    // ⑤ สต็อกให้ตรงชีท — ลง ledger เป็น adjust (ไม่ลบของเก่า ย้อนได้)
    /* 🔴 QC 05/10 — คิดส่วนต่างใหม่จากยอด "ณ ตอนกดยืนยัน" ไม่ใช้ส่วนต่างตอนพรีวิว
       เดิม: กดยืนยันรอบแรก adjust ลงไปบางก้อนแล้วล้ม → กดซ้ำ = ลงส่วนต่างเดิมซ้ำทั้งชุด (ยอดเพี้ยน 2 เท่า)
       + ระหว่างพรีวิวค้างไว้ มีใบปิด/จ่ายของเข้ามา ⇒ ส่วนต่างเก่าไม่ตรงอีกต่อไป
       ตอนนี้: อ่านสต็อกสด → ที่ลงไปแล้วจะได้ส่วนต่าง 0 (ข้ามเอง) ⇒ อัพซ้ำ/กดซ้ำไม่ซ้อนจริง */
    let stockDone = 0;
    if (ok && stockPlan.length) {
      const { data: freshStk, error: freshErr } = await readStock();
      if (freshErr) { toast.error(`${tr("อ่านยอดคงเหลือล่าสุดไม่สำเร็จ — ยังไม่ปรับสต็อก")}: ${freshErr.message}`); ok = false; }
      const plan = ok ? stockAdjustPlan(stockPlan, freshStk, norm) : [];
      stockDone = plan.length;
      const tx = plan.map(s => ({
        line_name: s.line_name, mat_no: s.mat_no, part_name: s.part_name || nameOfMat[norm(s.mat_no)] || null,
        qty: s.delta, type: 'adjust', work_date: today, status: 'approved',
        note: `${tr("ตั้งยอดให้ตรงไฟล์")} Monitoring ${s.sheet} (${tr("ก่อนหน้า")} ${s.have} → ${s.qty})`,
        created_by: by, reviewed_by: by, reviewed_at: new Date().toISOString(),
      }));
      if (ok && tx.length) ok = await insertChunked('line_stock_transactions', tx, 'ปรับยอดสต็อก');
    }

    setBusy(false);
    /* 🔴 QC 05/10 — ข้อความเดิม "อัพซ้ำได้ ไม่เกิดแถวซ้ำ" ไม่จริงสำหรับสต็อก (ลงส่วนต่างพรีวิวซ้ำ = ซ้อน)
       ตอนนี้จริงแล้ว (สต็อกคิดส่วนต่างจากยอดสด · FC/ออเดอร์ล้างของรอบก่อนแล้วลงใหม่ · ประวัติ/MIN upsert)
       แต่ต้องบอกด้วยว่า **ระหว่างนี้ข้อมูลบางขั้นหายไปแล้ว** (FC/ออเดอร์ถูกล้างก่อนลงใหม่) — ห้ามปล่อยค้าง */
    if (!ok) { toast.error('นำเข้าไม่ครบ — ข้อมูลบางขั้น (Forecast/ออเดอร์) อาจถูกล้างไปแล้วแต่ยังลงใหม่ไม่ครบ: กดยืนยันนำเข้าอีกครั้ง (ขั้นที่ลงไปแล้วจะถูกแทนที่ · สต็อกคิดส่วนต่างจากยอดล่าสุด จึงไม่ซ้อน)'); return; }
    toast.success((boardRes ? `${tr("นำเข้าสำเร็จ — บอร์ด")} ${boardRes.boardsN} (${fmt(boardRes.partsN)} ${tr("พาร์ท")}) · ` : 'นำเข้าสำเร็จ — ')
      + `FC ${rec.forecasts.length} · ${tr("ออเดอร์")} ${future.length} · ${tr("ประวัติ")} ${histUniq.length} · MIN ${rec.levels.length} · ${tr("สต็อก")} ${stockDone}`
      + (stockDone < stockPlan.length ? ` (${tr("อีก")} ${stockPlan.length - stockDone} ${tr("รายการตรงไฟล์อยู่แล้ว")})` : ''));
    /* ซ้ำในไฟล์ที่ค่าไม่ตรงกัน = ไฟล์ขัดกันเอง ต้องให้คนไปดู ห้ามกลืน */
    if (boardRes?.conflictParts || boardRes?.conflictCells) {
      toast.error(`⚠️ ${tr("ของซ้ำในไฟล์ที่ค่าไม่ตรงกัน")} ${fmt(boardRes.conflictParts)} ${tr("พาร์ท")} · ${fmt(boardRes.conflictCells)} ${tr("ช่อง")}`
        + (' — ' + tr('ระบบใช้ค่าของบล็อกล่างสุด ให้ทีมวางแผนตรวจไฟล์')));
    }
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
    onImported?.();
  }, [preview, fullName, onImported, canBoard]);

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 };
  const warnBox = (bg, bd) => ({ ...card, background: bg, border: `1px solid ${bd}`, marginTop: 12 });

  const body = (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>📥 {tr(importLabel('planner_monitoring'))}</div>
        <div style={{ marginBottom: 10 }}><ImportInfo k="planner_monitoring" /></div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
          {tr("ไฟล์")} <b>1.Monitoring-&lt;เดือน&gt;.xlsx</b> {tr('— ลูกค้าที่ไม่ได้ส่ง EDI (TSPK · TSESA · TSLA · TSRA · GWM · Argen)')}<br />
          {tr("ระบบจะอ่าน")}: <b>{tr('ตารางบอร์ดของทุกชีท')}</b> · <b>{tr('FC รายเดือน')}</b> · <b>MIN/MAX</b> ·
          <b>{tr('ออเดอร์ล่วงหน้า')}</b>{tr('ของชีทลูกค้า/Argen ·')} <b>{tr('ยอดคงเหลือ')}</b> · <b>{tr('ประวัติการส่ง')}</b>
          — {tr("แล้วขึ้นสรุปให้ตรวจก่อนเขียนเสมอ")}
          <div style={{ marginTop: 6, color: 'var(--muted)' }}>
            ⏱️ {tr("ยอดคงเหลืออ่าน")} <b>{tr('ณ วันที่')} {getWorkDate()}</b> · {tr("ช่องวันอนาคตในไฟล์เป็นยอดพยากรณ์ ไม่ใช่ของจริง")}
          </div>
          {/* 🔴 จุดอัพโหลดมีจุดเดียว เขียนครบทุกชั้นในครั้งเดียว (08/10 คำสั่ง user) — ห้ามแยกกลับเป็น 2 ปุ่ม */}
          <div style={{ marginTop: 6, color: 'var(--text2)' }}>
            ✅ <b>{tr('อัพที่นี่ครั้งเดียวจบ')}</b> {tr('— ระบบลงให้ครบทั้ง')} <b>{tr('ตารางบอร์ด 13 ชีท')}</b> ({tr("หน้า Monitoring แผน-สต๊อก) และ")} <b>{tr('ตัวเลขที่เอาไปใช้ต่อ')}</b> ({tr("แผนผลิต · Delivery · คานบัง) ในการกดยืนยันครั้งเดียว")}
          </div>
        </div>
        {!canUpload && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--amber)' }}>
            ⚠️ {tr("บัญชีนี้ไม่มีสิทธิ์อัพโหลด (ขอสิทธิ์")} <code>demand:upload</code> {tr("ที่หน้าจัดการสิทธิ์")})
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xlsb,.xls" disabled={!canUpload || busy}
                 onChange={e => handleFile(e.target.files?.[0])}
                 style={{ width: 'auto', fontSize: 13 }} />
          {busy && <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--muted)' }}>{tr('กำลังอ่าน…')}</span>}
        </div>
        {wrong && <div style={{ marginTop: 10 }}><WrongFileNote k={wrong} here="planner_monitoring" onGo={onClose} /></div>}
      </div>

      {preview && <PreviewPanel p={preview} canBoard={canBoard}
                                onCancel={() => { setPreview(null); if (fileRef.current) fileRef.current.value = ''; }}
                                onConfirm={doImport} busy={busy} card={card} warnBox={warnBox} />}
    </div>
  );

  /* 🔴 ไม่ปิดจาก backdrop (UI-CONVENTIONS §5) — เผลอแตะพื้นหลังแล้วต้องเลือกไฟล์+ตรวจสรุปใหม่ทั้งชุด */
  if (!asModal) return body;
  return (
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(900px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} aria-label={tr('ปิด')} title={tr('ปิด')}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 2 }}>✕</button>
        </div>
        {body}
      </div>
    </div>
  );
}

function PreviewPanel({ p, canBoard, onCancel, onConfirm, busy, card, warnBox }) {
  const { rec, parsed, stockPlan, kbDiff, month, fileName, bySheet } = p;
  const future = rec.orders.filter(o => !o.past);
  const past = rec.orders.length - future.length;
  const histCount = rec.shipped.filter(s => s.due_date < p.today).length + past;
  const boardMade = p.board?.made || [];
  const boardParts = boardMade.reduce((a, b) => a + b.parts.length, 0);
  const rows = [
    ['🗂️ ตารางบอร์ด (13 ชีท)',
      canBoard ? `${boardMade.length} ${tr("บอร์ด")} · ${fmt(boardParts)} ${tr("พาร์ท")}` : '— ไม่มีสิทธิ์ ข้ามส่วนนี้',
      canBoard ? 'หน้า Monitoring แผน-สต๊อก — นำเข้าซ้ำ = อัพเดทบอร์ดเดิม' : 'ต้องมีสิทธิ์ monitoring:manage'],
    ['📈 Forecast', `${rec.forecasts.length} ${tr("แถว")} · ${fmt(rec.forecasts.reduce((s, r) => s + r.qty, 0))} ${tr("ชิ้น")}`, `${tr("เดือน")} ${month} — ${tr("เขียนทับรอบก่อนของเดือนนี้")}`],
    ['🚚 ออเดอร์ล่วงหน้า', `${future.length} ${tr("แถว")} · ${fmt(future.reduce((s, r) => s + r.qty, 0))} ${tr("ชิ้น")}`, 'ดิวตั้งแต่วันนี้ไป — เขียนทับรอบก่อน'],
    ['📜 ประวัติการส่ง', `${histCount} ${tr("แถว")}`, 'ลงตารางประวัติ ไม่ใช่ใบส่งของ · อัพซ้ำไม่เกิดแถวซ้ำ'],
    ['📉 MIN/MAX', `${rec.levels.length} ${tr("พาร์ท")}`, 'ต่อไลน์ — ทับค่าเดิมของพาร์ทนั้น'],
    ['📦 ปรับยอดสต็อก', `${stockPlan.length} ${tr("รายการ")}`,
      tr('ลงเป็นรายการ adjust (ไม่ลบของเก่า ย้อนได้) · ยอดจากชีทไลน์ปั๊มลงคลังตามกฎ (STORE ฯลฯ) ไม่ใช่ที่ไลน์')
      + ((p.stockKept || []).length ? ` · ${tr("ไม่ทับ")} ${p.stockKept.length} ${tr("พาร์ทที่คลังมียอดในระบบแล้ว")}` : '')
      + (rec.pressStockSkipped ? ` · ${tr("ข้าม")} ${rec.pressStockSkipped} ${tr("พาร์ท FG (ยอดคลัง FG มาจากชีทลูกค้า")})` : '')],
  ];
  return (
    <div style={{ ...card, borderColor: 'var(--accent)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
        {tr("ตรวจก่อนเขียน")} — <span style={{ color: 'var(--accent)' }}>{fileName}</span>
      </div>
      {/* 🔎 สรุปรายชีท — บังคับโชว์เสมอ (24/09)
          เดิมบอกแค่ยอดรวม "ออเดอร์ 232 ใบ" ⇒ คนเข้าใจว่าครบทุกลูกค้า
          ความจริงคือ TSESA ให้ 0 ใบ เพราะชีทยังเป็นรอบ ก.ค.-ส.ค. — ไม่มีอะไรบนจอบอกเลย */}
      <div style={{ overflowX: 'auto', marginBottom: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
          <thead><tr>
            {[tr("ชีท"), tr("ชนิด"), tr("ลูกค้า"), tr("พาร์ท"), tr("ออเดอร์"), tr("ถึงวันที่")].map((h, i) => (
              <th key={h} style={{ textAlign: i >= 3 ? 'right' : 'left', padding: '4px 8px', fontSize: 11,
                                   color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{tr(h)}</th>
            ))}
          </tr></thead>
          <tbody>
            {(bySheet || []).map(r => (
              <tr key={r.sheet + r.kind}>
                <td style={{ padding: '4px 8px', fontSize: 12, fontWeight: 700, borderBottom: '1px solid var(--border2)' }}>
                  {r.sheet}
                  {r.note && <div style={{ fontWeight: 400, fontSize: 11, color: 'var(--amber)', whiteSpace: 'normal' }}>⚠️ {r.note}</div>}
                </td>
                <td style={{ padding: '4px 8px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border2)' }}>{r.kind}</td>
                <td style={{ padding: '4px 8px', fontSize: 12, borderBottom: '1px solid var(--border2)',
                             color: r.customer ? 'var(--text)' : 'var(--muted)' }}>
                  {r.customer || (r.kind === 'ลูกค้า' ? tr("— ไม่มีในทะเบียน —") : '—')}
                </td>
                <td style={{ padding: '4px 8px', fontSize: 12, textAlign: 'right', borderBottom: '1px solid var(--border2)' }}>{r.parts}</td>
                <td style={{ padding: '4px 8px', fontSize: 12, textAlign: 'right', fontWeight: 700,
                             color: r.orders ? 'var(--accent)' : '#ef4444', borderBottom: '1px solid var(--border2)' }}>
                  {r.orders ? `${r.orders} ${tr("ใบ")} · ${r.orderQty.toLocaleString()}` : tr("0 ใบ")}
                </td>
                <td style={{ padding: '4px 8px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap',
                             color: r.staleDays > 0 ? '#f59e0b' : 'var(--muted)', borderBottom: '1px solid var(--border2)' }}>
                  {r.lastDate || '—'}{r.staleDays > 0 ? ` (−${r.staleDays} ${tr("วัน")})` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {parsed.skipped?.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
          {tr("ชีทที่ข้าม (ไม่ใช่รูปแบบ")} Monitoring): {parsed.skipped.join(' · ')}
        </div>
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(([t, v, note]) => (
          <div key={t} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1fr) minmax(140px,1fr) 2fr',
                                gap: 8, fontSize: 12, padding: '6px 8px', background: 'var(--bg2)', borderRadius: 'var(--r-md)' }}>
            <b>{t}</b><span>{v}</span><span style={{ color: 'var(--muted)' }}>{note}</span>
          </div>
        ))}
      </div>

      {/* ── สิ่งที่ "ไม่" เขียน ต้องบอกให้ครบ ห้ามเงียบ ── */}
      {!!parsed.skipped.length && (
        <div style={warnBox('#78350f22', '#f59e0b')}>
          <b style={{ fontSize: 12 }}>{tr('⚠️ ชีทที่อ่านไม่ได้')} {parsed.skipped.length} {tr('ชีท — ไม่ถูกนำเข้า')}</b>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{parsed.skipped.join(' · ')}</div>
        </div>
      )}
      {!!parsed.warnings.length && (
        <div style={warnBox('#78350f22', '#f59e0b')}>
          <b style={{ fontSize: 12 }}>{tr('⚠️ ข้อมูลในไฟล์ไม่ครบ')}</b>
          <ul style={{ fontSize: 12, color: 'var(--text2)', margin: '4px 0 0', paddingLeft: 18 }}>
            {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      {!!rec.stockNegative?.length && (
        <div style={warnBox('#7f1d1d22', '#ef4444')}>
          <b style={{ fontSize: 12, color: 'var(--red)' }}>{tr('ยอดคงเหลือติดลบ')} {rec.stockNegative.length} {tr('พาร์ท — ไม่เอาไปตั้งยอดสต็อก')}</b>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
            {tr("ในไฟล์นี้ยอดติดลบแปลว่า")} <b>{tr('ความต้องการที่ยังไม่ได้ผลิต')}</b> {tr("ไม่ใช่ของติดลบในคลัง — เขียนทับสต็อกจริงไม่ได้ · ตัวอย่าง")}: {rec.stockNegative.slice(0, 5).map(s => `${s.mat_no} (${fmt(s.qty)})`).join(' · ')}
          </div>
        </div>
      )}
      {!!rec.orderDupes && (
        <div style={warnBox('#78350f22', '#f59e0b')}>
          <b style={{ fontSize: 12 }}>{tr('บล็อกซ้ำในไฟล์')} {rec.orderDupes} {tr('แถว — ยุบให้แล้ว')}</b>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
            {tr("พาร์ทเดียวถูกเขียนไว้หลายบล็อกในชีทเดียวกัน · ถ้าไม่ยุบ ความต้องการจะกลายเป็น 2 เท่า")}
          </div>
        </div>
      )}
      {/* 🔴 พาร์ทซ้ำของ Forecast/MIN-MAX ต้องบอกเสมอ — ค่าไม่ตรงกัน = ไฟล์ต้นทางมีปัญหา คนต้องรู้ */}
      {!!(rec.forecastDupes || rec.levelDupes) && (
        <div style={warnBox('#78350f22', '#f59e0b')}>
          <b style={{ fontSize: 12 }}>
            {tr("พาร์ทซ้ำ")} — Forecast {rec.forecastDupes} {tr('แถว · MIN/MAX')} {rec.levelDupes} {tr("แถว — ยุบให้แล้ว (เอาค่ามากสุด ไม่บวกกัน")})
          </b>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
            {tr("พาร์ทเดียวเขียนหลายบรรทัด (เช่น 300T MAT 20059152 คว่ำครีบ/หงายครีบ — FC เดือนเป็นของพาร์ทเดียวกัน) · ไม่ยุบ = ยอดพยากรณ์ 2 เท่า และ MIN/MAX เขียนไม่ลงทั้งก้อน")}
            {!!(rec.forecastConflicts || rec.levelConflicts) && (
              <div style={{ color: 'var(--amber)', fontWeight: 700, marginTop: 4 }}>
                ⚠️ {tr("ในนั้น")} <b>{tr('ค่าไม่ตรงกัน')} {rec.forecastConflicts + rec.levelConflicts} {tr('คู่')}</b> — {tr("ระบบเลือกค่ามากสุดให้ก่อน แต่ควรไปแก้ไฟล์ต้นทางให้เหลือค่าเดียว")}
              </div>
            )}
          </div>
        </div>
      )}
      {/* 🔴 LOT size กับ Packing แยกกองกัน — คนละเรื่อง คนละคนตัดสิน (12/10 · คำสั่ง user)
          ห้ามยุบกลับเป็นตารางเดียวที่นับรวม "N พาร์ทไม่ตรง" */}
      {(!!kbDiff.lot.length || !!kbDiff.pack.length || !!kbDiff.noStd.length) && (
        <div style={warnBox('#1e3a8a22', '#60a5fa')}>
          <b style={{ fontSize: 12 }}>{tr('เทียบกับทะเบียน kanban —')} <u>{tr('ระบบไม่แก้ให้')}</u></b>
          <div style={{ fontSize: 12, color: 'var(--text2)', margin: '4px 0 8px' }}>
            {tr("ทะเบียน kanban ใช้ร่วมกับบัตรคานบัง · OEE · Heijunka · ป้าย QR — เขียนทับอัตโนมัติกระทบกว้างเกินไป ให้ไปแก้เองที่")} <b>/products → 🎴 Kanban Std</b> {tr("ถ้ายืนยันว่าค่าในไฟล์ถูกกว่า")}
          </div>
          <KbDiffTable
            title={`LOT size ${tr("ไม่ตรง")} ${kbDiff.lot.length} ${tr("พาร์ท")}`}
            why={tr("ขนาดล็อตผลิต — คุมว่าสะสมครบเท่าไหร่ถึงออกใบสั่งผลิต + เข้าสูตรจำนวนบัตร")}
            rows={kbDiff.lot} />
          <KbDiffTable
            title={`Packing ${tr("ไม่ตรง")} ${kbDiff.pack.length} ${tr("พาร์ท")}`}
            why={tr("จำนวนชิ้นต่อกล่อง/ต่อบัตร — คุมการบรรจุและการส่ง ไม่เกี่ยวกับจังหวะเปิดใบผลิต")}
            rows={kbDiff.pack} />
          {!!kbDiff.noStd.length && (
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 8 }}>
              ⚪ <b>{tr('ยังไม่มีในทะเบียน kanban')} {kbDiff.noStd.length} {tr('พาร์ท')}</b> —
              {' '}{kbDiff.noStd.slice(0, 8).map(l => l.mat_no).join(' · ')}
              {kbDiff.noStd.length > 8 ? ` … ${tr("อีก")} ${kbDiff.noStd.length - 8}` : ''}
              <div style={{ color: 'var(--muted)' }}>{tr("คนละเรื่องกับ \"ไม่ตรง\" — ตัวนี้คือยังไม่เคยตั้งค่าเลย")}</div>
            </div>
          )}
        </div>
      )}
      {/* 🗂️ ส่วนตารางบอร์ด — รายชีท + ชีทที่ยกไม่ได้ (ตัววาดเดียวกับที่ `MonitorImport` เคยใช้) */}
      {canBoard && !!boardMade.length && (
        <div style={{ ...warnBox('var(--bg2)', 'var(--border)') }}>
          <b style={{ fontSize: 12 }}>{tr('ตารางบอร์ด —')} {boardMade.length} {tr('บอร์ด ·')} {fmt(boardParts)} {tr('พาร์ท')}</b>
          <div style={{ fontSize: 11, color: 'var(--muted)', margin: '3px 0 7px' }}>
            {tr("คือตารางที่เห็นในหน้า")} <b>{tr('Monitoring แผน-สต๊อก')}</b> · {tr("นำเข้าซ้ำ = อัพเดทบอร์ดเดิม ไม่สร้างซ้ำ")}
          </div>
          <BoardPlanPreview made={boardMade} skipped={p.board?.skipped || []} />
        </div>
      )}
      {!!past && (
        <div style={{ ...warnBox('var(--bg2)', 'var(--border)'), fontSize: 12, color: 'var(--text2)' }}>
          ℹ️ {tr("ความต้องการที่ดิวเก่ากว่าวันนี้")} <b>{past} {tr('แถว')}</b> {tr('ถูกเก็บเป็น')}<b>{tr('ประวัติ')}</b> {tr("ไม่ใช่งานค้างส่ง — ไม่งั้นแผนรายวันจะขึ้น backlog ปลอมก้อนใหญ่ในวันแรก")}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={onConfirm} disabled={busy}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 700, borderRadius: 'var(--r-md)',
                         background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none', cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? tr('กำลังเขียน…') : tr('✔ ยืนยันนำเข้า (ลงให้ครบทุกส่วนในครั้งเดียว)')}
        </button>
        <button onClick={onCancel} disabled={busy}
                style={{ padding: '8px 16px', fontSize: 13, borderRadius: 'var(--r-md)', background: 'var(--bg3-surf)',
                         color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer' }}>
          {tr('ยกเลิก')}
        </button>
      </div>
    </div>
  );
}

/** ตารางเทียบ "ค่าในไฟล์ vs ทะเบียน" ของ **เรื่องเดียว** — LOT กับ Packing ใช้คนละตัว
 *  (ยุบ 2 เรื่องเป็นตารางเดียว = ตัวเลขรวมตอบไม่ได้ว่าต้องไปคุยกับใครเรื่องอะไร) */
function KbDiffTable({ title, why, rows = [] }) {
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <b style={{ fontSize: 12 }}>{title}</b>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>{why}</div>
      <div style={{ maxHeight: 150, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          {/* ลำดับบนจอ = Part No. → Part Name → MAT SAP (UI §ลำดับ MAT · มีด่าน) ⇒ ใช้ <MatLabel> วาดให้ */}
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
            <th>{tr('พาร์ท')}</th><th style={{ textAlign: 'right' }}>{tr('ในไฟล์')}</th><th style={{ textAlign: 'right' }}>{tr('ในทะเบียน')}</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, 40).map((l, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border2)' }}>
                <td><MatLabel mat={l.mat_no} name={l.part_name} size={11} /></td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(l.file)}</td>
                <td style={{ textAlign: 'right' }}>{l.std == null ? tr('— ยังไม่ตั้ง') : fmt(l.std)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 40 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{tr('… อีก')} {rows.length - 40} {tr('พาร์ท')}</div>}
      </div>
    </div>
  );
}
