/* ── 🧾 แผ่นบนบอร์ด KPI = KPI ที่หน่วย "ถือ" จริง (2026-10-05 · user: "MTN ไม่ได้มี OEE/PPM แต่มาโชว์") ─────────
   กติกาอยู่ที่นี่ที่เดียว (pure · มีเทส) — ObeyaKpiBoard แค่ส่ง closure หา-นิยาม 2 ตัวเข้ามา ห้ามคิดเองในหน้า
   1. ช่องมาตรฐาน (template 8 ช่อง) โชว์เมื่อ (ก) ขอบเขตมีนิยามของช่องนั้น — ของตัวเองหรือตกทอดจาก "หน่วยแม่"
      (นิยามระดับทั้งโรงงานไม่นับว่าถือ: เป็นที่เก็บค่าร่วม value_scope='plant' · ยกเว้นดูทั้งโรงงานเอง)
      หรือ (ข) แถว auto (OEE/PPM/Safety) และขอบเขตมีไลน์ผลิต (ตัวเลขเกิดเองจากกะ)
   2. ขอบเขตที่ยังไม่ตั้ง KPI เลย = template เต็ม (`fallbackTemplate: true`) — บอร์ดว่างเปล่าไม่บอกอะไรใคร
   3. KPI ที่ตั้งไว้ที่ขอบเขตนี้ตรงๆ แต่ไม่เข้าช่อง = แผ่นเต็มต่อท้าย key `def:<id>` (🔴 คีย์หมายเหตุ kpi_month_notes.row_key)
   📄 docs/modules/obeya-kpi-board.md §แผ่นบนบอร์ด = KPI ที่หน่วยถือจริง */
import { isPlant, scopeOfDef, sameScope } from './orgScope.js';
import { boardSlotOf } from './kpiSetup.js';

/** ชื่อแบบเทียบได้ (ตัวพิมพ์/ช่องว่าง/วงเล็บไม่สำคัญ) — ใช้คู่กันทั้งบอร์ดและ util นี้ */
export const normKpiRowName = x => String(x ?? '').toLowerCase().replace(/[\s\-_./()]+/g, '');

/**
 * @param templates  แถว template ของปี (`boardRowsFor(year)`) — { key, name, auto, … }
 * @param kdefs      นิยาม KPI ที่ "ครอบ" ขอบเขต (ของตัวเอง + ตกทอด · กรองด้วย scopeCovers มาแล้ว)
 * @param scope      ขอบเขตที่ดู { kind, value }
 * @param hasLines   ขอบเขตมีไลน์ผลิตไหม (members.groups.length > 0)
 * @param findManual (row) => { def, at } | null — นิยามกรอกมือที่ใกล้สุดสำหรับช่องนี้ (ตาม board_slot/ชื่อ)
 * @param findAuto   (autoKey) => def | null — นิยาม `auto:<key>` ที่ใกล้สุด
 * @param ownScopes  ขอบเขตที่นับว่าเป็น "ของตัวเอง" สำหรับแผ่นพิเศษ (06/10: เลือก CC = หน่วยเจ้าของรหัสด้วย `[scope, ...unitsOf(scope)]`)
 *                   — ไม่ส่ง = [scope] (พฤติกรรมเดิม)
 * @param order      ลำดับแผ่นที่คนจัดเอง (`kpi_board_layouts.row_keys` · 09/10) — คีย์ที่อยู่ในลิสต์มาก่อนตามลำดับ
 *                   คีย์ที่ไม่อยู่ (KPI เพิ่มใหม่) ต่อท้ายตามลำดับเดิม · คีย์ที่ไม่มีแผ่นแล้ว = ข้าม · ไม่ส่ง/ว่าง = ลำดับ template
 * @returns { rows, fallbackTemplate }
 */
export function pickBoardRows({ templates, kdefs, scope, hasLines, findManual, findAuto, ownScopes = null, order = null }) {
  const own = ownScopes && ownScopes.length ? ownScopes : [scope];
  const plantView = isPlant(scope);
  const isMan = d => !String(d?.source || '').startsWith('auto:');
  const held = (kdefs || []).filter(d => plantView || !isPlant(scopeOfDef(d)));
  const hasAnyDef = held.length > 0;
  const holds = (r) => {
    if (!hasAnyDef) return true;
    if (r.auto && hasLines) return true;
    const man = findManual(r);
    if (man && (plantView || !isPlant(man.at))) return true;
    if (r.auto) { const ad = findAuto(r.auto); if (ad && (plantView || !isPlant(scopeOfDef(ad)))) return true; }
    return false;
  };
  const mainKeys = new Set(templates.map(r => r.key));
  const mainNames = new Set(templates.map(r => normKpiRowName(r.name)));
  /* อยู่บนช่องมาตรฐานแล้ว (ตาม board_slot หรือชื่อ) = ไม่ทำแผ่นซ้ำ · slot ที่ปีนี้ไม่มีช่อง (dl/oh ปี 2026) = แผ่นพิเศษ */
  const onMain = d => (boardSlotOf(d) ? mainKeys.has(boardSlotOf(d)) : mainNames.has(normKpiRowName(d.kpi_catalog?.name || d.name)));
  const extras = (kdefs || [])
    .filter(d => own.some(sc => sameScope(scopeOfDef(d), sc)) && isMan(d) && !onMain(d))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    .map(d => ({ key: `def:${d.id}`, name: d.kpi_catalog?.name || d.name || '(ไม่มีชื่อ)', icon: '📌', auto: null, defId: d.id, extra: true }));
  return { rows: applyBoardOrder([...templates.filter(holds), ...extras], order), fallbackTemplate: !hasAnyDef };
}

/** เรียงแผ่นตามลำดับที่คนจัด (pure) — ดูคำอธิบาย `order` ด้านบน */
export function applyBoardOrder(rows, order) {
  if (!Array.isArray(order) || !order.length) return rows;
  const pos = new Map(order.map((k, i) => [k, i]));
  const picked = rows.filter(r => pos.has(r.key)).sort((a, b) => pos.get(a.key) - pos.get(b.key));
  const rest = rows.filter(r => !pos.has(r.key));
  return [...picked, ...rest];
}

/** ลิสต์คีย์ใหม่หลังเลื่อนแผ่น `key` ไปทาง `dir` (-1 ซ้าย/ขึ้น · +1 ขวา/ลง) จากลำดับที่เห็นบนจอ (pure) */
export function moveBoardKey(keys, key, dir) {
  const i = keys.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return keys;
  const out = keys.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
