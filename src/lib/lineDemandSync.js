/* 🔁 ไลน์ผลิต → สโตร์ : ออกใบเบิก-ส่งเข้าไลน์จาก "ใบผลิตที่เปิดอยู่" + ที่ขอเพิ่มเอง (2026-11-05 · คำสั่ง user)
   user: *"เมื่อกดเปิด order ระบบจะแตก bom ไปเรียกลูกที่จะใช้งาน และคิดกับ wip ค้างในไลน์ว่าพอมั้ย ถ้าไม่พอจะสะสม
          จนครบ packing std. เมื่อครบจะแจ้งไปหาส่วนสโตร์ เพื่อเตรียมงานส่งของให้ไลน์ผลิต
          หรือสามารถกดเบิกเองจากช่องด้านขวา ด้วยหลักการเดียวกัน"*
   🔴 ทิศนี้ = "สโตร์จ่ายออกให้ไลน์" (ความต้องการของไลน์) — **คนละเรื่องกับ "เติมของเข้าสโตร์"** (ใบล็อตผลิต/ใบขอซื้อ)
   · ลูกที่ต้องใช้ = `fn_bom_direct_demand(FG)` (DR) — ชุดเดียวกับที่ระบบตัดสต็อกตอน confirm ใบ (ลูกตรงชั้นเดียว)
   · ลูกที่ไลน์นี้ผลิตเอง = ไม่เบิก (ขอผิดทิศ · `madeHereMats`)
   · กฎตัดสินต่อ ไลน์+พาร์ท = `planLineRequest()` (utils/packRound.js) — packing std = `parts_master.qty_per_pkg`
   · 🔴 อ่านอะไรไม่ได้ = ไม่เขียนเลย (fail-closed) แล้วคืน error ให้จอบอก */
import { supabase, supabaseDR } from '../supabaseClient';
import { loadProductsMaster } from '../utils/useProducts';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { SESSION_STATUSES_LIVE } from '../utils/sessionStatus';
import { madeHereMats } from '../utils/partRefStock';
import { planLineRequest } from '../utils/packRound';
import { isCoilUom } from '../utils/coilUom';
import { planConfirmText } from '../utils/linePlanText';
import { getActor } from '../utils/actorStamp';
import { can } from '../utils/permissions';
import { loadStorageLocations } from '../utils/useStorageLocations';
import { loadProductionLines } from '../utils/useProductionLines';
import { areaLinesOf } from '../utils/storageLoc';
import { opInputsOf, parentKidsAfterOps, isFirstOpInChain } from '../utils/opInputs';

const key = (s) => String(s ?? '').trim();

/**
 * 📍 พื้นที่ SAP ของไลน์ (05/11 · คำสั่ง user "แม่-ลูกในพื้นที่ SAP เดียวกันนับว่าอยู่ที่เดียวกัน")
 * @returns {Promise<{ error?: string, code: string|null, lines: string[] }>}  ไม่ผูก = เฉพาะไลน์ตัวเอง
 */
export async function loadArea(lineName) {
  const line = key(lineName);
  try {
    const [slocs, lines] = await Promise.all([loadStorageLocations(), loadProductionLines()]);
    return areaLinesOf(slocs || [], lines || [], line);
  } catch (e) {
    return { code: null, lines: [line], error: `อ่านทะเบียนพื้นที่ SAP ไม่ได้ (${e?.message || e})` };
  }
}

/**
 * ความต้องการลูกตรงจาก "ใบผลิตที่เปิดอยู่" ของไลน์ในพื้นที่ (ยังไม่หักของ · ไม่รวมลูกที่พื้นที่นี้ผลิตเอง)
 * ใช้ร่วม: ตัวออกใบ (ข้างล่าง) + จอสโตร์เช็คว่าใบเบิกยังมีใบผลิตรองรับไหม (`openDemandMatsByLine`)
 * @param {string|string[]} lineNames  ไลน์เดียว หรือทุกไลน์ในพื้นที่
 * @returns {Promise<{ error?: string, need: Map, made: Set, orders: number, noBom: Array<{mat_no, qty}> }>}
 *   noBom = ใบผลิตที่เปิดอยู่แต่ MAT นั้นไม่มีลูกใน BOM (แตกไม่ได้ ⇒ ไม่มีอะไรไปแจ้งสโตร์ — ต้องเขียนบนจอ)
 */
