/* ══ 📦 เรียกชิ้นส่วนจากสโตร์ — ฝั่งไลน์ผลิต ═══════════════════════════════════════
   docs/STORE-PULL-LOOP-DESIGN.md · workflow ที่ user เขียนเอง (2026-08-27) ขั้น 3-4 + 8

   ทำไมอยู่ใน Daily Report ไม่ใช่หน้าใหม่:
     หัวหน้ากลุ่มอยู่หน้านี้ทั้งกะ — เดิมการเรียกของเกิดใน LINE chat เพราะระบบไม่มีที่ให้กด
     (เหตุผลเดียวกับ StoreLotQueue ที่เอาคิวสโตร์มาไว้หน้านี้)

   ⚠️⚠️ กฎเหล็กของแผงนี้ (ห้ามแก้ให้ "ง่ายขึ้น"):
   1. **ระบบเสนอ คนกดยืนยัน** — ห้าม auto-สร้างใบเบิก (กฎเดิมทั้งโปรเจค)
   2. **"ไม่เบิก" = hold ไม่ใช่ reject** — ความต้องการยังอยู่ ต้องกลับมาเตือนได้เอง
      **hold ต้องเห็นบนจอเสมอ** พร้อมเหตุผล+เวลา · ของที่ถูกพักแล้วมองไม่เห็น
      คือต้นเหตุ "ลืมเบิกจนไลน์หยุด" ที่ระบบนี้มีไว้กัน
      (precedent: ใบ 4M ที่ถูกตีกลับต้องขึ้นชิป ✏️ ต้องแก้ ไม่ใช่หายเงียบ)
   3. **`requested_at` stamp ตอนคนกดยืนยัน ไม่ใช่ตอนระบบเสนอ** — ไม่งั้น lead time
      รวมเวลาที่หัวหน้ายังไม่ตัดสินใจ = โทษสโตร์ทั้งที่ยังไม่ถึงคิวเขา
   4. **ไม่ตั้ง min = ไม่เสนอ** (ไม่เดาให้) แต่ต้องขึ้น worklist ว่าพาร์ทไหนยังไม่ตั้ง
   5. **โหลดไม่สำเร็จ = ขึ้นแถบเตือน ห้ามแสดงเป็น "ไม่มีอะไรต้องเบิก"**

   ⚠️ "แจ้งเตือนถึง min เข้า Telegram" (ขั้น 3 เต็มรูป) ต้องมี scanner ฝั่ง server ถึงจะยิงได้
      ตอนไม่มีใครเปิดหน้า — ยังไม่ทำ · เฟสนี้สัญญาณอยู่บน "จอที่หัวหน้าเปิดอยู่แล้วทั้งกะ"
      ส่วน `wip_request_placed` (ไลน์กดเบิก → บอกสโตร์) ยิงจริงตั้งแต่เฟสนี้

   ⚠️ 2026-09-07: สโตร์ยืนยันเตรียม (ขั้น 5) = ตัดสต็อกให้แล้ว (STORE −qty · ไลน์ +qty) — แผงนี้ไม่แตะ ledger
   ตารางที่แตะ: line_part_levels (DR) · line_stock_summary (DR) · wip_replenish_requests (Main)
   ⚠️ ใบขอเติมอยู่ **Main** ส่วนสต็อกอยู่ **DR** — คนละ client อย่าสลับ
═══════════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { loadStorageLocations } from '../utils/useStorageLocations';
import { loadDeliveryPoints, deliveryPointsOfLine } from '../utils/useDeliveryPoints';
import { loadProductsMaster } from '../utils/useProducts';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { isLeafLine, getChildLineNames, getAncestorNames } from '../utils/lineHierarchy';
import { notifyEvent } from '../utils/notifyEvent';
import { getActor } from '../utils/actorStamp';
import { getWorkDate } from '../utils/workDate';   // 👤 "ใครเรียก" — ที่เดียวของตัวตนผู้ทำรายการ
import { pointsForLine, DELIVER_GATES, unreceivedAge } from '../utils/replenishGate';
import MatLabel from './MatLabel';
import { slocCodeOfLine } from '../utils/storageLoc';   // 🏬 มุม SAP ของใบ (2026-09-08)
import ProductSelect from './ProductSelect';
import { splitLevels, refStockOf, madeHereMats, selfMadeRequestBlock, lineRequestFromBom } from '../utils/partRefStock';
import { buildBomIndex } from '../utils/bomTree';
import { shortReceiptRows } from '../utils/stockDiscrepancy';
import { syncLineOrderDemand, syncSummaryText, confirmAndSyncLineDemand } from '../lib/lineDemandSync';
import { qtyUnit } from '../utils/coilUom';
import { fetchAllRows } from '../utils/fetchAllRows';   // 🏭 ของที่ไลน์ผลิตเอง อ้างยอดคลัง (2026-10-08) // 📜 MAT ที่เคยตั้งระดับไว้ — ทะเบียนไม่มีก็ยังเลือกซ้ำได้ (2026-09-07)

/* 🙈 05/11 (คำสั่ง user "งงกับตั้งจุดเรียกเติม … เอาออกก่อน user งง") — ซ่อนทางเบิกแบบ MIN/MAX หน้าไลน์ทั้งชุด
   (ปุ่ม ⚙️ · โมดัล · ส่วน "ถึงจุดเรียกเติม" · "ยังไม่ตั้งจุดเรียกเติม" · "ยอดคลังต่ำกว่าขั้นต่ำ ต้องผลิตเติม")
   เหลือ 2 ทาง: ① เปิดใบผลิตแตก BOM ② ขอเบิกเอง · **ข้อมูล line_part_levels ไม่ลบ** — เปิดกลับ = ตั้ง true
   (ใบที่ "พักไว้" ยังโชว์ — เป็นใบที่มีอยู่จริง ห้ามหายจากจอ) */
const SHOW_LEVEL_REFILL = false;

const norm = (s) => String(s ?? '').trim().toLowerCase();
const num = (v) => (v == null || v === '' ? null : Number(v));

/* สถานะที่ "ยังไม่จบ" = ยังนับเป็นความต้องการค้างอยู่ (กันเสนอซ้ำ)
   suggested/hold = รอหัวหน้าตัดสิน (สโตร์มองไม่เห็น) · pending→delivered = สโตร์ถือลูกบอล */
const OPEN_STATUSES = ['suggested', 'hold', 'pending', 'preparing', 'delivered'];
const WAIT_LEADER   = ['suggested', 'hold'];

const ST = {
  hold:      { label: '⏸ พักไว้ก่อน',    color: '#f59e0b' },
  pending:   { label: '⏳ รอสโตร์หยิบ',   color: '#f59e0b' },
  preparing: { label: 'สโตร์กำลังจัด', color: '#38bdf8' },
  delivered: { label: 'ส่งถึงไลน์แล้ว', color: '#22c55e' },
};

const fmtQty = (v) => (v == null ? '—' : Number(v).toLocaleString());
/* เวลาแจ้ง/เปิดใบ — **ข้ามวันต้องบอกวันด้วย** (15/10 feedback: ใบค้าง 37 วันโชว์แค่ "เปิด 11:01"
   คู่กับ "รอมาแล้ว 53,476 นาที" ⇒ อ่านแล้วนึกว่าเพิ่งเปิดเช้านี้) */
