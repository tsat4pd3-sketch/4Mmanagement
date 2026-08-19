/* ═══ 🔗 สายการไหลระหว่างไลน์ (ไลน์ไหนป้อนงานให้ไลน์ไหน) — 2026-08-19 ═══
   ที่มา (คำขอ user): "hdf1 ป้อนงานเข้า laser345 และส่งต่อเข้าไลน์ apron assy 60 61
   มันเกือบจะเป็น one piece flow แต่มีระบบ buffer มา mix เพื่อไม่ให้ไลน์เบรคดาวน์มากเกินไป
   เพราะยิ่งเครื่องเยอะเท่าไหร่ โอกาสที่ไลน์จะเบรคดาวน์จนไม่ได้ผลิตงานยิ่งเยอะ"

   ⚠️ กฎเหล็กของโมดูลนี้ — "ต้นน้ำหยุด ≠ ปลายน้ำหยุดทันที"
   buffer ระหว่างกลางคือตัวกันสะเทือน (ที่หน้างานตั้งใจใส่ไว้) → ปลายน้ำจะหยุดก็ต่อเมื่อ buffer หมด
   ห้ามแสดงว่า "ต้นน้ำหยุด = ปลายน้ำกระทบ" แบบเหมารวม จะทำให้คนเลิกเชื่อสัญญาณ
   ไม่รู้ buffer (buffer_qty = null) → คืน cover = null = "ไม่รู้" **ห้ามเดาเป็น 0**
   (0 แปลว่า "ไม่มี buffer เลย กระทบทันที" ซึ่งคนละความหมายกับ "ยังไม่ได้กรอก")

   ⚠️ ทุกฟังก์ชันเป็น pure — ห้าม import supabase/react เข้ามาในไฟล์นี้ (จะเทสไม่ได้)
   ⚠️ ตารางต้นทาง `line_flow_links` (DR) เก็บชื่อไลน์เป็น text snapshot
      → เปลี่ยนชื่อไลน์ต้อง cascade ทั้ง from_line และ to_line (ทำแล้วใน LineSetup handleRenameLink) */

/* ⚠️ `Number(null)` = 0 ไม่ใช่ NaN → เช็ค "มีค่าไหม" ด้วย Number() เฉยๆ ไม่ได้
   ถ้าพลาด: ไลน์ที่ยังไม่กรอก buffer จะถูกตีเป็น "buffer 0 ชิ้น = ปลายน้ำกระทบทันที"
   (กับดักเดียวกับที่เคยทำ Rank อะไหล่เพี้ยนทั้งคลัง) */
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ทำ index ของสายการไหล — คืน map ทั้งขาลง (ป้อนให้ใคร) และขาขึ้น (รับจากใคร) */
export function buildFlowGraph(links = []) {
  const down = new Map(); // from_line -> [link]
  const up = new Map();   // to_line   -> [link]
  for (const l of links) {
    if (l?.is_active === false) continue;
    const f = String(l?.from_line || '').trim();
    const t = String(l?.to_line || '').trim();
    if (!f || !t || f === t) continue;
    if (!down.has(f)) down.set(f, []);
    if (!up.has(t)) up.set(t, []);
    down.get(f).push(l);
    up.get(t).push(l);
  }
  return { down, up };
}

export const downstreamOf = (g, line) => g?.down?.get(String(line || '').trim()) || [];
export const upstreamOf = (g, line) => g?.up?.get(String(line || '').trim()) || [];

/** ไล่สายทั้งเส้นจากไลน์ที่เลือก (BFS) — กันวนลูปด้วย seen
    dir = 'down' (ป้อนต่อไปทางไหน) | 'up' (ของมาจากไหน)
    คืน [{ line, depth, via }] เรียงตามระยะ */
export function traceChain(g, line, dir = 'down', maxDepth = 5) {
  const start = String(line || '').trim();
  if (!start || !g) return [];
  const out = [];
  const seen = new Set([start]);
  let frontier = [{ line: start, depth: 0 }];
  while (frontier.length && frontier[0].depth < maxDepth) {
    const next = [];
    for (const node of frontier) {
      const links = dir === 'up' ? upstreamOf(g, node.line) : downstreamOf(g, node.line);
      for (const l of links) {
        const nb = dir === 'up' ? l.from_line : l.to_line;
        if (seen.has(nb)) continue;   // วนลูป (A→B→A) = หยุด ไม่ไล่ซ้ำ
        seen.add(nb);
        const item = { line: nb, depth: node.depth + 1, via: l };
        out.push(item);
        next.push(item);
      }
    }
    frontier = next;
  }
  return out;
}