export async function loadOpenOrderDemand(lineNames, products = null) {
  const ls = [...new Set((Array.isArray(lineNames) ? lineNames : [lineNames]).map(key).filter(Boolean))];
  const out = { need: new Map(), made: new Set(), orders: 0, noBom: [], opUnset: [] };
  if (!ls.length) return { ...out, error: 'ไม่รู้ไลน์' };
  const [ordRes, prods] = await Promise.all([
    fetchAllPages(() => supabaseDR.from('prod_orders')
      .select('id, mat_no, qty, production_sessions!inner(line_name, status)')
      .eq('status', 'open').in('production_sessions.line_name', ls).in('production_sessions.status', SESSION_STATUSES_LIVE)),
    products ? Promise.resolve(products) : loadProductsMaster().catch(() => null),
  ]);
  if (ordRes.error || ordRes.truncated) return { ...out, error: 'อ่านใบผลิตที่เปิดอยู่ไม่ได้' };
  if (!prods) return { ...out, error: 'อ่านทะเบียนสินค้าไม่ได้' };
  const made = new Set(ls.flatMap(l => madeHereMats(l, prods)));
  const qtyByFg = new Map();
  for (const o of ordRes.rows || []) {
    const m = key(o.mat_no); const q = Number(o.qty) || 0;
    if (m && q > 0) qtyByFg.set(m, (qtyByFg.get(m) || 0) + q);
  }
  /* 🔩 08/11 — ขั้น OP: ของที่กิน = BOM ของขั้นเอง → ยังไม่ผูก+แม่มีลูกตัวเดียว = ลูกตัวนั้น → ไม่งั้น `opUnset` (เตือน ไม่เดา)
     ใบแม่ = ลูก BOM SAP หักของที่ขั้น OP ของมันกินแล้ว · ลูกที่เป็นแถวขั้น OP = ของที่ทำในพื้นที่ ไม่เบิก (เหมือน trigger ตอนตัด) */
  const prodOf = new Map((prods || []).filter(p => p?.is_active !== false).map(p => [key(p.mat_no), p]));
  const isOp = (m) => !!prodOf.get(key(m))?.is_operation;
  const opsOf = new Map();   // แม่ → [ขั้น OP]
  (prods || []).forEach(p => {
    if (p?.is_active === false || !p?.is_operation || !key(p.op_parent_mat)) return;
    const par = key(p.op_parent_mat);
    opsOf.set(par, [...(opsOf.get(par) || []), key(p.mat_no)]);
  });
  const fgs = [...qtyByFg.keys()];
  const want = new Set(fgs);
  fgs.forEach(fg => {
    if (isOp(fg)) { const par = key(prodOf.get(fg)?.op_parent_mat); if (par) want.add(par); }
    else (opsOf.get(fg) || []).forEach(op => want.add(op));
  });
  const mats = [...want];
  const bomRes = await Promise.all(mats.map(m => supabaseDR.rpc('fn_bom_direct_demand', { p_fg_mat: m })));
  const bomErr = bomRes.find(r => r.error);
  if (bomErr) return { ...out, made, error: `แตก BOM ไม่ได้ (${bomErr.error.message})` };
  const kidsOf = new Map(mats.map((m, i) => [m, bomRes[i].data || []]));
  const need = new Map();
  const noBom = [];
  const opUnset = [];
  fgs.forEach(fg => {
    const qty = qtyByFg.get(fg);
    let kids;
    if (isOp(fg)) {
      const par = key(prodOf.get(fg)?.op_parent_mat);
      const parentKids = par ? (kidsOf.get(par) || []) : [];
      const sibs = (opsOf.get(par) || []).map(m => prodOf.get(m)).filter(Boolean);
      const r = opInputsOf({ ownKids: kidsOf.get(fg) || [], parentKids, firstInChain: isFirstOpInChain(prodOf.get(fg), sibs) });
      if (r.via === 'from_prev') return;   // ขั้นถัดไปในโซ่ — ของมาจากขั้นก่อนหน้าในพื้นที่ ไม่เบิกสโตร์
      if (r.via === 'unset') { opUnset.push({ mat_no: fg, parent: par || null, parentKids: parentKids.length, qty }); return; }
      kids = r.kids;
    } else {
      const own = kidsOf.get(fg) || [];
      if (!own.length) { noBom.push({ mat_no: fg, qty }); return; }
      const sibs = (opsOf.get(fg) || []).map(m => prodOf.get(m)).filter(Boolean);
      const eaten = (opsOf.get(fg) || []).map(op => opInputsOf({ ownKids: kidsOf.get(op) || [], parentKids: own,
        firstInChain: isFirstOpInChain(prodOf.get(op), sibs) }).kids);
      kids = parentKidsAfterOps(own, eaten);
    }
    kids.forEach(k => {
      const m = key(k.mat_no); const q = qty * (Number(k.qty_per_unit) || 0);
      if (!m || !(q > 0) || made.has(m) || isOp(m)) return;
      const cur = need.get(m) || { need: 0, part_name: k.part_name || null };
      cur.need += q; cur.part_name = cur.part_name || k.part_name || null;
      need.set(m, cur);
    });
  });
  return { need, made, orders: (ordRes.rows || []).length, noBom, opUnset };
}

