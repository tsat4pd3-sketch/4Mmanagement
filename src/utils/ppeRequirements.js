/* ══ 🦺 ppeRequirements — "หน่วยงานนี้บังคับ PPE อะไรบ้าง" กฎชุดเดียวของระบบ ══════════════════
   (2026-11-10 · คำสั่ง user: *"บางไลน์ต้องมีผ้ากันเปื้อน ปลอกแขน แว่นตาอีก"*)

   ของเดิมเป็น 3 คอลัมน์ bool ตายตัวทั้งโรงงาน (หมวก/รองเท้า/ถุงมือ) ⇒ ไลน์ที่ต้องใส่อย่างอื่น
   บันทึกไม่ได้เลย · ตอนนี้เป็นทะเบียน 4 ชั้น ตกทอดจากบนลงล่าง:

       plant (ทั้งโรงงาน) → section (ส่วนงาน) → line (ไล่ตามสายแม่→ลูก) → station (จุดงาน)

   🔴 กติกาที่ห้ามพัง:
   · **ชั้นล่างชนะชั้นบนเสมอ** · ไลน์ลูกชนะไลน์แม่ (สายไลน์ถาม `lineChainIds` ห้ามไล่เอง)
   · **"ไม่ได้ตั้ง" ≠ "ตั้งว่าไม่ต้อง"** — ไม่มีแถว = ตกทอดจากชั้นบน · `required=false` = **ยกเว้น**
     (ยุบ 2 อย่างนี้เป็นอันเดียว = ยกเว้นรายไลน์ไม่ได้เลย ต้องไปแก้ที่ชั้นบนซึ่งกระทบคนอื่น)
   · **ทุกชิ้นต้องตอบได้ว่ามาจากชั้นไหน** (`source`) — จอต้องเขียนให้เห็น ไม่งั้นคนตั้งค่าไม่รู้ว่า
     ที่เห็นอยู่เป็นของไลน์ตัวเองหรือตกทอดมา แล้วไปแก้ผิดชั้น
   · 🔴 **อ่านทะเบียนไม่ได้ = `unknown` ห้ามบีบเป็น "ไม่ต้องใส่อะไรเลย"** — จอต้องเขียนบอก
     แล้วถอยไปใช้ 3 ชิ้นเดิม (`LEGACY_FALLBACK`) ไม่ใช่ปล่อยผ่านเงียบๆ
   · รายการที่ตรงกับคอลัมน์เดิมใน `daily_production_logs` ผูกไว้ที่ `ppe_items.legacy_col`
     ⇒ ติ๊กที่ชั้นใหม่ต้องซิงก์คอลัมน์เดิมด้วย (`legacyPatchOf`) ไม่งั้นจอเก่ากับจอใหม่เถียงกัน
   ══════════════════════════════════════════════════════════════════════════════════ */
import { lineChainIds } from './lineHierarchy.js';   // .js — ให้ node:test resolve ได้ (bundler ไม่สน)

export const PPE_SCOPE_KINDS = ['plant', 'section', 'line', 'station'];
export const PPE_SCOPE_LABEL = {
  plant:   'ทั้งโรงงาน',
  section: 'ส่วนงาน',
  line:    'ไลน์',
  station: 'จุดงาน',
};
/** ถอยไปใช้ชุดนี้เมื่อ "อ่านทะเบียนไม่ได้" — คือ 3 ชิ้นที่ทั้งโรงงานใช้อยู่ก่อนมีระบบนี้ */
export const LEGACY_FALLBACK = ['has_helmet', 'has_boots', 'has_gloves'];

/** คีย์ของแต่ละชั้น **เรียงบนสุด → ล่างสุด** (ล่างทับบน) */
export function ppeLayerKeys({ section, lineId, lines = [], stationId } = {}) {
  const keys = [['plant', '*']];
  const sec = String(section || '').trim();
  if (sec) keys.push(['section', sec]);
  for (const id of lineChainIds(lines, lineId)) keys.push(['line', String(id)]);
  const st = String(stationId || '').trim();
  if (st) keys.push(['station', st]);
  return keys;
}

/**
 * 🦺 รายการที่หน่วยนี้บังคับ
 * @returns {{ required: object[], excluded: object[], sourceOf: Map, unknown: boolean }}
 *   required = ต้องใส่ (เรียงตาม `sort_order`) · excluded = ถูกยกเว้นที่ชั้นใดชั้นหนึ่ง (ไว้โชว์ในจอตั้งค่า)
 *   sourceOf = item_id → `{ kind, key, depth }` ชั้นที่ตัดสิน · unknown = อ่านทะเบียนไม่ได้
 */
