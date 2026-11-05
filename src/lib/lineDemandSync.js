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
import { getActor } from '../utils/actorStamp';
import { can } from '../utils/permissions';

const key = (s) => String(s ?? '').trim();

/**
 * ความต้องการลูกตรงจาก "ใบผลิตที่เปิดอยู่" ของไลน์ (ยังไม่หักของหน้าไลน์ · ไม่รวมลูกที่ไลน์ผลิตเอง)
 * ใช้ร่วม: ตัวออกใบ (ข้างล่าง) + จอสโตร์เช็คว่าใบเบิกยังมีใบผลิตรองรับไหม (`openDemandMatsByLine`)
 * @returns {Promise<{ error?: string, need: Map<string,{need:number,part_name:string|null}>, made: Set<string> }>}
 */
export async function loadOpenOrderDemand(lineName, products = null) {
  const line = key(lineName);
  const out = { need: new Map(), made: new Set() };
  if (!line) return { ...out, error: 'ไม่รู้ไลน์' };
  const [ordRes, prods] = await Promise.all([
    fetchAllPages(() => supabaseDR.from('prod_orders')
      .select('id, mat_no, qty, production_sessions!inner(line_name, status)')
      .eq('status', 'open').eq('production_sessions.line_name', line).in('production_sessions.status', SESSION_STATUSES_LIVE)),
    products ? Promise.resolve(products) : loadProductsMaster().catch(() => null),
  ]);
  if (ordRes.error || ordRes.truncated) return { ...out, error: 'อ่านใบผลิตที่เปิดอยู่ไม่ได้' };
  if (!prods) return { ...out, error: 'อ่านทะเบียนสินค้าไม่ได้' };
  const made = new Set(madeHereMats(line, prods));
  const qtyByFg = new Map();
  for (const o of ordRes.rows || []) {
    const m = key(o.mat_no); const q = Number(o.qty) || 0;
    if (m && q > 0) qtyByFg.set(m, (qtyByFg.get(m) || 0) + q);
  }
  const fgs = [...qtyByFg.keys()];
  const bomRes = await Promise.all(fgs.map(fg => supabaseDR.rpc('fn_bom_direct_demand', { p_fg_mat: fg })));
  const bomErr = bomRes.find(r => r.error);
  if (bomErr) return { ...out, made, error: `แตก BOM ไม่ได้ (${bomErr.error.message})` };
  const need = new Map();
  fgs.forEach((fg, i) => (bomRes[i].data || []).forEach(k => {
    const m = key(k.mat_no); const q = qtyByFg.get(fg) * (Number(k.qty_per_unit) || 0);
    if (!m || !(q > 0) || made.has(m)) return;
    const cur = need.get(m) || { need: 0, part_name: k.part_name || null };
    cur.need += q; cur.part_name = cur.part_name || k.part_name || null;
    need.set(m, cur);
  }));
  return { need, made };
}

/**
 * 🧾 จอสโตร์: ไลน์ไหน "ยังมีใบผลิตเปิดอยู่ที่ใช้พาร์ทนี้" — ใบเบิกจากใบผลิต (`line_order`) ที่ไม่มีใบผลิตรองรับแล้ว
 * = ใบผลิตต้นทางปิด/ยกเลิก ⇒ เตือนบนการ์ด ให้คนตัดสินเอง (ระบบไม่ยกเลิก/ลดยอดเอง · คำสั่ง user 05/11)
 * @returns {Promise<Map<string, Set<string>|null>>} null = อ่านไม่ได้ (ห้ามเตือน — ไม่รู้ ≠ ไม่มี)
 */