/**
 * 🧾 จอสโตร์: ไลน์ไหน "ยังมีใบผลิตเปิดอยู่ (ทั้งพื้นที่ SAP) ที่ใช้พาร์ทนี้" — ใบเบิกจากใบผลิต (`line_order`) ที่ไม่มีใบผลิตรองรับแล้ว
 * = ใบผลิตต้นทางปิด/ยกเลิก ⇒ เตือนบนการ์ด ให้คนตัดสินเอง (ระบบไม่ยกเลิก/ลดยอดเอง · คำสั่ง user 05/11)
 * @returns {Promise<Map<string, Set<string>|null>>} null = อ่านไม่ได้ (ห้ามเตือน — ไม่รู้ ≠ ไม่มี)
 */
export async function openDemandMatsByLine(lineNames = []) {
  const lines = [...new Set(lineNames.map(key).filter(Boolean))];
  const products = await loadProductsMaster().catch(() => null);
  const res = await Promise.all(lines.map(async l => {
    const a = await loadArea(l);
    if (a.error) return { error: a.error };
    return loadOpenOrderDemand(a.lines, products);
  }));
  return new Map(lines.map((l, i) => [l, res[i].error ? null : new Set(res[i].need.keys())]));
}

const NO_PERM = 'บัญชีนี้ไม่มีสิทธิ์แจ้งสโตร์ (wip_request:decide / wip_request:receive) — ให้หัวหน้าไลน์กด หรือขอสิทธิ์ที่ /permissions';
/** สิทธิ์ชุดเดียวกับ RLS ของ wip_replenish_requests (Main) */
export const canNotifyStore = (role) => can('wip_request', 'decide', role) || can('wip_request', 'receive', role)
  || can('heijunka', 'operate', role) || can('line_levels', 'manage', role);

/**
 * 💬 คำนวณ → popup ให้คนเห็นก่อน (หน่วย · ของหน้าไลน์ · ขาด · สะสมอีกเท่าไหร่) → ตกลงแล้วค่อยเขียน (05/11 · คำสั่ง user)
 * ใช้ทั้งตอนเปิดใบผลิต (DailyReport) และตอนกดขอเบิกเอง/แตก BOM (LinePartCallPanel)
 * @returns ผลแบบ syncLineOrderDemand + `cancelled` (คนกดยกเลิก) / `nothingToSend` (ไม่มีอะไรต้องแจ้ง แสดงให้ดูแล้ว)
 */
