/* ═══════════════════════════════════════════════════════════════════════════
   ทะเบียนแม่พิมพ์ — ป้ายช่องใหม่ + แถว Excel ให้ทีม DIE export ไปไล่ข้อมูล   2026-11-05

   คำสั่ง user 05/11: "แม่พิมพ์ 1 ตัว = 1 OP แล้วค่อยรวมเป็น set" + "ให้มี export excel
   ในหน้าทะเบียน เพื่อให้ทีม export ไปไล่ข้อมูล"

   ⚠️ pure ทั้งไฟล์ (ไม่ import supabase) ⇒ มีเทส `__tests__/dieRegistryExport.test.mjs`
   🔴 ช่องที่ยังไม่รู้ = เซลล์ว่าง ห้ามเติม 0 / 1 / "-" ให้ — ไฟล์นี้คือ worklist ให้ทีมเติม
      (เลข 0 ในไฟล์ = คนอ่านเข้าใจว่า "รู้แล้วว่าเป็น 0")
   🔴 แถวแรกของทุกชีต = หัวตาราง (เลขฟอร์มอยู่ที่ชื่อไฟล์ · docs/modules/doc-forms.md)
   ═══════════════════════════════════════════════════════════════════════════ */

/** ชนิดป้อนของ OP — sheet = แผ่น/ชิ้นจาก OP ก่อน · coil = ม้วน (progressive/blank) */
export const FEED_TYPES = [
  { key: 'sheet', label: 'แผ่น / ชิ้นจาก OP ก่อน' },
  { key: 'coil',  label: 'ม้วน (progressive / blank)' },
];
export const feedTypeLabel = (k) => FEED_TYPES.find(t => t.key === k)?.label || (k || '');

/** เจ้าของแม่พิมพ์ (ระดับชุด) */
export const DIE_OWNERS = [
  { key: 'company',  label: 'ของบริษัท' },
  { key: 'customer', label: 'ของลูกค้า (customer-owned)' },
];
export const dieOwnerLabel = (k) => DIE_OWNERS.find(t => t.key === k)?.label || (k || '');

const v = (x) => (x == null ? '' : x);   // null/undefined = เซลล์ว่าง (ไม่ใช่ 0)

/**
 * สมาชิกของแต่ละชุด = แม่พิมพ์ที่ชุดนี้เป็น "บ้าน" + แม่พิมพ์ที่ยืมมาจากชุดอื่น (common die)
 * คืน { [setId]: [{ die, opSeq, shared: bool, homeSetId }] } เรียงตาม OP (ว่างไว้ท้าย)
 * @param dies   [{ id, ext: { die_set_id, op_seq } }]
 * @param shared [{ die_set_id, machine_id, op_seq }]
 */
export function membersBySet(dies = [], shared = []) {
  const byId = new Map(dies.map(d => [d.id, d]));
  const m = {};
  for (const d of dies) {
    const k = d?.ext?.die_set_id;
    if (k) (m[k] ||= []).push({ die: d, opSeq: d.ext?.op_seq ?? null, shared: false, homeSetId: k });
  }
  for (const s of shared) {
    const d = byId.get(s.machine_id);
    if (!d || !s.die_set_id) continue;              // แม่พิมพ์นอกขอบเขต/ไม่อยู่ในลิสต์ = ไม่วาด (ไม่ใช่เดา)
    if (d.ext?.die_set_id === s.die_set_id) continue; // DB กันไว้แล้ว — กันซ้ำชั้นจอด้วย
    (m[s.die_set_id] ||= []).push({ die: d, opSeq: s.op_seq ?? null, shared: true, homeSetId: d.ext?.die_set_id || null });
  }
  for (const arr of Object.values(m)) arr.sort((a, b) => (a.opSeq ?? 9e9) - (b.opSeq ?? 9e9));
  return m;
}

export const DIE_SHEET_HEADERS = [
  'เลขแม่พิมพ์', 'ชื่อแม่พิมพ์ (เดิม)', 'ข้อมูลเดิม (รุ่น/ลูกค้า)', 'ไลน์ / กลุ่มเครื่องปั๊ม',
  'ชุดบ้าน (set code)', 'พาร์ทของชุดบ้าน', 'ใช้ร่วมกับชุดอื่น', 'OP', 'ชื่อ OP', 'กระบวนการ',
  'ชนิดป้อน', 'ชิ้นเข้า/shot', 'ชิ้นออก/shot', 'ระยะพิทช์ (มม.)', 'กว้างคอยล์ (มม.)',
  'ความสูงตอนปิดพิมพ์ (มม.)', 'ตัน', 'น้ำหนัก (กก.)', 'ยาว (มม.)', 'กว้าง (มม.)',
  'shot สะสม', 'เจียรแล้ว', 'เจียรได้สูงสุด', 'สถานะใช้งาน', 'หมายเหตุ',
];