/** buffer กันได้กี่นาทีก่อนปลายน้ำเริ่มรอ
    = จำนวนชิ้นใน buffer ÷ อัตราที่ปลายน้ำกินของ (1 ชิ้น / ct วินาที)
    ⚠️ คืน null เมื่อไม่รู้ buffer หรือไม่รู้ CT — ห้ามเดาเป็น 0 */
export function bufferCoverMin(bufferQty, ctSec) {
  const q = num(bufferQty);
  const ct = num(ctSec);
  if (q == null || q < 0) return null;
  if (ct == null || ct <= 0) return null;
  return (q * ct) / 60;
}

/** CT เฉลี่ยของไลน์ (วินาที/ชิ้น) จากรายการสินค้าที่ผลิตบนไลน์นั้น
    ⚠️ ข้าม "รายการขั้นตอน" (is_operation) — ไม่ใช่ของที่ปลายน้ำกินเข้าไปเป็นชิ้น
    ไม่มีสินค้าที่ตั้ง CT เลย → null (ไม่รู้) */
export function lineAvgCtSec(products = [], lineName) {
  const key = String(lineName || '').trim().toLowerCase();
  const cts = products
    .filter(p => String(p?.line_name || '').trim().toLowerCase() === key && !p?.is_operation)
    .map(p => Number(p?.cycle_time_sec))
    .filter(v => Number.isFinite(v) && v > 0);
  if (!cts.length) return null;
  return cts.reduce((a, b) => a + b, 0) / cts.length;
}

/** ประเมินผลกระทบปลายน้ำจาก "ต้นน้ำหยุดมาแล้ว N นาที"
    คืนสถานะ 3 แบบ — ห้ามยุบเหลือ 2 (ไม่รู้ ≠ ปลอดภัย):
      'safe'    buffer ยังเหลือ → ปลายน้ำยังไม่กระทบ (บอกด้วยว่าเหลือกี่นาที)
      'at_risk' buffer หมดแล้ว → ปลายน้ำน่าจะเริ่มรอของ
      'unknown' ไม่รู้ buffer/CT → บอกแค่ว่า "เชื่อมกัน" ประเมินเวลาไม่ได้ */
export function downstreamRisk({ stoppedMin, bufferQty, ctSec }) {
  const cover = bufferCoverMin(bufferQty, ctSec);
  const mins = num(stoppedMin);
  if (cover == null || mins == null) return { status: 'unknown', cover, leftMin: null };
  const left = cover - mins;
  return { status: left > 0 ? 'safe' : 'at_risk', cover, leftMin: left };
}

/** ตรวจทานสายการไหลกับ routing รายพาร์ท (part_routings) เมื่อมีข้อมูลแล้ว
    คืนคู่ไลน์ที่ routing บอกว่าต่อกัน แต่ยังไม่ได้ตั้งใน line_flow_links
    ⚠️ แค่ "เสนอ" ให้คนยืนยัน — ห้าม insert ให้เองอัตโนมัติ (หลักเดียวกับ AI intake/PE change request) */
export function missingLinksFromRouting(routings = [], links = []) {
  const have = new Set(
    links.filter(l => l?.is_active !== false)
      .map(l => `${String(l.from_line).trim()}→${String(l.to_line).trim()}`)
  );
  const byMat = new Map();
  for (const r of routings) {
    if (r?.is_active === false) continue;
    const mat = String(r?.mat_no || '').trim();
    const ln = String(r?.line_name || '').trim();
    if (!mat || !ln) continue;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push({ seq: Number(r.seq) || 0, line: ln });
  }
  const found = new Map(); // key -> { from, to, mats:Set }
  for (const [mat, steps] of byMat) {
    steps.sort((a, b) => a.seq - b.seq);
    for (let i = 1; i < steps.length; i++) {
      const from = steps[i - 1].line;
      const to = steps[i].line;
      if (from === to) continue;              // ขั้นถัดไปอยู่ไลน์เดิม = ไม่ใช่การส่งข้ามไลน์
      const key = `${from}→${to}`;
      if (have.has(key)) continue;
      if (!found.has(key)) found.set(key, { from, to, mats: new Set() });
      found.get(key).mats.add(mat);
    }
  }
  return [...found.values()].map(v => ({ from: v.from, to: v.to, mats: [...v.mats] }));
}