export async function confirmAndSyncLineDemand({ lineName, role, extra = [], title = '', focus = [],
  confirmFn = (t) => window.confirm(t), alertFn = (t) => window.alert(t) }) {
  const empty = { rows: [], inserted: 0, raised: 0, dup: 0, writeErrors: [] };
  if (!canNotifyStore(role)) return { ...empty, error: NO_PERM };
  const dry = await syncLineOrderDemand({ lineName, role, extra, dryRun: true });
  if (dry.error) return dry;
  /* ไม่มีอะไรต้องคิด: ไม่มีใบผลิต = เงียบได้ · ใบผลิตไม่มี BOM = ต้องบอก (แตกไม่ได้ ไม่ใช่ "ของพอ") */
  if (!dry.rows.length && !dry.noBom?.length && !dry.opUnset?.length) return dry;
  const { text, sendCount } = planConfirmText(dry.rows, { title, focus, area: dry.area, noBom: dry.noBom, opUnset: dry.opUnset });
  if (!sendCount) { alertFn(text); return { ...dry, nothingToSend: true }; }
  if (!confirmFn(text)) return { ...dry, cancelled: true };
  return syncLineOrderDemand({ lineName, role, extra });
}

/**
 * @param {{ lineName: string, role: string, extra?: {mat_no, part_name?, need}[], dryRun?: boolean }} a
 *   extra = ที่ไลน์กดขอเพิ่มเอง (แตก BOM แล้ว) — บวกเข้ากับความต้องการจากใบผลิตที่เปิดอยู่
 *   🧲 extra ที่เป็นเหล็ก coil (kg) ต้องมาจากการแตก BOM (`viaBom: true`) — ขอ coil ตรงๆ = ไม่เขียน + คืน error
 * @returns {Promise<{ error?: string, rows: Array, inserted: number, raised: number, dup: number, writeErrors: string[] }>}
 */