export async function openDemandMatsByLine(lineNames = []) {
  const lines = [...new Set(lineNames.map(key).filter(Boolean))];
  const products = await loadProductsMaster().catch(() => null);
  const res = await Promise.all(lines.map(l => loadOpenOrderDemand(l, products)));
  return new Map(lines.map((l, i) => [l, res[i].error ? null : new Set(res[i].need.keys())]));
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
  const canWrite = can('wip_request', 'decide', role) || can('wip_request', 'receive', role)
    || can('heijunka', 'operate', role) || can('line_levels', 'manage', role);
  if (!dryRun && !canWrite) return { ...empty, error: 'บัญชีนี้ไม่มีสิทธิ์แจ้งสโตร์ (wip_request:decide / wip_request:receive) — ให้หัวหน้าไลน์กด หรือขอสิทธิ์ที่ /permissions' };

  // 1-2) ใบผลิตที่เปิดอยู่ → แตก BOM ลูกตรง (ชุดเดียวกับตอนตัดสต็อก)
  const od = await loadOpenOrderDemand(line);
  if (od.error) return { ...empty, error: od.error };
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
  if (!mats.length) return { ...empty };

  // 3) ยอดหน้าไลน์ · packing std · ใบรอหยิบที่มีอยู่
  const [stk, pkgs, pend] = await Promise.all([
    fetchByIds(mats, ms => supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand').eq('line_name', line).in('mat_no', ms), { orderBy: 'mat_no' }),
    fetchByIds(mats, ms => supabaseDR.from('parts_master').select('mat_no, qty_per_pkg, uom, is_active').in('mat_no', ms), { orderBy: 'mat_no' }),
    fetchByIds(mats, ms => supabase.from('wip_replenish_requests').select('id, mat_no, request_qty, status').eq('line_name', line).eq('status', 'pending').in('mat_no', ms), { orderBy: 'mat_no' }),
  ]);
  if (stk.error || stk.truncated) return { ...empty, error: 'อ่านยอดหน้าไลน์ไม่ได้' };
  if (pkgs.error || pkgs.truncated) return { ...empty, error: 'อ่าน packing std ไม่ได้' };
  if (pend.error || pend.truncated) return { ...empty, error: 'อ่านใบเบิกที่รอหยิบไม่ได้' };
  const onHand = new Map((stk.rows || []).map(r => [key(r.mat_no), Number(r.qty_on_hand) || 0]));
  const pkgOf = new Map((pkgs.rows || []).filter(r => r.is_active !== false).map(r => [key(r.mat_no), r.qty_per_pkg]));
  const pendOf = new Map((pend.rows || []).map(r => [key(r.mat_no), r]));
  const coil = new Set((pkgs.rows || []).filter(r => r.is_active !== false && isCoilUom(r.uom)).map(r => key(r.mat_no)));
  /* 🧲 05/11 (คำสั่ง user "ต้องเบิกผ่านพาร์ท") — coil ขอตรงไม่ได้: ไลน์ไม่รู้ว่าต้องใช้กี่ kg ต้องให้ BOM คิดจากพาร์ทที่จะผลิต */
  const directCoil = mats.filter(m => coil.has(m) && need.get(m).direct);
  if (directCoil.length) return { ...empty, error: `${directCoil.join(', ')} เป็นเหล็ก coil (จ่ายเป็น kg) — ขอเบิกตรงไม่ได้ ให้เลือกพาร์ทที่จะผลิต ระบบแตก BOM คิด kg ให้` };

  // 4) ตัดสิน + เขียน
  const rows = mats.sort().map(m => {
    const n = need.get(m); const p = pendOf.get(m);
    return { mat_no: m, part_name: n.part_name, fromOrders: n.fromOrders, pendingId: p?.id || null,
      ...planLineRequest({ need: n.need, onHand: onHand.get(m) ?? 0, pendingQty: p?.request_qty, pkg: pkgOf.get(m), coil: coil.has(m) }), uom: coil.has(m) ? 'KG' : null };
  });
  const res = { rows, inserted: 0, raised: 0, dup: 0, writeErrors: [] };
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
      // CAS — เพิ่มได้เฉพาะใบที่ยังรอหยิบ และยอดเท่าที่เราเห็น
      const { data, error } = await supabase.from('wip_replenish_requests').update({ request_qty: r.qty })
        .eq('id', r.pendingId).eq('status', 'pending').eq('request_qty', r.pending).select('id');
      if (error) res.writeErrors.push(`${r.mat_no}: ${error.message}`);
      else if (data?.length) res.raised++;
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
  if (r.writeErrors.length) parts.push(`เขียนไม่สำเร็จ ${r.writeErrors.length}: ${r.writeErrors[0]}`);
  return parts.join(' · ') || 'ของหน้าไลน์พอ — ไม่ต้องเบิก';
}