export function resolvePpe({ items, reqs, section, lineId, lines = [], stationId } = {}) {
  // 🔴 อ่านไม่ได้ (null/undefined) ≠ ทะเบียนว่าง ([]) — อย่างแรกต้องบอกบนจอ
  if (!Array.isArray(items) || !Array.isArray(reqs)) {
    return { required: [], excluded: [], sourceOf: new Map(), unknown: true };
  }
  const layers = ppeLayerKeys({ section, lineId, lines, stationId });
  const decide = new Map();   // item_id(string) → { required, kind, key, depth }
  layers.forEach(([kind, key], depth) => {
    for (const r of reqs) {
      if (r?.scope_kind !== kind || String(r?.scope_key) !== key) continue;
      decide.set(String(r.item_id), { required: !!r.required, kind, key, depth });
    }
  });
  const live = items.filter(it => it?.is_active !== false);
  const bySort = (a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || String(a.code).localeCompare(String(b.code));
  const required = [], excluded = [];
  for (const it of live.slice().sort(bySort)) {
    const d = decide.get(String(it.id));
    if (!d) continue;                       // ไม่มีชั้นไหนพูดถึง = ไม่บังคับ
    (d.required ? required : excluded).push(it);
  }
  return { required, excluded, sourceOf: decide, unknown: false };
}

/** ป้ายบอกที่มาแบบสั้น เช่น "ไลน์ 060" / "ตกทอดจากทั้งโรงงาน" */
export function ppeSourceText(src, { nameOfLine, nameOfStation } = {}) {
  if (!src) return '';
  if (src.kind === 'plant') return 'ตกทอดจากทั้งโรงงาน';
  if (src.kind === 'section') return `ตั้งที่ส่วนงาน ${src.key}`;
  if (src.kind === 'line') return `ตั้งที่ไลน์ ${nameOfLine?.(src.key) || src.key}`;
  return `ตั้งที่จุดงาน ${nameOfStation?.(src.key) || src.key}`;
}

/**
 * สรุปผลตรวจของคนหนึ่งในวันหนึ่ง
 * @param required รายการที่บังคับ (จาก `resolvePpe`)
 * @param checks   แถว `ppe_check_items` ของคนนั้นวันนั้น · `null` = ยังไม่เคยตรวจ
 * @returns {{ state:'none'|'partial'|'ok'|'missing', okIds:Set, missingItems:object[], untouched:object[] }}
 *   none = ยังไม่ได้ตรวจเลย (ไม่ใช่ "ไม่ผ่าน") · missing = ตรวจแล้วมีชิ้นที่ขาด
 */
export function ppeStatusOf(required = [], checks = null) {
  const rows = Array.isArray(checks) ? checks : [];
  const byItem = new Map(rows.map(r => [String(r.item_id), !!r.ok]));
  const okIds = new Set(), missingItems = [], untouched = [];
  for (const it of required) {
    const v = byItem.get(String(it.id));
    if (v === true) okIds.add(String(it.id));
    else if (v === false) missingItems.push(it);
    else untouched.push(it);
  }
  const state = !required.length ? 'ok'
    : missingItems.length ? 'missing'
    : untouched.length === required.length ? 'none'
    : untouched.length ? 'partial'
    : 'ok';
  return { state, okIds, missingItems, untouched };
}

/**
 * 🔁 ซิงก์กลับคอลัมน์เดิมของ `daily_production_logs`
 * จอเก่า (ตาราง/การ์ดเช็คชื่อ · `getRowStatus` · ชิป "PPE ไม่ครบ") ยังอ่าน 3 คอลัมน์นี้
 * ⇒ ติ๊กที่ชั้นใหม่แล้วไม่ซิงก์ = จอเก่ากับจอใหม่เถียงกันว่าใครใส่ครบ
 * @returns object patch สำหรับ upsert (`{}` = ไม่มีรายการที่ผูกคอลัมน์เดิม)
 */
export function legacyPatchOf(items = [], okByItemId = {}) {
  const patch = {};
  for (const it of items) {
    if (!it?.legacy_col) continue;
    patch[it.legacy_col] = !!okByItemId[String(it.id)];
  }
  return patch;
}