const hhmm = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? t : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${t}`;
};
const agoMin = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null);

/* 🧩 ตัวเลือกเพิ่มของ `ProductSelect` = พาร์ทลูก BOM ของไลน์ครอบครัวนี้ (ของที่ไลน์ "ใช้" ซึ่งมักไม่อยู่
   ใน Product Master) — ใช้ทั้งโมดัลตั้งจุดเรียกเติม และฟอร์ม "ขอเบิกพาร์ทนี้เลย" **ตัวเดียวกัน**
   (21/10 · เดิมมีชุดเดียวในโมดัล ⇒ ฟอร์มขอเบิกจะเลือกพาร์ทลูกไม่ได้เลย = ขอของที่ต้องการไม่ได้)
   · `enabled=false` = ยังไม่โหลด (ฟอร์มที่ยังไม่เปิดไม่ต้องจ่าย egress)
   · ทะเบียนโหลดไม่สำเร็จ = ไม่เติมตัวเลือก (ไม่บล็อกการเลือกจาก Product Master) */
function useBomChildOptions(famNames, enabled = true) {
  const famKey = famNames.join('|');   // array ใน deps = ยิงซ้ำทุก render (กฎเหล็ก DB ข้อ 9)
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    (async () => {
      // 25/09: เดิมยิง dr_products เองทุกครั้งที่สลับไลน์ — กรองจาก cache ทะเบียนกลางแทน
      const all = await loadProductsMaster().catch(() => null);
      if (!all || !alive) return;
      const fam = new Set(famKey.split('|').filter(Boolean));
      const prods = all.filter(p => p.is_active !== false && fam.has(p.line_name));
      if (!prods.length) return;
      const { data: boms } = await supabaseDR.from('bom_items').select('mat_no, part_no, part_name')
        .in('product_id', prods.map(p => p.id)).eq('is_active', true).limit(1000);
      if (!alive) return;
      const seen = new Set();
      setRows((boms || []).filter(b => b.mat_no && !seen.has(b.mat_no) && seen.add(b.mat_no))
        .map(b => ({ mat_no: b.mat_no, name: b.part_name, p_no: b.part_no,
                     sub: [b.part_no, b.part_name].filter(Boolean).join(' · '), group: '🧩 พาร์ทลูก BOM ของไลน์นี้' })));
    })();
    return () => { alive = false; };
  }, [famKey, enabled]);
  return rows;
}

export default function LinePartCallPanel({ lineName, lines = [], role, fullName, alwaysShow = false }) {
  const [levels, setLevels] = useState([]);
  const [stock, setStock]   = useState([]);
  const [reqs, setReqs]     = useState([]);
  const [dpoints, setDpoints] = useState([]);   // 🎯 จุดส่งงานของไลน์นี้ (เฟส 4) — ไม่มี = สโตร์ตรวจจุดไม่ได้ → worklist
  const [slocs, setSlocs]     = useState([]);   // 🏬 ทะเบียนรหัสคลัง SAP (DR) — ใบขอเติมแปะ storage_location ตอนสร้าง (derive จากไลน์แม่)
  const [err, setErr]       = useState(null);
  const [busy, setBusy]     = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showNoLevel, setShowNoLevel] = useState(false);
  /* ➕ 2026-10-21 — "ขอเบิกพาร์ทนี้เลย" (ad-hoc · user สั่ง) · ปุ่ม 📦 เบิก เดิมโผล่เฉพาะพาร์ทที่ครบ 3 ข้อ
     (มีจุดเรียกเติม + ใส่ min · เคยมียอดหน้าไลน์ · ยอด ≤ min) ⇒ วัดจริง 20/10 ของที่ต้องเบิกจากสโตร์
     183 คู่ ตั้ง min ไว้ 1 คู่ ⇒ แทบไม่มีพาร์ทไหนผ่าน ⇒ ไลน์ขอเบิกเองไม่ได้ ต้องเดินไปบอกสโตร์ */
  const [adhocOpen, setAdhocOpen] = useState(false);
  const [adhocMat,  setAdhocMat]  = useState('');
  const [adhocName, setAdhocName] = useState('');
  const [adhocKnown, setAdhocKnown] = useState(false);
  const [adhocQty,  setAdhocQty]  = useState('');
  /* 🏭 2026-10-08 — พาร์ทที่ไลน์นี้ผลิตเอง อ้างยอดคลังปลายทาง (FG WAREHOUSE / STORE) ไม่ใช่ยอดหน้าไลน์
     (utils/partRefStock.js) · refCtx = ทะเบียนสินค้า + กฎรับเข้า · whStock = ยอดคลังของพาร์ทเหล่านั้น */
  const [refCtx, setRefCtx]   = useState({ products: [], rules: [], stds: new Map() });
  const [whStock, setWhStock] = useState([]);
  const [whErr, setWhErr]     = useState(null);

  const canDecide  = can('wip_request', 'decide', role);
  const canReceive = can('wip_request', 'receive', role);
  const canSetLv   = SHOW_LEVEL_REFILL && can('line_levels', 'manage', role);

  /* ⚠️⚠️ กฎ "หน่วยย่อยที่สุด" (user เคาะ 2026-08-31) — ของอยู่ที่ leaf เสมอ
     ไลน์แม่ที่มีลูก = แผนก ไม่ใช่จุดวางของ ⇒ **ห้ามใช้ getLineFamilyNames กับสต็อก/min-max/ใบขอ**
     เดิมใช้ family แล้วไลน์ลูก 3 ตัวนับของก้อนเดียวกันของแม่ครบทุกตัว → จอบอก "ของพอ"
     ทั้งที่หน้าไลน์ไม่มีของ = ซ่อนการขาด · family ใช้เฉพาะ "ใครเห็นอะไร" ซึ่งคนละแกน */
  const isLeaf   = useMemo(() => isLeafLine(lines, lineName), [lines, lineName]);
  const kidNames = useMemo(() => getChildLineNames(lines, lineName), [lines, lineName]);
  /* สายบน — ไว้ตรวจว่ามีของค้างที่ไลน์แม่ไหม (ไม่เอามานับรวม แต่ต้องบอกให้เห็น ห้ามเงียบ) */
  const upNames  = useMemo(() => getAncestorNames(lines, lineName), [lines, lineName]);
  /* 🔴 2026-09-16 — deps ของตัวโหลดต้องผูกกับ "เนื้อ" (string) ไม่ใช่ identity ของ array
     พ่อ (DailyReport) ส่ง prop `lines` ใบใหม่ทุกครั้งที่ setLines ⇒ upNames ใบใหม่ ⇒ load ใบใหม่
     ⇒ effect ยิงซ้ำ **8 คิวรีฟรีๆ** (line_part_levels · line_stock_summary · wip_replenish_requests ·
     line_delivery_points · storage_locations · dr_products · bom_items)
     วัดจริง 16/09: line_delivery_points 210 · line_part_levels 210 · storage_locations 195 req
     ในช่วง 2 ชม. — เลขเท่ากันเป๊ะ = มาจาก load() ตัวเดียว (บั๊กคลาสเดียวกับ StoreLotQueue)
     กฎเหล็กข้อ 9 ใน CLAUDE.md */
  const upKey    = upNames.join('|');
  /* ไลน์ที่ใช้จัดลำดับตัวเลือกใน picker ของฟอร์มขอเบิกเอง (ของไลน์ครอบครัวนี้ขึ้นก่อน)
     — array prop ต้อง useMemo ที่หน้าแม่ (กฎเหล็ก DB ข้อ 9) */
  const pickLines = useMemo(() => [...new Set([lineName, ...upNames, ...kidNames])].filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ผูกกับ "เนื้อ" (string) ไม่ใช่ identity ของ array
    [lineName, upKey, kidNames.join('|')]);
  /* ตัวเลือกพาร์ทลูก BOM ของฟอร์มขอเบิกเอง — โหลดเมื่อกดเปิดฟอร์มเท่านั้น */
  const adhocExtra = useBomChildOptions(pickLines, adhocOpen);


  const load = useCallback(async () => {
    if (!lineName) return;
    setErr(null);
    const stockLines = [lineName, ...upNames];   // ของตัวเอง + ที่อาจค้างข้างบน (แยกกันตอนคำนวณ)
    const [lv, st, rq, dp, sl] = await Promise.all([
      supabaseDR.from('line_part_levels').select('*').eq('line_name', lineName).eq('is_active', true),
      supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand').in('line_name', stockLines),
      supabase.from('wip_replenish_requests').select('*')
        .eq('line_name', lineName).is('wip_point_id', null).in('status', OPEN_STATUSES)
        .order('requested_at', { ascending: true, nullsFirst: false }),
      // จุดส่ง = ทะเบียนที่แทบไม่เปลี่ยน → cache กลาง (01/10 · เดิม 1,546 ครั้ง/วัน จากคำถามเดิม 22 แบบ)
      //   ตารางยังไม่ apply = loader คืน [] เอง ไม่ลากทั้งแผงล้ม (เหมือนพฤติกรรมเดิม)
      loadDeliveryPoints(),
      // ทะเบียนรหัสคลัง = master ที่แทบไม่เปลี่ยน → ผ่าน cache กลาง (ดู utils/useStorageLocations.js)
      //   ห้ามกลับไปยิงตรง: เดิม 3 หน้ายิงคนละชุดคอลัมน์ = 850 ครั้ง/ครึ่งวัน
      loadStorageLocations(),
    ]);
    setDpoints(deliveryPointsOfLine(dp, lineName));
    setSlocs(sl || []);   // loader คืน [] เองเมื่อตารางยังไม่ apply — ไม่มี .error ให้เช็ค
    /* ⚠️ ตารางยังไม่ apply migration (42P01) = ฟีเจอร์ยังไม่เปิด ไม่ใช่ error ของผู้ใช้
       แยกให้ขาดจาก error จริง ไม่งั้นขึ้นแถบแดงให้ทุกคนดูทุกวันโดยไม่มีอะไรให้ทำ */
    const notReady = [lv, st, rq].some(r => r.error?.code === '42P01' || r.error?.code === '42703');
    if (notReady) { setErr({ notReady: true }); setLevels([]); setStock([]); setReqs([]); return; }
    const bad = [lv, st, rq].find(r => r.error);
    if (bad) { setErr({ msg: bad.error.message }); return; }
    setLevels(lv.data || []);
    setStock(st.data || []);
    setReqs(rq.data || []);
    /* 🏭 ยอดคลังของพาร์ทที่ไลน์นี้ผลิตเอง — ล้มต้องบอกบนจอ (ห้ามถอยไปเทียบหน้าไลน์เงียบๆ = เสนอเบิกผิดทิศ) */
    try {
      /* ตัวตั้ง = พาร์ทที่ไลน์นี้ผลิตเอง (Product Master) · ขั้นต่ำ/สูงสุด = kanban_standards (แท็บ 🎴 คำนวณ Kanban) ชุดเดียว */
      const [products, rulesRes] = await Promise.all([
        loadProductsMaster(),
        supabaseDR.from('stock_inflow_rules').select('match_type, match_value, dest_line_name, is_active, mode').eq('is_active', true),
      ]);
      if (rulesRes.error) throw rulesRes.error;
      const made = madeHereMats(lineName, products || []);
      const stdRes = made.length
        ? await supabaseDR.from('kanban_standards').select('mat_no, min_qty, max_qty').eq('is_active', true).in('mat_no', made)
        : { data: [] };
      if (stdRes.error) throw stdRes.error;
      // พาร์ทที่ยอดเข้าทางปิดล็อต = ลงที่ไลน์ผลิต ไม่ใช่ STORE — ตัดสินจากกฎ (ตัวเดียวกับ trigger · 19/10)
      const ctx = { lineName, products: products || [], rules: rulesRes.data || [],
                    stds: new Map((stdRes.data || []).map(k => [k.mat_no, k])) };
      const refs = made.map(m => ({ mat: m, ...refStockOf(m, ctx) })).filter(r => r.kind === 'produce');
      let wh = [];
      if (refs.length) {
        const { data, error } = await supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand')
          .in('line_name', [...new Set(refs.map(r => r.loc))]).in('mat_no', [...new Set(refs.map(r => r.mat))]);
        if (error) throw error;
        wh = data || [];
      }
      setRefCtx(ctx); setWhStock(wh); setWhErr(null);
    } catch (e) {
      setWhErr(e?.message || String(e));   // คงค่ารอบก่อนไว้ + แถบแดงบอก
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- upKey แทน upNames (ดูหมายเหตุที่ upKey)
  }, [lineName, upKey]);

  useEffect(() => { load(); }, [load]);

  /* 🧾 05/11 (คำสั่ง user · ข้อ A+C) — ความต้องการจาก "ใบผลิตที่เปิดอยู่" ต้องเห็นบนแผงเสมอ ไม่ใช่แค่ toast ตอนกด
     · ใบผลิตที่เปิดก่อนมีระบบนี้ = ยังไม่เคยถูกคำนวณ ⇒ ปุ่ม 🔁 ให้ไลน์กดคำนวณ + แจ้งสโตร์เองได้ทุกเมื่อ
     · คำนวณแบบ dryRun (อ่านอย่างเดียว) ตอนเปิดแผง/สลับไลน์/หลังแจ้ง — ไม่ผูกกับ load() ที่ถูกเรียกถี่
     · อ่านไม่ได้ = เขียน error บนจอ ห้ามโชว์ว่า "ไม่มีความต้องการ" */
  const [plan, setPlan] = useState(null);       // { error?, rows } | null = กำลังคำนวณ
  const [planTick, setPlanTick] = useState(0);
  useEffect(() => {
    if (!lineName) return undefined;
    let alive = true;
    setPlan(null);
    syncLineOrderDemand({ lineName, role, dryRun: true })
      .then(r => { if (alive) setPlan(r); })
      .catch(e => { if (alive) setPlan({ error: e?.message || String(e), rows: [] }); });
    return () => { alive = false; };
  }, [lineName, role, planTick]);

  /* ── ยอดคงเหลือ "ของไลน์นี้เท่านั้น" ────────────────────────────────────────
     ⚠️ ห้ามบวกของไลน์แม่เข้ามา — ของที่แม่ยังไม่ได้ถูกจ่ายลงมาที่ไลน์นี้จริง
        และไลน์พี่น้องก็จะนับก้อนเดียวกันซ้ำอีก */
  const onHand = useMemo(() => {
    const m = new Map();
    for (const s of stock) {
      if (!s.mat_no || s.line_name !== lineName) continue;
      m.set(s.mat_no, (m.get(s.mat_no) || 0) + (Number(s.qty_on_hand) || 0));
    }
    return m;
  }, [stock, lineName]);

  /* ของที่ยังค้างอยู่ที่ไลน์แม่ — **ไม่นับเป็นของไลน์นี้ แต่ต้องเห็น** ห้ามเงียบ
     (นี่คือสาเหตุที่ระบบไม่เสนอเติมทั้งที่ยอดในระบบดูเหมือนมี — ต้องไปย้ายที่ /line-stock) */
  const stuckUp = useMemo(() => {
    if (!upNames.length) return [];
    const out = [];
    for (const s of stock) {
      if (!s.mat_no || s.line_name === lineName) continue;
      const q = Number(s.qty_on_hand) || 0;
      if (q > 0) out.push({ mat_no: s.mat_no, line_name: s.line_name, qty: q });
    }
    return out.sort((a, b) => b.qty - a.qty);
  }, [stock, lineName, upNames]);

  // 1 พาร์ท = 1 ใบเปิดได้ใบเดียว (unique index กันระดับ DB อีกชั้น)
  const reqByMat = useMemo(() => {
    const m = new Map();
    for (const r of reqs) if (r.mat_no) m.set(norm(r.mat_no), r);
    return m;
  }, [reqs]);

  /* พาร์ทที่ถึงจุดเรียกเติมแล้ว และ **ยังไม่มีใบค้าง** = สิ่งที่เสนอให้หัวหน้าตัดสิน
     ⚠️ ไม่ persist เป็นแถว `suggested` — คำนวณสดจากยอดจริง
        (แถว suggested ต้องมี scanner คอยสร้าง/ล้าง ซึ่งเฟสนี้ยังไม่มี · สถานะเปิดไว้ใน DB รอเฟสหน้า) */
  /* 🏭 แบ่งจุดเรียกเติม: ของที่ไลน์ผลิตเอง (อ้างคลัง → "ต้องผลิตเติม") / ของที่ไลน์ใช้ (อ้างหน้าไลน์ → เบิกจากสโตร์) */
  const split = useMemo(() => {
    const m = new Map();
    for (const s of whStock) {
      const k = `${s.line_name}|${s.mat_no}`;
      m.set(k, (m.get(k) || 0) + (Number(s.qty_on_hand) || 0));
    }
    return splitLevels(levels, { lineName, ...refCtx }, (loc, mat) => (m.has(`${loc}|${mat}`) ? m.get(`${loc}|${mat}`) : null));
  }, [levels, whStock, refCtx, lineName]);

  /* ของที่ไลน์ผลิตเอง → ให้หน้าต่างตั้งค่าโชว์แบบอ่านอย่างเดียว (คลังที่เทียบ + ขั้นต่ำ/สูงสุดจาก Kanban) */
  const refHave = useMemo(() => {
    const m = new Map();
    for (const mat of madeHereMats(lineName, refCtx.products)) {
      const ref = refStockOf(mat, { lineName, ...refCtx });
      if (ref.kind !== 'produce') continue;
      const rows = whStock.filter(s => s.line_name === ref.loc && s.mat_no === mat);
      const std = refCtx.stds?.get?.(mat);
      m.set(mat, { loc: ref.loc, have: rows.length ? rows.reduce((a, s) => a + (Number(s.qty_on_hand) || 0), 0) : null,
                   min: std?.min_qty ?? null, max: std?.max_qty ?? null });
    }
    return m;
  }, [whStock, refCtx, lineName]);

  const suggest = useMemo(() => {
    const out = [];
    for (const lv of split.consumeLevels) {
      const min = num(lv.min_qty);
      if (min == null) continue;                       // ไม่ตั้ง min = ไม่เฝ้า (ไม่เดาให้)
      if (reqByMat.has(norm(lv.mat_no))) continue;     // มีใบค้างอยู่แล้ว
      const have = onHand.get(lv.mat_no) ?? null;
      if (have == null) continue;                      // ไม่มีแถวสต็อก = "ยังเช็คไม่ได้" ไม่ใช่ "ของหมด"
      if (have > min) continue;
      const max = num(lv.max_qty);
      const reorder = num(lv.reorder_qty);
      // จำนวนที่เสนอ: เติมให้ถึง max → ไม่ตั้ง max ใช้ reorder_qty → ไม่มีทั้งคู่ = ให้คนกรอกเอง
      const qty = max != null ? Math.max(0, max - have) : (reorder ?? null);
      out.push({ ...lv, have, min, suggestQty: qty ? Math.round(qty) : null });
    }
    return out.sort((a, b) => (a.have / (a.min || 1)) - (b.have / (b.min || 1)));
  }, [split, onHand, reqByMat]);

  const holds   = reqs.filter(r => r.status === 'hold');
  const inFlight = reqs.filter(r => ['pending', 'preparing', 'delivered'].includes(r.status));
  const hasDeliveryPoint = pointsForLine(dpoints, lineName).length > 0;

  /* พาร์ทที่มีของอยู่ในไลน์ แต่ยังไม่ได้ตั้งจุดเรียกเติม — ต้องเห็น ห้ามซ่อน
     (ไม่ตั้ง = ระบบจะไม่มีวันเตือนพาร์ทนั้น ซึ่งเงียบกว่าตั้งผิด) */
  const noLevel = useMemo(() => {
    const has = new Set(levels.map(l => l.mat_no));
    return [...onHand.entries()].filter(([mat]) => !has.has(mat)).sort((a, b) => b[1] - a[1]);
  }, [onHand, levels]);

  /* ── actions ──────────────────────────────────────────────────────────────── */
  const lineSloc = useMemo(() => slocCodeOfLine(slocs, lines, lineName), [slocs, lines, lineName]);
  /* insert ใบ + แปะมุม SAP — 42703 = ยังไม่ apply 20260908_wip_replenish_storage_location (Main) → บันทึกแบบไม่ tag แล้วบอกบนจอ ห้ามให้การเบิกล้ม */
  const insertReq = async (row) => {
    /* 🔴 20/10 — ใบที่ "ไลน์เรียก" ต้องบอกสโตร์ได้ว่าใครเรียก เหมือนใบที่สโตร์สร้างเอง
       (`HeijunkaKanban` stamp `requested_by` อยู่แล้ว · ที่นี่เคย stamp แต่ `decided_by_name`
       ⇒ วัดจริง: ใบ source='line' ทั้ง 4 ใบมี `requested_by` = null สโตร์โทรกลับไม่ได้ว่าใครขอ)
       ตัวตนมาจาก `getActor()` ที่เดียว (utils/actorStamp.js) — ไม่รู้ตัวตน = ไม่ stamp ห้ามเดา */
    const who = getActor();
    const base = { ...row,
                   requested_by: row.requested_by ?? (who.name || fullName || null),
                   requested_by_uid: row.requested_by_uid ?? (who.uid || null) };
    let res = await supabase.from('wip_replenish_requests').insert({ ...base, storage_location: lineSloc });
    if (res.error?.code === '42703') {
      res = await supabase.from('wip_replenish_requests').insert(base);
      if (!res.error) toast.info('บันทึกแล้ว แต่ยังไม่ได้ apply migration 20260908_wip_replenish_storage_location (Main) — ใบไม่ถูกแปะรหัสคลัง SAP');
    }
    return res;
  };
  const place = async (s, qtyInput) => {
    const qty = Number(qtyInput);
    if (!(qty > 0)) { toast.error('ระบุจำนวนที่ต้องการเบิกก่อน'); return; }
    setBusy(s.mat_no);
    const now = new Date().toISOString();
    const { error } = await insertReq({
      line_name: lineName, mat_no: s.mat_no, part_name: s.note || null,
      request_qty: qty, status: 'pending',
      requested_at: now, decided_by_name: fullName || null,
      on_hand_at_req: s.have, min_at_req: s.min,
    });
    setBusy(null);
    if (error) {
      // 23505 = มีใบค้างของพาร์ทนี้อยู่แล้ว (unique index) — อีกเครื่องกดไปก่อน
      toast.error(error.code === '23505'
        ? 'พาร์ทนี้มีใบขอเบิกค้างอยู่แล้ว (อาจมีคนกดไปก่อน) — กด ↻ ดูรายการ'
        : `เบิกไม่สำเร็จ: ${error.message}`);
      load(); return;
    }
    notifyEvent({
      event: 'wip_request_placed', type: 'info', ref_table: 'wip_replenish_requests',
      line_name: lineName, actor: fullName,
      lines: [
        `🏭 ไลน์: ${lineName}`,
        `🔩 ${s.mat_no} · ขอเบิก ${qty.toLocaleString()} ชิ้น`,
        `📊 ในไลน์เหลือ ${fmtQty(s.have)} / จุดเรียกเติม ${fmtQty(s.min)}`,
      ],
    });
    toast.success(`📦 แจ้งสโตร์แล้ว — ${s.mat_no} ${qty.toLocaleString()} ชิ้น`);
    load();
  };

  /* ➕ ขอเบิกพาร์ทนี้เลย — ไม่ต้องมี min ไม่ต้องรอถึง min (user สั่ง 21/10)
     · `source='line_adhoc'` ⇒ สโตร์เห็นว่า "คนขอเอง" ไม่ใช่ "ระบบเสนอ" (คนละน้ำหนักเวลาจัดคิว)
       และวัดได้ว่าเดือนนี้ขอเองกี่ใบ = ลิสต์พาร์ทที่ควรไปตั้ง min (migration 20261021_…_main.sql)
     · `min_at_req` = null โดยเจตนา (ไม่มีจุดเรียกเติม) · `on_hand_at_req` = ยอดที่เห็นตอนขอ ไม่รู้ = null ห้ามใส่ 0
     · พาร์ทนอกทะเบียนต้องถามยืนยัน — `ProductSelect` คืน `known=false` (ห้ามรับค่าพิมพ์เองเงียบๆ) */
  /* 🔁 04/11 (คำสั่ง user) — เลือกพาร์ทที่ไลน์นี้ผลิตเอง = "จะผลิตกี่ชิ้น" ⇒ แตก BOM เป็นของที่ต้องเบิกจากสโตร์
     user: *"การส่งไปหาสโตร์ ต้องแปลงผ่าน BOM ไปเรียกวัตถุดิบ ไม่ใช่เรียกตัวเอง"*
     กติกา `lineRequestFromBom` (partRefStock.js) · ต้นไม้ BOM ผ่าน `buildBomIndex` เท่านั้น ·
     ไม่มี BOM / อ่าน BOM ไม่ได้ = ไม่สร้างใบ + บอกบนจอ (ห้ามถอยไปขอตัวเอง) */
  /* สรุปผลการแจ้งสโตร์ (ตัวเดียวกับตอนเปิดใบผลิต) — สำเร็จต้องล้างช่อง · ไม่ถึงกล่อง/ไม่มี packing std ต้องบอกบนจอ */
  const reportSync = (r, what) => {
    /* 💬 05/11 — popup ยืนยันแล้ว: กดยกเลิก / ไม่มีอะไรต้องแจ้ง (ดูรายละเอียดใน popup แล้ว) = ไม่ toast ซ้ำ */
    if (r.cancelled || r.nothingToSend) { setPlanTick(t => t + 1); if (r.cancelled) toast.info(`${what} — ยกเลิก ยังไม่แจ้งสโตร์`); return; }
    const text = syncSummaryText(r);
    if (r.error || r.writeErrors?.length) toast.error(`${what} — ${text}`);
    else if (r.inserted || r.raised) {
      toast.success(`📦 ${what} — ${text}`);
      notifyEvent({ event: 'wip_request_placed', type: 'info', ref_table: 'wip_replenish_requests', line_name: lineName, actor: fullName,
        lines: [`🏭 ไลน์: ${lineName}`, `🔁 ${what}`, ...r.rows.filter(x => x.action === 'insert' || x.action === 'raise').slice(0, 5).map(x => `🔩 ${x.mat_no} × ${fmtQty(x.qty)}`)] });
    } else toast.info(`${what} — ${text}`);
    if (!r.error) { setAdhocMat(''); setAdhocName(''); setAdhocQty(''); setAdhocKnown(false); }
    load(); setPlanTick(t => t + 1);
  };
  const placeFromBom = async (mat, qty) => {
    setBusy(`adhoc:${mat}`);
    const { data: bomRows, error: bomErr } = await fetchAllRows(supabaseDR, 'bom_items', 'id, product_id, mat_no, part_name, qty_per_unit, parent_mat, item_no',
      q => q.eq('is_active', true).order('id'));
    if (bomErr) { setBusy(null); toast.error(`อ่าน BOM ไม่ได้ — ยังไม่ได้แจ้งสโตร์ (${bomErr.message})`); return; }
    const products = refCtx.products || [];
    const matOf = Object.fromEntries(products.filter(p => p?.id != null).map(p => [p.id, p.mat_no]));
    const ix = buildBomIndex(bomRows || [], matOf);
    const res = lineRequestFromBom(lineName, mat, qty, ix, products);
    if (res.cycle) toast.error(`BOM ของ ${mat} วนกลับหาตัวเอง/ลึกผิดปกติ — ยอดที่แตกได้อาจไม่ครบ แจ้ง PE ตรวจ BOM`);
    if (!res.items.length) {
      setBusy(null);
      toast.error(`${mat} เป็นพาร์ทที่ ${lineName} ผลิตเอง แต่ยังไม่มีชิ้นส่วนลูกใน BOM — แตกเป็นของที่ต้องเบิกไม่ได้ (ตั้ง BOM ที่ /products ก่อน)`);
      return;
    }
    /* 💬 05/11 (คำสั่ง user) — popup บอกหน่วย · ของหน้าไลน์ · ขาด · สะสมอีกเท่าไหร่ถึงจะแจ้ง (utils/linePlanText.js) */
    const r = await confirmAndSyncLineDemand({ lineName, role, focus: res.items.map(i => i.mat_no),
      title: `${mat} เป็นพาร์ทที่ ${lineName} ผลิตเอง — ผลิต ${qty.toLocaleString()} ชิ้น ต้องเบิกจากสโตร์ตาม BOM:`,
      extra: res.items.map(i => ({ mat_no: i.mat_no, part_name: i.part_name, need: i.qty, viaBom: true })) });
    setBusy(null);
    reportSync(r, `จะผลิต ${mat} × ${qty.toLocaleString()} (แตก BOM ${res.items.length} รายการ)`);
    load();
  };

  const placeAdhoc = async () => {
    /* 🔴 ค่าที่เขียนลง DB ต้องเป็นรหัสตามทะเบียน — `norm()` ในไฟล์นี้ lowercase (ใช้เทียบเท่านั้น)
       เขียนตัวพิมพ์เล็กลงไป = พาร์ทเดียวกันแตกเป็น 2 คีย์ทั้ง ledger/สรุปยอด */
    const mat = String(adhocMat ?? '').trim();
    const qty = Number(adhocQty);
    if (!mat) { toast.error('เลือกพาร์ทที่จะขอเบิกก่อน'); return; }
    if (!(qty > 0)) { toast.error('ระบุจำนวนที่ต้องการเบิก'); return; }
    /* 05/11 — มีใบค้างแล้วก็ขอเพิ่มได้: ใบที่ยังรอหยิบจะถูกเพิ่มยอด (syncLineOrderDemand) แทนการเปิดใบซ้ำ */
    /* 🔴 04/11 (คำสั่ง user) — พาร์ทที่ไลน์นี้ผลิตเอง ขอจากสโตร์ไม่ได้ (ขอผิดทิศ · ต้องผลิตเติม/เบิกลูกใน BOM)
       ทะเบียนอ่านไม่ได้ = บล็อก (ตรวจไม่ได้ ห้ามปล่อยผ่าน) · กติกา `selfMadeRequestBlock` (partRefStock.js) */
    const selfBlock = selfMadeRequestBlock(lineName, mat, whErr ? null : refCtx.products);
    if (selfBlock?.code === 'self_made') { await placeFromBom(mat, qty); return; }   // 🔁 แตก BOM เป็นของที่ต้องเบิก
    if (selfBlock) { toast.error(selfBlock.text); return; }
    if (!adhocKnown && !window.confirm(`"${mat}" ไม่อยู่ในทะเบียนสินค้า/BOM ของไลน์นี้\n\nยืนยันว่าจะขอเบิกพาร์ทนี้?`)) return;
    setBusy(`adhoc:${mat}`);
    /* 🔁 05/11 — หลักการเดียวกับเปิดใบผลิต: รวมกับความต้องการที่มีอยู่ เทียบยอดหน้าไลน์ ปัดเต็มกล่อง */
    const r = await confirmAndSyncLineDemand({ lineName, role, focus: [mat], title: `➕ ขอเบิก ${mat}${adhocName ? ` · ${adhocName}` : ''} เพิ่ม ${qty.toLocaleString()}:`,
      extra: [{ mat_no: mat, part_name: adhocName || null, need: qty }] });
    setBusy(null);
    reportSync(r, `ขอเพิ่ม ${mat} × ${qty.toLocaleString()}`);
  };

  const hold = async (s) => {
    const reason = window.prompt(
      `พักการเบิก "${s.mat_no}" ไว้ก่อน\n\nเหตุผล (เช่น เดี๋ยวเปลี่ยนรุ่น / ของยังพอถึงสิ้นกะ):`, '');
    if (reason === null) return;   // กดยกเลิก
    setBusy(s.mat_no);
    const { error } = await insertReq({
      line_name: lineName, mat_no: s.mat_no, request_qty: s.suggestQty || 1,
      status: 'hold', requested_at: null,          // ⚠️ ยังไม่เริ่มนับเวลา — ยังไม่ได้สั่งเบิก
      hold_at: new Date().toISOString(), hold_by_name: fullName || null,
      hold_reason: reason.trim() || null,
      on_hand_at_req: s.have, min_at_req: s.min,
    });
    setBusy(null);
    if (error) { toast.error(error.code === '23505' ? 'พาร์ทนี้มีใบค้างอยู่แล้ว' : error.message); load(); return; }
    toast.info(`⏸ พัก "${s.mat_no}" ไว้ก่อน — ยังอยู่ในรายการ ไม่หายไปไหน`);
    load();
  };

  // ปลด hold → กลายเป็นใบเบิกจริง (เริ่มนับเวลาตรงนี้ ไม่ใช่ตอน hold)
  const unhold = async (r) => {
    setBusy(r.id);
    const { data, error } = await supabase.from('wip_replenish_requests')
      .update({ status: 'pending', requested_at: new Date().toISOString(),
                // ปลดจากที่พักไว้ = "เรียกจริง" ตรงนี้ ⇒ คนที่ปลดคือคนเรียก (เวลาเริ่มนับที่นี่เหมือนกัน)
                requested_by: getActor().name || fullName || null, requested_by_uid: getActor().uid || null,
                decided_by_name: fullName || null, hold_reason: r.hold_reason })
      .eq('id', r.id).eq('status', 'hold').select('id');
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('รายการนี้ถูกเปลี่ยนสถานะไปแล้ว — กด ↻'); load(); return; }
    notifyEvent({
      event: 'wip_request_placed', type: 'info', ref_table: 'wip_replenish_requests',
      line_name: lineName, actor: fullName,
      lines: [`🏭 ไลน์: ${lineName}`, `🔩 ${r.mat_no} · ขอเบิก ${fmtQty(r.request_qty)} ชิ้น`, '↩ ปลดจากที่พักไว้'],
    });
    toast.success('📦 แจ้งสโตร์แล้ว');
    load();
  };

  const cancel = async (r) => {
    if (!window.confirm(`ยกเลิก "${r.mat_no}" จริงๆ?\n\n(ใช้เมื่อ "ไม่ใช้พาร์ทนี้แล้ว" เท่านั้น\nถ้าแค่ยังไม่เบิกตอนนี้ ให้ใช้ ⏸ พักไว้ก่อน)`)) return;
    setBusy(r.id);
    /* 🔴 06/10 (ช่องโหว่สโตร์ข้อ 8) — ยกเลิกได้เฉพาะใบ "พักไว้" (ปุ่มนี้โชว์แค่ที่นั่น) · CAS + นับแถว
       เดิม `.eq('id')` ล้วน ⇒ จอค้างแล้วคนอื่นปลดเป็นใบเบิก/สโตร์หยิบไปแล้ว (ตัดสต็อก STORE→ไลน์แล้ว)
       ก็ยังยกเลิกได้ = ใบหายจากคิวทั้งที่ของเคลื่อนไปแล้ว · RLS ปฏิเสธก็ได้ "สำเร็จ 0 แถว" เงียบ (กฎข้อ 2) */
    const { data, error } = await supabase.from('wip_replenish_requests')
      .update({ status: 'cancelled' }).eq('id', r.id).eq('status', 'hold').select('id');
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('ยกเลิกไม่ได้ — รายการนี้ถูกเปลี่ยนสถานะไปแล้ว (เบิกแล้ว/สโตร์กำลังจัด) หรือไม่มีสิทธิ์ · กด ↻'); load(); return; }
    toast.info(`✕ ยกเลิก "${r.mat_no}" แล้ว`);
    load();
  };

  // ขั้น 8 — ปิดลูป · ได้ไม่ครบต้องบันทึกจำนวนจริง ไม่ใช่กด "รับแล้ว" เฉยๆ
  /* 🔴 02/11 (feedback ประชุม "สโตร์ส่งเข้าไลน์ กดรับก็ยังไม่เพิ่มหรือลด"):
     ยอดย้าย STORE → ไลน์ตั้งแต่สโตร์ "ยืนยันเตรียม" (deductStockForPick ใน HeijunkaKanban) — ตอนกดรับจึงไม่ขยับอีก
     ⇒ (1) บอกบนจอว่ายอดเข้าไลน์ไปแล้วเท่าไหร่ / หรือยังไม่ได้ตัด (2) รับไม่ครบ = หักส่วนที่ไม่ได้รับออกจากไลน์
     (เหมือนรอบคัมบัง submitReceive) — เดิมเก็บแค่ received_qty ยอดไลน์เลยสูงกว่าของจริงเงียบๆ */
  const receive = async (r, full) => {
    const issued = Number(r.picked_qty) > 0 ? Number(r.picked_qty) : (Number(r.request_qty) || 0);
    let qty = issued;
    let note = null;
    if (!full) {
      const a = window.prompt(`ได้รับจริงกี่${qtyUnit(r.uom)}? (สโตร์ส่งมา ${fmtQty(issued)} ${qtyUnit(r.uom)})`, '');
      if (a === null) return;
      qty = Number(a);
      if (!(qty >= 0)) { toast.error('จำนวนไม่ถูกต้อง'); return; }
      note = window.prompt('หมายเหตุ / ปัญหาที่เจอ (เว้นว่างได้):', '') || null;
    }
    setBusy(r.id);
    const { data, error } = await supabase.from('wip_replenish_requests')
      .update({ status: 'received', received_at: new Date().toISOString(),
                received_by_name: fullName || null, received_qty: qty, received_note: note })
      .eq('id', r.id).eq('status', 'delivered').select('id');
    /* 🔴 06/10 (ข้อ 8) — รับได้เฉพาะใบ "ส่งแล้ว" (ปุ่มโชว์แค่ที่นั่น) · เดิม `.neq('received')` ⇒ จอค้างกดรับ
       ใบที่ถูกยกเลิก = ชุบชีวิตใบขยะ · ใบที่สโตร์ยังไม่หยิบ (pending) = ปิดลูปทั้งที่สต็อกยังไม่เคยถูกตัด */
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('ยืนยันรับไม่ได้ — รายการนี้ถูกรับ/ยกเลิก/เปลี่ยนสถานะไปแล้ว หรือไม่มีสิทธิ์ · กด ↻'); load(); return; }
    const lead = agoMin(r.requested_at);
    const ledgered = r.stock_txn_ids?.length > 0;
    const short = ledgered ? Math.max(0, issued - qty) : 0;
    if (short > 0) {
      /* ⚠️ 05/11 (คำสั่ง user "ต้องไม่หาย") — ส่วนที่ขาดย้ายไลน์ → คลังพัก "ผลต่างรอเคลียร์" + เปิดเคสให้ผลิต/สโตร์ยืนยันคู่
         เดิม consume ทิ้งที่ไลน์ = ยอดหายจากทุกคลัง · กฎ `utils/stockDiscrepancy.js` */
      const wd = getWorkDate();
      const ref = `ใบขอเติม ${String(r.id).slice(0, 8)} ส่ง ${issued} รับจริง ${qty}`;
      const { error: eShort } = await supabaseDR.from('line_stock_transactions').insert(
        shortReceiptRows({ line: r.line_name, mat: r.mat_no, part: r.part_name, short, workDate: wd, by: fullName || 'ผลิต', ref }));
      if (eShort) toast.error(`รับแล้ว แต่ย้ายส่วนที่ไม่ได้รับ (${short}) ไปคลังพักไม่สำเร็จ: ${eShort.message} — แจ้งสโตร์/admin`);
      else {
        const { error: eCase } = await supabaseDR.from('stock_discrepancies').insert({
          source: 'wip_request', ref_id: String(r.id), line_name: r.line_name, mat_no: r.mat_no, part_name: r.part_name || null,
          sent_qty: issued, received_qty: qty, short_qty: short, work_date: wd, reported_by: fullName || null, note,
        });
        if (eCase) toast.error(`ย้ายส่วนที่ขาดไปคลังพักแล้ว แต่เปิดเคสผลต่างไม่สำเร็จ: ${eCase.message} — แจ้ง admin (ยอดยังอยู่ที่คลังพัก ไม่หาย)`);
      }
    }
    toast.success(`✅ ปิดงาน ${r.mat_no}${lead != null ? ` · ใช้เวลา ${lead} นาที` : ''}`
      + (ledgered
        ? ` · ยอดเข้าไลน์ +${fmtQty(issued)} ตั้งแต่สโตร์เตรียมของแล้ว${short > 0 ? ` (ส่วนที่ไม่ได้รับ ${fmtQty(short)} ย้ายไปคลังพัก รอผลิต+สโตร์เคลียร์)` : ''}`
        : ' · ⚠ ใบนี้ยังไม่ถูกตัดสต็อก — ยอดในไลน์ไม่เปลี่ยน แจ้งสโตร์'));
    if (r.stock_txn_note && /ไม่หัก STORE/.test(r.stock_txn_note)) toast.info('ℹ️ ฝั่งสโตร์ยังไม่ถูกหักยอด เพราะ STORE ไม่มียอดตั้งต้นของพาร์ทนี้ — สโตร์ต้องลงรับเข้า STORE ก่อน');
    load();
  };

  /* ── render ───────────────────────────────────────────────────────────────── */
  if (err?.notReady) return null;   // ยังไม่ apply migration = ฟีเจอร์ยังไม่เปิด (ไม่รบกวนหน้าจอ)

  /* ⚠️ ไลน์แม่ที่มีลูก = แผนก ไม่ใช่จุดวางของ (กฎหน่วยย่อยที่สุด)
     ตัวเลขระดับนี้ไม่มีความหมาย — บอกให้ไปเปิดที่ไลน์ลูกแทน **ห้ามโชว์ตัวเลขให้เข้าใจผิด** */
  if (!isLeaf) return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 4 }}>เรียกชิ้นส่วนจากสโตร์</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.7 }}>
        <b>{lineName}</b> เป็นไลน์แม่ (มีไลน์ย่อย {kidNames.length}) — ของอยู่ที่ <b>ไลน์ย่อย</b>
        <br />เปิดกะที่ไลน์ย่อยเพื่อดู/เบิก: {kidNames.map(n => (
          <span key={n} style={{ display: 'inline-block', margin: '3px 4px 0 0', padding: '2px 8px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 11 }}>{n}</span>
        ))}
      </div>
    </div>
  );

  const nothing = !err && !whErr && !(SHOW_LEVEL_REFILL && suggest.length) && !holds.length && !inFlight.length && !(SHOW_LEVEL_REFILL && noLevel.length)
    && !split.produceDue.length && !split.produceUnknown.length;   // produceNoStd ตัวเดียวไม่เปิดแผง (ไม่งั้นทุกไลน์ที่ผลิตของขึ้นแผงหมด)
  /* 🔴 15/10 feedback หน้างาน ("ไม่มีปุ่ม เรียก Part จาก Store ครับ แล้วตั้งจุดเรียกเติมยังไงครับ"):
     ไลน์ที่ยังไม่มีของ + ยังไม่ตั้ง min = `nothing` ⇒ แผงหายทั้งใบ ⇒ **ปุ่ม ⚙️ ตั้งจุดเรียกเติม ก็หายไปด้วย**
     = ไก่กับไข่ (ต้องมีของก่อนถึงจะตั้งจุดเฝ้าได้ ทั้งที่จุดเฝ้าคือสิ่งที่ต้องตั้ง "ก่อน" ของจะหมด)
     ⇒ หน้าจอผลิตยังซ่อนเหมือนเดิม (ไม่รกตอนไม่มีอะไรต้องทำ) · หน้า**ตั้งค่าไลน์**ส่ง `alwaysShow`
        เพื่อให้มีทางเข้าถึงการตั้งค่าเสมอ */
  const card = { background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 };
  const btn = (bg, fg, bd) => ({ fontSize: 11.5, fontWeight: 800, padding: '5px 11px', borderRadius: 7,
    cursor: 'pointer', background: bg, color: fg, border: `1px solid ${bd || bg}`, whiteSpace: 'nowrap' });

  /* ⚙️ โมดัลตั้งจุดเรียกเติม — ประกาศครั้งเดียว ใช้ทั้งกิ่ง "ไม่มีอะไรต้องทำ" และแผงเต็ม
     (ห้ามก๊อป JSX 2 ชุด — ปุ่มที่เปิดโมดัลไม่ได้ = ปุ่มหลอก) */
  const setupModal = !showSetup ? null : (
    <LevelSetupModal lineName={lineName} lines={lines} upMats={[...new Set(stuckUp.map(s => s.mat_no))]} levels={levels} onHand={onHand} refHave={refHave}
      fullName={fullName} onClose={() => { setShowSetup(false); load(); }} />
  );

  const syncNow = async () => {
    setBusy('order-sync');
    const r = await confirmAndSyncLineDemand({ lineName, role, title: `🔁 ${lineName} — ความต้องการจากใบผลิตที่เปิดอยู่:` });
    setBusy(null);
    reportSync(r, 'คำนวณจากใบผลิตที่เปิดอยู่');
  };
  const planRows = plan?.rows || [];
  const planSend = planRows.filter(x => x.action === 'insert' || x.action === 'raise');
  const planWait = planRows.filter(x => x.action === 'wait');
  const planNoPkg = planRows.filter(x => x.action === 'no_pkg');
  const orderBlock = (
    <div style={{ marginBottom: 12, background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, padding: '9px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>ความต้องการจากใบผลิตที่เปิดอยู่</span>
        {plan == null && <span style={{ fontSize: 11, color: 'var(--muted)' }}>กำลังคำนวณ…</span>}
        {plan && !plan.error && (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {plan.area?.code ? `พื้นที่ ${plan.area.code} (${(plan.area.lines || []).join(' · ')})` : 'ไลน์นี้ยังไม่ผูกพื้นที่ SAP — คิดเฉพาะไลน์นี้'}
            {` · ใบผลิตเปิดอยู่ ${plan.orders ?? 0} ใบ`}
            {planRows.length ? ` · ลูกที่ต้องใช้ ${planRows.length} พาร์ท` : ''}
            {planSend.length ? <> · <b style={{ color: 'var(--amber)' }}>ยังไม่ได้แจ้งสโตร์ {planSend.length}</b></> : null}
          </span>
        )}
        {(canDecide || canReceive || canSetLv) && (
          <button disabled={!!busy} onClick={syncNow} style={{ marginLeft: 'auto', ...btn('var(--bg2)', 'var(--blue)', 'var(--blue)') }}>
            {busy === 'order-sync' ? '…' : '🔁 คำนวณ + แจ้งสโตร์'}
          </button>
        )}
      </div>
      {plan?.error && <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--red)' }}>⚠ คำนวณไม่ได้ — {plan.error}</div>}
      {/* 05/11 (คำสั่ง user "มีออเดอร์เปิดอยู่ แจ้งแบบนี้ได้ไง") — ใบผลิตที่ MAT ไม่มีลูกใน BOM ต้องบอกตรงๆ ห้ามบอกว่า "ไม่ต้องเบิก" */}
      {plan?.noBom?.length > 0 && (
        <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--red)', lineHeight: 1.7 }}>
          ⚠ <b>ใบผลิต {plan.noBom.length} ตัวไม่มีลูกใน BOM — แตกไม่ได้ ระบบจึงไม่รู้ว่าต้องเบิกอะไร:</b>{' '}
          {plan.noBom.slice(0, 5).map(x => `${x.mat_no} × ${fmtQty(x.qty)}`).join(' · ')} — แจ้ง PE ตั้ง BOM (/products) หรือกด ➕ ขอเบิกเอง
        </div>
      )}
      {/* 🔩 08/11 — ใบขั้น OP ที่ยังไม่ผูกว่ากินอะไร (แม่มีลูกหลายตัว ระบบไม่เดา) ต้องบอก */}
      {plan?.opUnset?.length > 0 && (
        <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--red)', lineHeight: 1.7 }}>
          ⚠ <b>ใบขั้น OP {plan.opUnset.length} ตัวยังไม่ได้ผูกว่ากินอะไร — ระบบไม่เดา จึงไม่ได้ขอของให้:</b>{' '}
          {plan.opUnset.slice(0, 5).map(x => `${x.mat_no}${x.parent ? ` (แม่ ${x.parent} ลูก ${x.parentKids} ตัว)` : ''} × ${fmtQty(x.qty)}`).join(' · ')}
          {' '}— ตั้งที่ /products แท็บ BOM ของขั้นนี้ (PE / หัวหน้างาน)
        </div>
      )}
      {plan && !plan.error && plan.orders > 0 && !planRows.length && !plan.noBom?.length && !plan.opUnset?.length && (
        <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--muted)' }}>ลูกใน BOM ทั้งหมดเป็นของที่พื้นที่นี้ผลิตเอง — ไม่มีอะไรต้องเบิกจากสโตร์</div>
      )}
      {planSend.length > 0 && (
        <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.7 }}>
          ครบกล่องแล้วแต่ยังไม่ได้แจ้ง (ใบผลิตเปิดก่อนมีระบบนี้ หรือเพิ่งเพิ่มยอด) — กด 🔁 เพื่อแจ้งสโตร์:{' '}
          {planSend.slice(0, 6).map(x => `${x.mat_no} × ${fmtQty(x.qty)}${x.coil ? ' kg' : ''}`).join(' · ')}{planSend.length > 6 ? ` · +${planSend.length - 6}` : ''}
        </div>
      )}
      {planWait.length > 0 && (
        <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.7 }}>
          ⏳ <b>ยังไม่ครบ 1 กล่อง — สะสมรอใบผลิตถัดไป {planWait.length} พาร์ท</b> (สโตร์ยังไม่เห็น):{' '}
          {planWait.slice(0, 6).map(x => `${x.mat_no} ขาด ${fmtQty(x.short)} / กล่อง ${fmtQty(x.pkg)}`).join(' · ')}{planWait.length > 6 ? ` · +${planWait.length - 6}` : ''}
        </div>
      )}
      {planNoPkg.length > 0 && (
        <div style={{ marginTop: 5, fontSize: 11.5, color: 'var(--red)', lineHeight: 1.7 }}>
          📦 <b>ยังไม่ตั้ง packing std {planNoPkg.length} พาร์ท — ระบบไม่แจ้งสโตร์ให้</b> (ตั้งขนาดกล่องที่ทะเบียนพาร์ท หรือกด ➕ ขอเบิกเอง):{' '}
          {planNoPkg.slice(0, 6).map(x => `${x.mat_no} ขาด ${fmtQty(x.short)}`).join(' · ')}{planNoPkg.length > 6 ? ` · +${planNoPkg.length - 6}` : ''}
        </div>
      )}
    </div>
  );

  /* ➕ ฟอร์ม "ขอเบิกพาร์ทนี้เลย" — ต้องเข้าถึงได้**ทุกสถานะของแผง** รวมตอนไม่มีอะไรต้องทำ
     (บทเรียน 15/10: จอที่ซ่อนตัวเองเมื่อไม่มีข้อมูล ห้ามเป็นที่เดียวที่เข้าถึงงานของตัวเอง) */
  const adhocBlock = !canDecide ? null : (
    <div style={{ marginBottom: 12 }}>
      {!adhocOpen ? (
        <button onClick={() => setAdhocOpen(true)} style={btn('rgba(34,197,94,0.1)', '#22c55e', 'rgba(34,197,94,0.35)')}>
          ➕ ขอเบิกพาร์ทนี้เลย
        </button>
      ) : (
        <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#22c55e', marginBottom: 6 }}>
            ➕ ขอเบิกพาร์ทนี้เลย <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· เลือกพาร์ทที่ไลน์นี้ผลิต = ใส่ยอดที่จะผลิต ระบบแตก BOM เป็นชิ้นส่วนที่ต้องเบิกให้</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* ช่องรับรหัสพาร์ทต้องเป็น picker กลาง ห้าม input เปล่า (UI-CONVENTIONS §5.1.2) */}
            {/* 🔒 05/11 (คำสั่ง user "ยังขึ้นของไลน์อื่นอยู่ ไม่ควรขึ้นเพื่อกันการงง") — `strict` = เฉพาะพาร์ทของไลน์นี้ (แม่/ลูก)
                + ชิ้นส่วนลูก BOM ของไลน์นี้ (`adhocExtra`) · ห้ามถอด strict */}
            <ProductSelect strict value={adhocMat} lines={pickLines} extraOptions={adhocExtra}
              placeholder="เลือกพาร์ทที่ต้องการ" style={{ width: 260 }} inputStyle={{ padding: '5px 26px 5px 10px', fontSize: 12 }}
              onChange={({ mat_no, opt, known }) => {
                setAdhocMat(mat_no); setAdhocKnown(!!opt && known !== false);
                setAdhocName(opt?.part_name || opt?.name || '');
              }} />
            {/* ⚠️ input ใน flex row ต้องกำหนด width เอง — index.css ตั้ง input{width:100%} จะดันปุ่มแตกแถว */}
            <input value={adhocQty} onChange={e => setAdhocQty(e.target.value)} inputMode="numeric"
              placeholder="จำนวน (ชิ้น)" style={{ width: 130, padding: '5px 10px', borderRadius: 7, fontSize: 12 }} />
            <button disabled={!!busy} onClick={placeAdhoc} style={btn('#22c55e', '#04140a')}>แจ้งสโตร์</button>
            <button onClick={() => { setAdhocOpen(false); setAdhocMat(''); setAdhocName(''); setAdhocQty(''); setAdhocKnown(false); }}
              style={btn('transparent', 'var(--muted)', 'var(--border2)')}>ยกเลิก</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
            ใบนี้จะขึ้นที่คิวสโตร์ทันทีโดยมีป้าย <b>“ไลน์ขอเบิกเอง”</b> (ถ้าครบกล่อง — ดูรายละเอียดใน popup ก่อนกดยืนยัน)
            {adhocMat && onHand.has(String(adhocMat).trim())
              ? <> · ตอนนี้หน้าไลน์มี <b>{fmtQty(onHand.get(String(adhocMat).trim()))}</b> ชิ้น</>
              : adhocMat ? <> · พาร์ทนี้<b>ยังไม่เคยมียอดหน้าไลน์นี้</b></> : null}
            {canSetLv && <> · ถ้าต้องเบิกพาร์ทนี้บ่อย ให้ไป <button onClick={() => setShowSetup(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 }}>ตั้งจุดเรียกเติม</button> แล้วระบบจะเตือนเอง</>}
          </div>
        </div>
      )}
    </div>
  );

  /* ไม่มีอะไรต้องทำ + ไม่ใช่หน้าตั้งค่า = ยังไม่รกจอผลิตเหมือนเดิม
     **แต่ต้องเหลือทางขอเบิกไว้** (เดิม return null ⇒ อยากเบิกตอนของยังไม่ถึง min = ไม่มีปุ่มให้กดเลย)
     🔴 26/10 (feedback สโตร์: *"ปุ่มเรียกชิ้นส่วนจากสโตร์ ขึ้นให้กดแค่บางไลน์ และขึ้นเฉพาะบาง User"*)
        เดิมกิ่งนี้ตัดด้วย `canDecide` อย่างเดียว ⇒ คนที่ตั้งจุดเรียกเติมได้ (`line_levels:manage` —
        รวม **สิทธิ์ระดับส่วน**) แต่ไม่มีสิทธิ์ตัดสินใจเบิก **ไม่เห็นแม้แต่ปุ่ม ⚙️ ตั้งจุดเรียกเติม**
        บนไลน์ที่ยังไม่ตั้ง min = ไก่กับไข่ตัวเดิมที่ 15/10 ตั้งใจปิดไปแล้ว แต่ยังเหลือรูนี้
     ⇒ เห็นกิ่งย่อนี้ถ้า "ขอเบิกได้" **หรือ** "ตั้งจุดเรียกเติมได้" · ไม่ได้ทั้งคู่ = ซ่อนเหมือนเดิม
        (ไม่มีอะไรให้กด การ์ดเปล่าบนจอผลิตทุกไลน์ = รกเปล่าๆ) */
  if (nothing && !alwaysShow) {
    if (!canDecide && !canSetLv) return null;
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: canDecide ? 10 : 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)' }}>เรียกชิ้นส่วนจากสโตร์</div>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            {lineName}{SHOW_LEVEL_REFILL ? ` · ${noLevel.length || split.produceNoStd?.length ? 'ยังไม่ได้ตั้งจุดเรียกเติม' : 'ไม่มีพาร์ทไหนถึงจุดเรียกเติม'}` : ''}
          </span>
          <button onClick={load} title="รีเฟรช" style={{ marginLeft: 'auto', ...btn('var(--bg3)', 'var(--text2)', 'var(--border2)') }}>↻</button>
          {canSetLv && (
            <button onClick={() => setShowSetup(true)} style={btn('var(--bg3)', 'var(--text2)', 'var(--border2)')}>
              ตั้งจุดเรียกเติม
            </button>
          )}
        </div>
        {orderBlock}
        {adhocBlock}
        {setupModal}
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>เรียกชิ้นส่วนจากสโตร์</div>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{lineName}</span>
        <button onClick={load} title="รีเฟรช"
          style={{ marginLeft: 'auto', ...btn('var(--bg3)', 'var(--text2)', 'var(--border2)') }}>↻</button>
        {canSetLv && (
          <button onClick={() => setShowSetup(true)} style={btn('var(--bg3)', 'var(--text2)', 'var(--border2)')}>
            ตั้งจุดเรียกเติม
          </button>
        )}
      </div>

      {/* 🧾 ความต้องการจากใบผลิต (05/11) + ➕ ขอเบิกเอง — อยู่บนสุดเสมอ */}
      {orderBlock}
      {adhocBlock}

      {/* โหลดไม่สำเร็จ = ต้องบอก ห้ามแสดงเป็น "ไม่มีอะไรต้องเบิก" */}
      {err?.msg && (
        <div style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '8px 11px', marginBottom: 10 }}>
          ⚠ โหลดข้อมูลไม่สำเร็จ — {err.msg} · ตัวเลขด้านล่างอาจไม่ครบ
        </div>
      )}

      {/* ⬆ ของยังกองที่ไลน์แม่ — ไม่นับเป็นของไลน์นี้ แต่ห้ามเงียบ
          นี่คือเหตุผลที่ระบบไม่เสนอเติมทั้งที่ยอดรวมในระบบดูเหมือนมี */}
      {/* 🙈 05/11 (คำสั่ง user) — ไม่โชว์ "ของค้างที่ไลน์แม่" แล้ว: การเบิกคิดรวมทั้งพื้นที่ SAP (แม่-ลูกนับที่เดียวกัน) */}
      {SHOW_LEVEL_REFILL && stuckUp.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text2)', background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '8px 11px', marginBottom: 10, lineHeight: 1.7 }}>
          <b style={{ color: '#f59e0b' }}>⬆ ของ {stuckUp.length} พาร์ทยังอยู่ที่ไลน์แม่ ไม่ได้อยู่หน้าไลน์นี้</b>
          <br />ระบบนับเฉพาะของที่อยู่ที่ <b>{lineName}</b> จริง (หน่วยย่อยที่สุด) — ของที่ไลน์แม่จึงไม่ถูกนับให้
          <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {stuckUp.slice(0, 8).map(s => (
              <span key={`${s.line_name}|${s.mat_no}`} style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 11 }}>
                {s.mat_no} · {fmtQty(s.qty)} <span style={{ color: 'var(--muted)' }}>@ {s.line_name}</span>
              </span>
            ))}
            {stuckUp.length > 8 && <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>+ อีก {stuckUp.length - 8}</span>}
          </div>
          <div style={{ marginTop: 5, color: 'var(--muted)' }}>ย้ายลงไลน์ย่อยที่ <b>Line Stock → แท็บ Stock → 🔀 ย้ายเข้าไลน์ลูก</b></div>
        </div>
      )}

      {whErr && (
        <div style={{ fontSize: 12, color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '8px 11px', marginBottom: 10 }}>
          ⚠ โหลดยอดคลัง (FG WAREHOUSE / STORE) ไม่สำเร็จ — {whErr} · พาร์ทที่ไลน์นี้ผลิตเองอาจถูกเทียบกับยอดหน้าไลน์แทน กด ↻ อีกครั้ง
        </div>
      )}

      {/* ── 🏭 ของที่ไลน์นี้ผลิตเอง: ยอดคลังต่ำกว่าจุดเรียกเติม → ต้องผลิตเติม (สัญญาณ ไม่สร้างใบเบิก) ── */}
      {SHOW_LEVEL_REFILL && (split.produceDue.length > 0 || split.produceUnknown.length > 0 || split.produceNoStd.length > 0) && (
        <div style={{ marginBottom: 12 }}>
          {split.produceDue.length > 0 && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#38bdf8', marginBottom: 6 }}>
                ยอดคลังต่ำกว่าขั้นต่ำ (แท็บคำนวณ Kanban) {split.produceDue.length} พาร์ท — ต้องผลิตเติม
              </div>
              {split.produceDue.map(s => {
                const short = s.have <= 0;
                return (
                  <div key={s.mat_no} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '7px 10px', marginBottom: 4,
                    background: short ? 'rgba(239,68,68,0.08)' : 'rgba(56,189,248,0.07)',
                    border: `1px solid ${short ? 'rgba(239,68,68,0.35)' : 'rgba(56,189,248,0.3)'}`, borderRadius: 8 }}>
                    <MatLabel mat={s.mat_no} size={12.5} />
                    <span style={{ fontSize: 11.5, color: short ? '#ef4444' : 'var(--muted)', fontWeight: short ? 800 : 400 }}>
                      {s.loc} เหลือ {fmtQty(s.have)} / ขั้นต่ำ {fmtQty(s.min)}{short ? ' · หมดแล้ว' : ''}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>
                      {s.suggestQty ? `ควรผลิต ${fmtQty(s.suggestQty)}` : 'Kanban ยังไม่ตั้ง max — กำหนดยอดผลิตเอง'}
                    </span>
                  </div>
                );
              })}
            </>
          )}
          {split.produceUnknown.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              ⚪ ยังเช็คไม่ได้ {split.produceUnknown.length} พาร์ท — ไม่มียอดในคลังเลย
              ({split.produceUnknown.slice(0, 6).map(s => `${s.mat_no} @ ${s.loc}`).join(' · ')}{split.produceUnknown.length > 6 ? ' …' : ''})
              · ไปตรวจนับที่ Line Stock ก่อน ระบบถึงจะเตือนได้
            </div>
          )}
          {split.produceNoStd.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              ⚪ ไลน์นี้ผลิตอีก {split.produceNoStd.length} พาร์ทที่ยังไม่ตั้งขั้นต่ำในแท็บ 🎴 คำนวณ Kanban — ระบบไม่เฝ้าพาร์ทพวกนี้
              ({split.produceNoStd.slice(0, 6).map(s => s.mat_no).join(' · ')}{split.produceNoStd.length > 6 ? ' …' : ''})
            </div>
          )}
        </div>
      )}

      {/* ── ถึงจุดเรียกเติม → ระบบเสนอ คนตัดสิน ── */}
      {SHOW_LEVEL_REFILL && suggest.length > 0 && (
        <div style={{ marginBottom: holds.length || inFlight.length ? 12 : 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>
            ⚠️ ถึงจุดเรียกเติม {suggest.length} พาร์ท — จะเบิกหรือพักไว้ก่อน?
          </div>
          {suggest.map(s => (
            <SuggestRow key={s.mat_no} s={s} canDecide={canDecide} busy={busy === s.mat_no}
              onPlace={place} onHold={hold} btn={btn} />
          ))}
          {!canDecide && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              ดูอย่างเดียว — คนตัดสินใจเบิกคือหัวหน้ากลุ่มของไลน์ (สิทธิ์ <code>wip_request:decide</code>)
            </div>
          )}
        </div>
      )}

      {/* ── พักไว้ก่อน — ต้องเห็นเสมอ ห้ามซ่อน (ต้นเหตุ "ลืมเบิกจนไลน์หยุด") ── */}
      {holds.length > 0 && (
        <div style={{ marginBottom: inFlight.length ? 12 : 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#f59e0b', marginBottom: 6 }}>
            ⏸ พักไว้ก่อน {holds.length} พาร์ท — ยังไม่ได้เบิก (ความต้องการยังอยู่)
          </div>
          {holds.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '7px 10px', marginBottom: 4,
              background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8 }}>
              <MatLabel mat={r.mat_no} name={r.part_name} size={12.5} />
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                ขอ {fmtQty(r.request_qty)} {qtyUnit(r.uom)} · พักเมื่อ {hhmm(r.hold_at)}{r.hold_by_name ? ` โดย ${r.hold_by_name}` : ''}
              </span>
              {r.hold_reason && <span style={{ fontSize: 11.5, color: 'var(--text2)', fontStyle: 'italic' }}>“{r.hold_reason}”</span>}
              {canDecide && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button disabled={busy === r.id} onClick={() => unhold(r)} style={btn('#f59e0b', '#1a1205')}>↩ เบิกเลย</button>
                  <button disabled={busy === r.id} onClick={() => cancel(r)} style={btn('transparent', 'var(--muted)', 'var(--border2)')}>✕ ไม่ใช้แล้ว</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── กำลังมาจากสโตร์ + ปุ่มรับของ (ขั้น 8 ปิดลูป) ── */}
      {inFlight.length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text2)', marginBottom: 6 }}>
            แจ้งสโตร์แล้ว {inFlight.length} รายการ
          </div>
          {inFlight.map(r => {
            const meta = ST[r.status] || { label: r.status, color: 'var(--muted)' };
            const wait = agoMin(r.requested_at);
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '7px 10px', marginBottom: 4,
                background: 'var(--bg3)', border: '1px solid var(--border2)', borderLeft: `3px solid ${meta.color}`, borderRadius: 8 }}>
                <MatLabel mat={r.mat_no} name={r.part_name} size={12.5} />
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {r.source === 'store_forecast' ? `🏬 สโตร์ส่งตามแผนผลิต ${fmtQty(r.request_qty)} ${qtyUnit(r.uom)} · เปิด ${hhmm(r.requested_at)}` : `ขอ ${fmtQty(r.request_qty)} ${qtyUnit(r.uom)} · แจ้ง ${hhmm(r.requested_at)}${r.source === 'line_adhoc' ? ' · ➕ ขอเอง' : ''}`}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: meta.color }}>{meta.label}</span>
                {wait != null && (
                  <span style={{ fontSize: 11, color: wait > 60 ? '#ef4444' : 'var(--muted)', fontWeight: wait > 60 ? 800 : 400 }}>
                    · รอมาแล้ว {wait} นาที
                  </span>
                )}
                {/* ขั้น 5 — สโตร์หยิบได้ไม่ครบต้องเห็นตั้งแต่ก่อนของมาถึง (ไม่ใช่เพิ่งรู้ตอนนับ) */}
                {['preparing', 'delivered'].includes(r.status) && r.picked_qty != null && Number(r.picked_qty) < Number(r.request_qty) && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#f59e0b' }}>⚠ สโตร์หยิบได้ {fmtQty(r.picked_qty)} / {fmtQty(r.request_qty)}</span>
                )}
                {/* เฟส 4 — ของถูกวางที่ไหน/ผ่านด่านทางไหน: สแกนจุด · ไลน์ยังไม่ตั้งจุด · หัวหน้าปลดบล็อก (override ต้องเห็น ห้ามซ่อน) */}
                {r.status === 'delivered' && r.delivered_gate && DELIVER_GATES[r.delivered_gate] && (
                  <span title={r.delivered_override_reason || ''} style={{ fontSize: 11, fontWeight: 700, color: DELIVER_GATES[r.delivered_gate].color }}>
                    {/* 🔴 ป้ายนี้คือ "ตอนส่งผ่านด่านทางไหน" (ประวัติ) ไม่ใช่สถานะทะเบียนวันนี้ —
                        ไลน์ที่เพิ่งตั้งจุดส่งทีหลัง ใบเก่ายังขึ้น "ยังไม่ตั้งจุดส่ง" ตลอดไป ต้องเขียนให้ชัด */}
                    {DELIVER_GATES[r.delivered_gate].icon} {r.delivered_gate === 'scanned' ? (r.delivered_point_name || DELIVER_GATES.scanned.label) : `${DELIVER_GATES[r.delivered_gate].label} ตอนส่ง`}
                  </span>
                )}
                {/* 📭 05/11 — ส่งแล้วยังไม่กดรับ ต้องเห็นว่าค้างมานานแค่ไหน (`unreceivedAge` · replenishGate.js) */}
                {(() => { const ua = unreceivedAge(r); return ua ? (
                  <span style={{ fontSize: 11, fontWeight: ua.overdue ? 800 : 600, color: ua.overdue ? 'var(--red)' : 'var(--amber)' }}>{ua.text}</span>
                ) : null; })()}
                {r.status === 'delivered' && canReceive && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button disabled={busy === r.id} onClick={() => receive(r, true)} style={btn('#22c55e', '#04140a')}>✔ รับครบ</button>
                    <button disabled={busy === r.id} onClick={() => receive(r, false)} style={btn('transparent', '#f59e0b', 'rgba(245,158,11,0.5)')}>⚠ ได้ไม่ครบ</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── worklist: ไลน์ยังไม่ตั้ง "จุดส่งงาน" — สโตร์ส่งได้ แต่ระบบตรวจไม่ได้ว่าวางถูกจุดไหม (เฟส 4 · ไม่รู้ = ห้ามบล็อก แต่ห้ามเงียบ) ── */}
      {!hasDeliveryPoint && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#f59e0b' }}>
          ไลน์นี้ยังไม่ตั้งจุดส่งงาน — สโตร์ยิง QR ยืนยันจุดวางของไม่ได้ · ตั้งที่ <b>ตั้งค่าผังไลน์ → 🎯 จุดส่งงาน</b> แล้วพิมพ์ป้ายที่ 🏷️ พิมพ์ป้าย QR
        </div>
      )}

      {/* ── worklist: พาร์ทที่ยังไม่ตั้งจุดเรียกเติม — ไม่ตั้ง = ระบบไม่มีวันเตือน ── */}
      {SHOW_LEVEL_REFILL && noLevel.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
          <button onClick={() => setShowNoLevel(v => !v)}
            style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 }}>
            {showNoLevel ? '▾' : '▸'} ⚠️ ยังไม่ได้ตั้งจุดเรียกเติม {noLevel.length} พาร์ท — ระบบจะไม่เตือนพาร์ทพวกนี้
          </button>
          {showNoLevel && (
            <div style={{ marginTop: 5, lineHeight: 1.7 }}>
              {noLevel.slice(0, 20).map(([mat, q]) => `${mat} (${fmtQty(q)})`).join(' · ')}
              {noLevel.length > 20 ? ` … และอีก ${noLevel.length - 20}` : ''}
              {canSetLv && <> · <button onClick={() => setShowSetup(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: 0 }}>ตั้งเลย →</button></>}
            </div>
          )}
        </div>
      )}

      {setupModal}
    </div>
  );
}

/* ── แถวเสนอ: จำนวนแก้ได้ก่อนกดเบิก (ระบบเสนอ คนตัดสิน) ─────────────────────── */
function SuggestRow({ s, canDecide, busy, onPlace, onHold, btn }) {
  const [qty, setQty] = useState(s.suggestQty ?? '');
  const short = s.have <= 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', padding: '7px 10px', marginBottom: 4,
      background: short ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.07)',
      border: `1px solid ${short ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.3)'}`, borderRadius: 8 }}>
      <MatLabel mat={s.mat_no} size={12.5} />
      <span style={{ fontSize: 11.5, color: short ? '#ef4444' : 'var(--muted)', fontWeight: short ? 800 : 400 }}>
        เหลือ {fmtQty(s.have)} / จุดเรียกเติม {fmtQty(s.min)}{short ? ' · หมดแล้ว' : ''}
      </span>
      {canDecide && (
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="number" value={qty} onChange={e => setQty(e.target.value)} placeholder="จำนวน"
            title={s.suggestQty ? `ระบบเสนอ ${s.suggestQty} (เติมให้ถึง max)` : 'ยังไม่ได้ตั้ง max/จำนวนเบิก — กรอกเอง'}
            style={{ width: 84, padding: '4px 8px', borderRadius: 6, fontSize: 12 }} />
          <button disabled={busy} onClick={() => onPlace(s, qty)} style={btn('#22c55e', '#04140a')}>เบิก</button>
          <button disabled={busy} onClick={() => onHold(s)} style={btn('transparent', '#f59e0b', 'rgba(245,158,11,0.5)')}>⏸ พักไว้</button>
        </span>
      )}
    </div>
  );
}