export const SET_SHEET_HEADERS = [
  'set code', 'ชื่อพาร์ท / ชุด', 'เลขพาร์ท', 'MAT SAP', 'MAT ตัวที่ 2', 'รุ่น / ลูกค้า',
  'ไลน์หลัก', 'รูปแบบชุด', 'เจ้าของแม่พิมพ์', 'จำนวน OP ที่ระบุ', 'แม่พิมพ์ในชุด (ตัว)',
  'เลขแม่พิมพ์ตาม OP', 'สถานะใช้งาน', 'หมายเหตุ',
];

/**
 * แถวของ 2 ชีต — ชีตแม่พิมพ์ (ราย OP) + ชีตชุด
 * @param p.dies    แม่พิมพ์ในขอบเขต [{ id, machine_no, machine_name, line_name, is_active, ext }]
 * @param p.sets    ชุดในขอบเขต
 * @param p.shared  แถว die_set_shared_dies
 * @param p.opTypeLabel  (key) => ป้ายกระบวนการ
 * @param p.kindLabel    (key) => ป้ายรูปแบบชุด
 */
export function dieRegistryAoa({ dies = [], sets = [], shared = [], opTypeLabel = (k) => k || '', kindLabel = (k) => k || '' } = {}) {
  const setById = new Map(sets.map(s => [s.id, s]));
  const sharedByDie = {};
  for (const s of shared) (sharedByDie[s.machine_id] ||= []).push(s);

  const dieRows = [...dies]
    .sort((a, b) => String(a.ext?.die_no || '~').localeCompare(String(b.ext?.die_no || '~')))
    .map(d => {
      const e = d.ext || {};
      const home = setById.get(e.die_set_id);
      const also = (sharedByDie[d.id] || [])
        .map(s => {
          const st = setById.get(s.die_set_id);
          const code = st?.set_code || st?.part_name || '(ชุดนอกขอบเขต)';
          return s.op_seq != null ? `${code} (OP${s.op_seq})` : code;
        }).join(' · ');
      return [
        v(e.die_no), v(d.machine_no), v(d.machine_name), v(d.line_name),
        home ? v(home.set_code || home.part_name) : '', home ? v(home.part_name) : '', also,
        v(e.op_seq), v(e.op_name), e.op_type ? v(opTypeLabel(e.op_type)) : '',
        e.feed_type ? feedTypeLabel(e.feed_type) : '', v(e.pieces_in_per_stroke), v(e.pieces_per_stroke),
        v(e.feed_pitch_mm), v(e.coil_width_mm),
        v(e.die_height_mm), v(e.tonnage_ton), v(e.weight_kg), v(e.length_mm), v(e.width_mm),
        v(e.shot_total), v(e.regrind_count), v(e.regrind_limit),
        d.is_active === false ? 'ปิดใช้' : 'ใช้งาน', v(e.note),
      ];
    });

  const mem = membersBySet(dies, shared);
  const setRows = [...sets]
    .sort((a, b) => String(a.line_name || '').localeCompare(String(b.line_name || ''))
      || String(a.set_code || '').localeCompare(String(b.set_code || '')))
    .map(s => {
      const ms = mem[s.id] || [];
      const ops = ms.map(x => `${x.opSeq != null ? `OP${x.opSeq}` : 'OP?'}=${x.die.ext?.die_no || '?'}${x.shared ? '(ร่วม)' : ''}`).join(' · ');
      return [
        v(s.set_code), v(s.part_name), v(s.part_no), v(s.mat_no), v(s.mat_no_2), v(s.model),
        v(s.line_name), s.kind ? v(kindLabel(s.kind)) : '', s.owner ? dieOwnerLabel(s.owner) : '',
        v(s.op_total), ms.length, ops, s.is_active === false ? 'ปิดใช้' : 'ใช้งาน', v(s.note),
      ];
    });

  return {
    dies: [DIE_SHEET_HEADERS, ...dieRows],
    sets: [SET_SHEET_HEADERS, ...setRows],
  };
}
