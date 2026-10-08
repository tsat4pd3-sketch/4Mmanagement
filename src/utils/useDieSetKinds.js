/* ── useDieSetKinds — ทะเบียนรูปแบบชุดแม่พิมพ์ (DR `die_set_kinds`)  (2026-10-05) ──
   migration 20261005_die_set_kinds_dr.sql · die_sets.kind เก็บ key (text ไม่ผูก FK) เหมือนเดิม
   เดิม hardcode 4 ค่าใน DIE_SET_KINDS + check constraint — ทีมแม่พิมพ์ต้องเพิ่ม HYDROFORM/BEND เอง
   และตั้งชื่อเรียกให้หน้างานเข้าใจเอง · จัดการที่ /equipment?tab=die แผง ⚙️ · แก้แล้วเรียก invalidateDieSetKinds()
   · ยังไม่ apply migration (ตารางไม่มี) = ถอยไปใช้ค่าสำรอง DIE_SET_KINDS (จอไม่ว่าง ไม่พัง)

   useDieItemTypeMap(enabled) — ใบแจ้งซ่อม: เลขแม่พิมพ์ → ชนิดอุปกรณ์ (ประเภท OP ก่อน · ไม่มีค่อยรูปแบบชุด)
   โหลดเฉพาะตอนแจ้งงานแม่พิมพ์ (enabled) · 3 ตารางเล็ก (แม่พิมพ์ ≈266 · equipment_die · ชุด 92) ลง cache master
   ⚠️ cache 4 ชม. ข้ามเครื่อง (masterCache) — แก้รูปแบบชุด/ผูกชุดที่ทะเบียนแล้วเครื่องอื่นเห็นช้าได้ถึง TTL
      หน้าที่แก้ (DieRegistry) เรียก invalidateDieSetKinds() ล้างของเครื่องตัวเองทันที */
import { useEffect, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { cachedMaster, invalidateMaster, mrows } from './masterCache';
import { DIE_SET_KINDS, normDieSetKind, buildDieItemTypeMap } from './equipmentKinds';
import { fetchAllRows } from './fetchAllRows';

const KEY = 'die_set_kinds:master';
const LINK_KEY = 'die_set_kinds:die_links_v2';   // v2 (06/10) = เพิ่ม op_type
const OP_KEY = 'die_op_types:master';

export async function loadDieSetKinds() {
  const rows = await cachedMaster(KEY, async () => mrows(await supabaseDR.from('die_set_kinds')
    .select('key, label, description, mo_item_type, sort_order, is_active').order('sort_order').order('key')));
  return rows?.length ? rows.map(normDieSetKind) : DIE_SET_KINDS.map(normDieSetKind);
}
export const invalidateDieSetKinds = () => { invalidateMaster(KEY); invalidateMaster(LINK_KEY); invalidateMaster(OP_KEY); };

/** ทะเบียนประเภท OP ของแม่พิมพ์ (DR die_op_types) — mo_item_type (06/10) = ชนิดอุปกรณ์ในใบแจ้งซ่อม ชนะรูปแบบชุด */
export async function loadDieOpTypes() {
  return cachedMaster(OP_KEY, async () => mrows(await supabaseDR.from('die_op_types')
    .select('key, label, mo_item_type, sort_order, is_active').order('sort_order')));
}

export default function useDieSetKinds(version = 0) {
  const [rows, setRows] = useState(() => DIE_SET_KINDS.map(normDieSetKind));
  useEffect(() => {
    let alive = true;
    loadDieSetKinds().then(d => { if (alive) setRows(d); }).catch(() => {});
    return () => { alive = false; };
  }, [version]);
  return rows;
}

/** แม่พิมพ์ที่ผูกชุดแล้ว → [{ machine_no, kind }] */
async function loadDieLinks() {
  return cachedMaster(LINK_KEY, async () => {
    const [ed, ds, mc] = await Promise.all([
      fetchAllRows(supabaseDR, 'equipment_die', 'machine_id, die_set_id, op_type'),
      fetchAllRows(supabaseDR, 'die_sets', 'id, kind'),
      fetchAllRows(supabaseDR, 'machines', 'id, machine_no', q => q.eq('equipment_kind', 'die')),
    ]);
    const kindOf = new Map(mrows(ds).map(s => [s.id, s.kind]));
    const noOf = new Map(mrows(mc).map(m => [m.id, m.machine_no]));
    return mrows(ed).map(e => ({ machine_no: noOf.get(e.machine_id), kind: kindOf.get(e.die_set_id) || null, op_type: e.op_type || null }))
      .filter(l => l.machine_no && (l.kind || l.op_type));
  });
}

export function useDieItemTypeMap(enabled) {
  const [map, setMap] = useState(null);
  useEffect(() => {
    if (!enabled || map) return undefined;
    let alive = true;
    Promise.all([loadDieLinks(), loadDieSetKinds(), loadDieOpTypes()])
      .then(([links, kinds, ops]) => { if (alive) setMap(buildDieItemTypeMap(links, kinds, ops)); })
      .catch(() => { if (alive) setMap(new Map()); });   // โหลดไม่ได้ = ให้ผู้แจ้งเลือกเองตามเดิม (ไม่บล็อกการแจ้งซ่อม)
    return () => { alive = false; };
  }, [enabled, map]);
  return map;
}