/* ── ตั้ง min/max ต่อไลน์ (หัวหน้าไลน์ + หัวหน้าแผนกผลิต — ไม่ใช่ Planning) ──── */
function LevelSetupModal({ lineName, lines = [], upMats = [], levels, onHand, refHave = new Map(), fullName, onClose }) {
  /* ⚠️ ต้องรวม "พาร์ทที่ยังค้างอยู่ที่ไลน์แม่" (upMats) เข้ามาด้วย
     ไลน์ลูกที่ยังไม่เคยมีแถวสต็อกจะได้ไม่เปิดมาเจอลิสต์ว่างแล้วตั้งอะไรไม่ได้เลย
     — ซึ่งเป็นสภาพจริงของทุกไลน์ตอนนี้ (ของยังกองที่ไลน์แม่) */
  /* 📜 MAT ที่ "ไลน์นี้" เคยตั้งระดับไว้ — Product Master/BOM ยังไม่มีก็ยังเลือกซ้ำได้
     🔒 05/11 (คำสั่ง user "ตั้งจุดเรียกเติมก็ไม่ควรขึ้นของไลน์อื่น") — เดิมดึงประวัติทั้งตาราง (ทุกไลน์) ⇒ เหลือเฉพาะของไลน์นี้ */
  const levelMatHist = useMemo(() => [...new Set((levels || []).map(l => String(l.mat_no || '').trim().toUpperCase()).filter(Boolean))],
    [levels]);
  const [rows, setRows] = useState(() => {
    const byMat = new Map(levels.map(l => [l.mat_no, l]));
    const mats = [...new Set([...byMat.keys(), ...onHand.keys(), ...upMats, ...refHave.keys()])].sort();
    return mats.map(m => {
      const l = byMat.get(m);
      return { mat_no: m, id: l?.id || null, min_qty: l?.min_qty ?? '', max_qty: l?.max_qty ?? '',
               reorder_qty: l?.reorder_qty ?? '',
               // 🏭 ของที่ไลน์นี้ผลิตเอง = ยอดคลังปลายทาง (ไม่ใช่หน้าไลน์) · loc บอกว่าเทียบกับที่ไหน
               have: refHave.has(m) ? refHave.get(m).have : (onHand.get(m) ?? null), loc: refHave.get(m)?.loc || null,
               std: refHave.get(m) || null,   // 🎴 ของที่ไลน์ผลิตเอง — ขั้นต่ำ/สูงสุดมาจากแท็บคำนวณ Kanban (อ่านอย่างเดียว)
               atParent: !onHand.has(m) && upMats.includes(m) };
    });
  });
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [newMat, setNewMat] = useState('');
  const [newMatKnown, setNewMatKnown] = useState(false); // เลือกจากทะเบียนแล้ว (ไม่ใช่พิมพ์เอง)
  const set = (i, k, v) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));

  /* 2026-09-07 "เพิ่มพาร์ทเอง" ต้องเลือกจากทะเบียน (Product Master ∪ พาร์ทลูก BOM ของครอบครัวไลน์) — ไม่ allowFree
     mat_no ที่พิมพ์ผิดจะกลายเป็นจุดเฝ้าที่ไม่ match สต็อกแถวไหนเลย → min alert ไม่เคยดังโดยไม่มีใครรู้ */
  const famNames = useMemo(() => [...new Set([lineName, ...getAncestorNames(lines, lineName), ...getChildLineNames(lines, lineName)])].filter(Boolean), [lines, lineName]);
  /* 21/10 — ย้ายตัวโหลดไปเป็นฮุคร่วม `useBomChildOptions` (ฟอร์ม "ขอเบิกพาร์ทนี้เลย" ใช้ชุดเดียวกัน) */
  const bomExtra = useBomChildOptions(famNames);

  const addMat = () => {
    const m = newMat.trim();
    if (!m) return;
    // 2026-09-07 นอกทะเบียน (กลุ่ม 📜 เคยบันทึกไว้) → ถามยืนยันแทนบล็อกแข็ง — พิมพ์ผิด = จุดเฝ้าที่ไม่เคยเตือน จึงเตือนชัด
    if (!newMatKnown && !window.confirm(`"${m}" ไม่มีใน Product Master / BOM — ใช้ค่านี้ต่อหรือไม่?`)) return;
    if (rows.some(r => r.mat_no.toLowerCase() === m.toLowerCase())) { toast.info('มีพาร์ทนี้ในรายการแล้ว'); setNewMat(''); setNewMatKnown(false); return; }
    setRows(rs => [{ mat_no: m, id: null, min_qty: '', max_qty: '', reorder_qty: '', have: null, atParent: false }, ...rs]);
    setNewMat(''); setNewMatKnown(false);
  };

  const save = async () => {
    setSaving(true);
    /* เขียนเฉพาะแถวที่กรอก min มา — ไม่กรอก = ไม่เฝ้าพาร์ทนั้น (ไม่สร้างแถวเปล่าให้รก)
       ⚠️ line_name = ไลน์ที่กำลังเปิดอยู่เสมอ ไม่ใช่ไลน์แม่ — min เป็นค่าของ "จุดใช้งาน" */
    // 🎴 ของที่ไลน์ผลิตเอง ไม่เขียนที่นี่ — ขั้นต่ำ/สูงสุดมีที่เดียวคือแท็บคำนวณ Kanban
    const up = rows.filter(r => !r.std && r.min_qty !== '' && r.min_qty != null).map(r => ({
      line_name: lineName, mat_no: r.mat_no,
      min_qty: num(r.min_qty), max_qty: num(r.max_qty), reorder_qty: num(r.reorder_qty),
      is_active: true, updated_by_name: fullName || null,
    }));
    if (!up.length) { setSaving(false); onClose(); return; }
    const { error } = await supabaseDR.from('line_part_levels')
      .upsert(up, { onConflict: 'line_name,mat_no' });
    setSaving(false);
    if (error) { toast.error(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    toast.success(`บันทึกจุดเรียกเติม ${up.length} พาร์ท`);
    onClose();
  };

  const shown = rows.filter(r => !q.trim() || r.mat_no.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* ⚠️ ไม่ปิดจากการคลิกพื้นหลัง — กรอกตัวเลขหลายสิบช่องแล้วเผลอแตะ = หายทั้งหมด (UI-CONVENTIONS §5) */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 12, width: 'min(820px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border2)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>ตั้งจุดเรียกเติม — {lineName}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.6 }}>
            เหลือถึง <b>min</b> เมื่อไหร่ ระบบจะเสนอให้เบิก · <b>max</b> ใช้คำนวณว่าเบิกเท่าไหร่ (เติมให้เต็ม)
            <br />ไม่กรอก min = <b>ไม่เฝ้าพาร์ทนั้น</b> ระบบจะไม่เตือนเลย — คนที่ยืนหน้าไลน์เป็นคนรู้ว่าควรตั้งเท่าไหร่
            <br />🏭 พาร์ทที่ <b>ไลน์นี้ผลิตเอง</b> เทียบกับ<b>ยอดคลัง</b> (เบอร์ 1 = FG WAREHOUSE · เบอร์ 2 = STORE ตามกฎรับเข้า) แล้วเตือนให้<b>ผลิตเติม</b> — ไม่ใช่เบิก
            · ขั้นต่ำ/สูงสุดของพาร์ทพวกนี้ <b>แก้ที่ /planner-sales แท็บ 🎴 คำนวณ Kanban</b> ที่เดียว (ที่นี่อ่านอย่างเดียว)
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* ⚠️ input ใน flex row ต้องกำหนด width เอง — index.css ตั้ง input{width:100%} จะดันปุ่มแตกแถว */}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหารหัสพาร์ท"
              style={{ width: 200, padding: '5px 10px', borderRadius: 7, fontSize: 12 }} />
            <span style={{ color: 'var(--border2)' }}>|</span>
            {/* 2026-09-07 <ProductSelect> — Product Master (ไลน์นี้ขึ้นก่อน) ∪ พาร์ทลูก BOM ∪ 📜 เคยตั้งไว้ · ไม่รับค่าพิมพ์เอง (known=false = นอกทะเบียน → ถามยืนยัน) */}
            {/* 🔒 strict = เฉพาะพาร์ทของไลน์นี้ (แม่/ลูก) + ลูก BOM ของไลน์นี้ (05/11 · ห้ามถอด) */}
            <ProductSelect strict value={newMat} lines={famNames} extraOptions={bomExtra} history={levelMatHist} placeholder="เพิ่มพาร์ท (เลือกจากทะเบียน)"
              style={{ width: 240 }} inputStyle={{ padding: '5px 26px 5px 10px', fontSize: 12 }}
              onChange={({ mat_no, opt, known }) => { setNewMat(mat_no); setNewMatKnown(!!opt && known !== false); }} />
            <button onClick={addMat} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>+ เพิ่ม</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 18px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'left' }}>
              <th style={{ padding: '4px 0' }}>รหัสพาร์ท</th>
              <th style={{ textAlign: 'right' }}>ยอดที่ใช้เทียบ</th>
              <th style={{ width: 90 }}>min</th><th style={{ width: 90 }}>max</th><th style={{ width: 110 }}>เบิกครั้งละ</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const i = rows.indexOf(r);
                return (
                  <tr key={r.mat_no} style={{ borderTop: '1px solid var(--border2)' }}>
                    <td style={{ padding: '5px 0', fontWeight: 700, color: 'var(--text)' }}>
                      {r.mat_no}
                      {/* ของยังอยู่ที่ไลน์แม่ — ตั้ง min ไว้ล่วงหน้าได้ แต่ต้องรู้ว่ายังไม่ใช่ของไลน์นี้ */}
                      {r.atParent && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--accent2)', fontWeight: 700 }}>⬆ ยังอยู่ไลน์แม่</span>}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--muted)', paddingRight: 10 }}>
                      {r.have == null ? <span title="ไม่มีแถวสต็อก — ยังเช็คไม่ได้ ไม่ใช่ของหมด">—</span> : fmtQty(r.have)}
                      <div style={{ fontSize: 11, color: r.loc ? '#38bdf8' : 'var(--muted)' }}>{r.loc ? `🏭 ${r.loc}` : 'หน้าไลน์'}</div>
                    </td>
                    {r.std ? (
                      <td colSpan={3} style={{ padding: '3px 4px 3px 0', fontSize: 11.5, color: 'var(--text2)' }}>
                        {r.std.min != null ? `ขั้นต่ำ ${fmtQty(r.std.min)} · สูงสุด ${fmtQty(r.std.max)}` : 'ยังไม่ตั้งในแท็บคำนวณ Kanban'}
                        <span style={{ color: 'var(--muted)' }}> — แก้ที่แท็บคำนวณ Kanban</span>
                      </td>
                    ) : ['min_qty', 'max_qty', 'reorder_qty'].map(k => (
                      <td key={k} style={{ padding: '3px 4px 3px 0' }}>
                        <input type="number" value={r[k]} onChange={e => set(i, k, e.target.value)}
                          style={{ width: '100%', padding: '3px 7px', borderRadius: 6, fontSize: 12 }} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>ไม่มีพาร์ทที่ตรงกับคำค้น</div>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border2)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 12.5, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>ยกเลิก</button>
          <button onClick={save} disabled={saving} style={{ fontSize: 12.5, fontWeight: 800, padding: '7px 18px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent)', border: 'none', color: 'var(--accent-ink)' }}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