export async function syncLineOrderDemand({ lineName, role, extra = [], dryRun = false }) {
  const line = key(lineName);
  const empty = { rows: [], inserted: 0, raised: 0, dup: 0, writeErrors: [] };
  if (!line) return { ...empty, error: 'ไม่รู้ไลน์' };
  /* สิทธิ์ชุดเดียวกับ RLS ของ wip_replenish_requests (Main) — ไม่มี = ไม่เขียน + บอกตรงๆ (ห้ามปล่อยให้ได้ error ดิบ) */
  const canWrite = canNotifyStore(role);
  if (!dryRun && !canWrite) return { ...empty, error: NO_PERM };

  // 0) 📍 พื้นที่ SAP — แม่/ลูก/พี่น้องในรหัสเดียวกันนับเป็นที่เดียว (ความต้องการ · ของคงเหลือ · ใบรอหยิบ)
  const area = await loadArea(line);
  if (area.error) return { ...empty, error: area.error };
  const areaLines = area.lines;
  // 1-2) ใบผลิตที่เปิดอยู่ (ทั้งพื้นที่) → แตก BOM ลูกตรง (ชุดเดียวกับตอนตัดสต็อก)
  const od = await loadOpenOrderDemand(areaLines);
  if (od.error) return { ...empty, area, error: od.error };
  empty.area = area; empty.orders = od.orders; empty.noBom = od.noBom; empty.opUnset = od.opUnset;
  const made = od.made;
  const need = new Map();   // mat → { need, part_name, fromOrders, direct }
  const add = (mat, q, name, fromOrders, direct = false) => {
    const m = key(mat); if (!m || !(q > 0) || made.has(m)) return;
    const cur = need.get(m) || { need: 0, part_name: name || null, fromOrders: false, direct: false };
    cur.need += q; cur.part_name = cur.part_name || name || null; cur.fromOrders = cur.fromOrders || fromOrders;
    cur.direct = cur.direct || direct;
    need.set(m, cur);
  };
  od.need.forEach((v, m) => add(m, v.need, v.part_name, true));
  (extra || []).forEach(x => add(x.mat_no, Number(x.need) || 0, x.part_name, false, !x.viaBom));
  const mats = [...need.keys()];
  if (!mats.length) return { ...empty };   // area/orders/noBom ติดไปด้วย — จอต้องบอกได้ว่า "ไม่มีใบ" หรือ "ใบไม่มี BOM"

  // 3) ยอดหน้าไลน์ · packing std · ใบรอหยิบที่มีอยู่
  const [stk, pkgs, pend] = await Promise.all([
    fetchByIds(mats, ms => supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand').in('line_name', areaLines).in('mat_no', ms), { orderBy: 'mat_no' }),
    fetchByIds(mats, ms => supabaseDR.from('parts_master').select('mat_no, qty_per_pkg, uom, is_active').in('mat_no', ms), { orderBy: 'mat_no' }),
    fetchByIds(mats, ms => supabase.from('wip_replenish_requests').select('id, line_name, mat_no, request_qty, status').in('line_name', areaLines).eq('status', 'pending').in('mat_no', ms), { orderBy: 'mat_no' }),
  ]);
  if (stk.error || stk.truncated) return { ...empty, error: 'อ่านยอดหน้าไลน์ไม่ได้' };
  if (pkgs.error || pkgs.truncated) return { ...empty, error: 'อ่าน packing std ไม่ได้' };
  if (pend.error || pend.truncated) return { ...empty, error: 'อ่านใบเบิกที่รอหยิบไม่ได้' };
  /* ของคงเหลือ = รวมทุกไลน์ในพื้นที่ (ติดลบของไลน์หนึ่งหักกับบวกของอีกไลน์ — ยอดสุทธิของพื้นที่) */
  const onHand = new Map();
  (stk.rows || []).forEach(r => { const m = key(r.mat_no); onHand.set(m, (onHand.get(m) || 0) + (Number(r.qty_on_hand) || 0)); });
  const pkgOf = new Map((pkgs.rows || []).filter(r => r.is_active !== false).map(r => [key(r.mat_no), r.qty_per_pkg]));
  /* ใบรอหยิบทั้งพื้นที่: ยอดรวม + ใบที่จะเพิ่มยอด (ของไลน์ตัวเองก่อน · ไม่มีก็ใบแรกของพื้นที่ — ปลายทางพื้นที่เดียวกัน) */
  const pendOf = new Map();
  (pend.rows || []).forEach(r => {
    const m = key(r.mat_no); const cur = pendOf.get(m) || { sum: 0, pick: null };
    cur.sum += Number(r.request_qty) || 0;
    if (!cur.pick || (key(r.line_name) === line && key(cur.pick.line_name) !== line)) cur.pick = r;
    pendOf.set(m, cur);
  });
  const coil = new Set((pkgs.rows || []).filter(r => r.is_active !== false && isCoilUom(r.uom)).map(r => key(r.mat_no)));
  /* 🧲 05/11 (คำสั่ง user "ต้องเบิกผ่านพาร์ท") — coil ขอตรงไม่ได้: ไลน์ไม่รู้ว่าต้องใช้กี่ kg ต้องให้ BOM คิดจากพาร์ทที่จะผลิต */
  const directCoil = mats.filter(m => coil.has(m) && need.get(m).direct);
  if (directCoil.length) return { ...empty, error: `${directCoil.join(', ')} เป็นเหล็ก coil (จ่ายเป็น kg) — ขอเบิกตรงไม่ได้ ให้เลือกพาร์ทที่จะผลิต ระบบแตก BOM คิด kg ให้` };

  // 4) ตัดสิน + เขียน
  const rows = mats.sort().map(m => {
    const n = need.get(m); const p = pendOf.get(m);
    return { mat_no: m, part_name: n.part_name, fromOrders: n.fromOrders, pendingId: p?.pick?.id || null,
      pendPickQty: Number(p?.pick?.request_qty) || 0, pendPickLine: p?.pick?.line_name || null,
      ...planLineRequest({ need: n.need, onHand: onHand.get(m) ?? 0, pendingQty: p?.sum, pkg: pkgOf.get(m), coil: coil.has(m) }), uom: coil.has(m) ? 'KG' : null };
  });
  const res = { rows, inserted: 0, raised: 0, dup: 0, raceSkipped: 0, writeErrors: [], area, orders: od.orders, noBom: od.noBom, opUnset: od.opUnset };
  if (dryRun) return res;
  const who = getActor();
  for (const r of rows) {
    if (r.action === 'insert') {
      const { error } = await supabase.from('wip_replenish_requests').insert({
        line_name: line, mat_no: r.mat_no, part_name: r.part_name, request_qty: r.qty, status: 'pending', uom: r.uom,
        source: r.fromOrders ? 'line_order' : 'line_adhoc', requested_at: new Date().toISOString(),
        requested_by: who.name || null, requested_by_uid: who.uid || null, on_hand_at_req: onHand.get(r.mat_no) ?? null, min_at_req: null,
      });
      if (!error) res.inserted++;
      else if (error.code === '23505') res.dup++;   // อีกเครื่องเปิดใบไปพร้อมกัน — รอบหน้าจะ "เพิ่มยอด" ให้
      else res.writeErrors.push(`${r.mat_no}: ${error.message}`);
    } else if (r.action === 'raise' && r.pendingId) {
      // CAS — เพิ่มได้เฉพาะใบที่ยังรอหยิบ และยอดเท่าที่เราเห็น · เพิ่มเฉพาะส่วนต่างของทั้งพื้นที่ (เป้า − ยอดรอหยิบรวม)
      const next = Math.round((r.pendPickQty + (r.qty - r.pending)) * 1e6) / 1e6;
      const { data, error } = await supabase.from('wip_replenish_requests').update({ request_qty: next })
        .eq('id', r.pendingId).eq('status', 'pending').eq('request_qty', r.pendPickQty).select('id');
      if (error) res.writeErrors.push(`${r.mat_no}: ${error.message}`);
      else if (data?.length) res.raised++;
      /* 🔴 CAS ไม่ตรง = 0 แถว ไม่มี error — ใบถูกแก้ยอด/ถูกหยิบไปก่อน ⇒ **รอบนี้ไม่ได้เพิ่มยอดให้**
         เดิมหายเงียบ คนอ่านสรุปแล้วเข้าใจว่าแจ้งสโตร์ครบ (QC audit 09/11) */
      else res.raceSkipped++;
    }
  }
  return res;
}

/** ข้อความสรุปสั้นสำหรับ toast */
export function syncSummaryText(r) {
  if (!r) return '';
  if (r.error) return `ยังไม่ได้แจ้งสโตร์ — ${r.error}`;
  const wait = r.rows.filter(x => x.action === 'wait').length;
  const noPkg = r.rows.filter(x => x.action === 'no_pkg');
  const parts = [];
  if (r.inserted) parts.push(`แจ้งสโตร์ใหม่ ${r.inserted} พาร์ท`);
  if (r.raised) parts.push(`เพิ่มยอดใบเดิม ${r.raised} พาร์ท`);
  if (wait) parts.push(`${wait} พาร์ทยังไม่ครบกล่อง (สะสมรอ)`);
  if (noPkg.length) parts.push(`${noPkg.length} พาร์ทยังไม่ตั้ง packing std (${noPkg.slice(0, 3).map(x => x.mat_no).join(', ')}${noPkg.length > 3 ? '…' : ''}) — ไม่ได้แจ้ง`);
  if (r.raceSkipped) parts.push(`${r.raceSkipped} พาร์ทไม่ได้เพิ่มยอด (ใบถูกแก้/หยิบไปก่อน) — กดซ้ำอีกครั้ง`);
  if (r.writeErrors.length) parts.push(`เขียนไม่สำเร็จ ${r.writeErrors.length}: ${r.writeErrors[0]}`);
  if (r.noBom?.length) parts.push(`${r.noBom.length} ใบผลิตไม่มีลูกใน BOM (${r.noBom.slice(0, 3).map(x => x.mat_no).join(', ')}) — แตกไม่ได้ แจ้ง PE ตั้ง BOM`);
  if (r.opUnset?.length) parts.push(`${r.opUnset.length} ใบขั้น OP ยังไม่ได้ผูกว่ากินอะไร (${r.opUnset.slice(0, 3).map(x => x.mat_no).join(', ')}) — ตั้งที่ /products แท็บ BOM ใบของแม่ → แผง 🔩 ขั้น OP`);
  return parts.join(' · ') || (r.orders === 0 ? 'ไม่มีใบผลิตเปิดอยู่ในพื้นที่นี้' : 'ของในพื้นที่พอ — ไม่ต้องเบิก');
}
