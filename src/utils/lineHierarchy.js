/**
 * Line-hierarchy helpers — production_lines เชื่อมลำดับชั้นด้วย parent_line_name (ชื่อไลน์ ไม่ใช่ id)
 *
 * "ครอบครัวของไลน์" (line family) = ตัวเอง + สายบน (ancestors) + สายล่าง (descendants)
 * โดย **ไม่รวมไลน์พี่น้อง** (siblings) — กติกาการมองเห็นแบบเป็นขั้น:
 *   - เลือกไลน์หลัก   → เห็นของตัวเอง + ไลน์ย่อยทุกไลน์ใต้มัน
 *   - เลือกไลน์ย่อย A → เห็นของ A + ไลน์หลัก (แต่ไม่เห็นของไลน์ย่อย B/C ข้างเคียง)
 *
 * ใช้ร่วมกันทั้งหน้า Management (จุดงาน/WIP/เครื่องจักร/ผัง/pool scope) และ Checkin (กรองพนักงานตามไลน์)
 */

/**
 * @param {Array} allLines  แถวจาก production_lines (ต้องมี id, name, parent_line_name)
 * @param {number|string} ref  id (number) หรือ name (string) ของไลน์ตั้งต้น
 * @returns {Array} line objects: ตัวเองก่อน ตามด้วย ancestors แล้ว descendants (ไม่มีตัวซ้ำ)
 */
export function getLineFamily(allLines, ref) {
  if (!allLines?.length || ref == null || ref === '') return [];
  const self = typeof ref === 'number'
    ? allLines.find(l => l.id === ref)
    : allLines.find(l => l.name === ref);
  if (!self) return [];

  const fam = [self];
  const seen = new Set([self.name]);

  // สายบน — เดินขึ้นตาม parent_line_name (กัน loop ด้วย seen)
  let cur = self;
  while (cur?.parent_line_name && !seen.has(cur.parent_line_name)) {
    const parent = allLines.find(l => l.name === cur.parent_line_name);
    if (!parent) break;
    seen.add(parent.name);
    fam.push(parent);
    cur = parent;
  }

  // สายล่าง — BFS จากตัวเองเท่านั้น (ไม่ไล่จาก ancestors จึงไม่ติดไลน์พี่น้องมา)
  const queue = [self.name];
  while (queue.length) {
    const name = queue.shift();
    for (const child of allLines) {
      if (child.parent_line_name === name && !seen.has(child.name)) {
        seen.add(child.name);
        fam.push(child);
        queue.push(child.name);
      }
    }
  }
  return fam;
}

/** ชื่อไลน์ทั้งครอบครัว (ตัวเองอยู่ตัวแรก) — ใช้ยิง .in('line_name', ...) */
export const getLineFamilyNames = (allLines, ref) => getLineFamily(allLines, ref).map(l => l.name);

/** Set ของ id ทั้งครอบครัว — ใช้เช็ค employees.line_id */
export const getLineFamilyIds = (allLines, ref) => new Set(getLineFamily(allLines, ref).map(l => l.id));

/* ══ กฎ "หน่วยย่อยที่สุด" (leaf line) — user เคาะ 2026-08-31 ═══════════════════════
   "ของมันต้องส่งเข้าไลน์ลูกอยู่แล้วถ้าไลน์แม่มีลูก เพื่อการมอนิเตอร์
    คือต้องดูไปที่หน่วยย่อยที่สุด ถ้าไม่มีลูก ไลน์นั้นถึงจะเป็นหน่วยย่อยสุด"

   ⇒ ไลน์แม่ที่มีลูก = **แผนก** ไม่ใช่จุดวางของ · ของ/ยอดคงเหลือ/min-max อยู่ที่ leaf เสมอ

   ⚠️ คนละแกนกับ `getLineFamilyNames` — อย่าสับสน:
        family = "ใครมีสิทธิ์เห็นอะไร" (scope ของ leader — ครอบแม่+พี่น้อง+ลูก)
        leaf   = "ของอยู่ที่ไหนจริง"   (หน่วยนับสต็อก — ตัวเดียว ไม่ครอบใคร)
      เอา family ไปนับสต็อก = ไลน์ลูกหลายตัวนับของก้อนเดียวกันของแม่ซ้ำกันทุกตัว
      → จอบอก "ของพอ" ทั้งที่หน้าไลน์ไม่มีของ = ซ่อนการขาด (ทิศที่อันตรายที่สุด) */

/** ชื่อไลน์ลูกตรงๆ (ชั้นเดียว ไม่ไล่ลงหลาน) */
export const getChildLineNames = (allLines, name) =>
  (allLines || []).filter(l => l.parent_line_name === name).map(l => l.name);

/** ไลน์นี้เป็นหน่วยย่อยที่สุดไหม (ไม่มีลูก) = เป็นจุดวางของ/หน่วยมอนิเตอร์ได้
 *  ⚠️ `lines` ยังโหลดไม่เสร็จ → คืน true (ถือว่าเป็น leaf ไว้ก่อน)
 *     ไม่งั้นจอจะขึ้น "ไลน์นี้เป็นไลน์แม่" แวบนึงทุกครั้งที่เปิดหน้า */
export const isLeafLine = (allLines, name) =>
  !name || !allLines?.length ? true : getChildLineNames(allLines, name).length === 0;

/** ไลน์ลูกที่เป็น leaf ทั้งหมดใต้ไลน์นี้ (ตัวเองเป็น leaf = คืนตัวเอง) — ปลายทางที่ของควรอยู่ */
export function getLeafLineNames(allLines, name) {
  if (!name) return [];
  const kids = getChildLineNames(allLines, name);
  if (!kids.length) return [name];
  const out = [];
  const seen = new Set([name]);
  const queue = [...kids];
  while (queue.length) {
    const n = queue.shift();
    if (seen.has(n)) continue;
    seen.add(n);
    const c = getChildLineNames(allLines, n);
    if (c.length) queue.push(...c); else out.push(n);
  }
  return out;
}

/** สายบนอย่างเดียว (ไม่รวมตัวเอง) เรียงจากใกล้ → ไกล — ใช้หา layout fallback */
export function getAncestorNames(allLines, name) {
  const out = [];
  const seen = new Set([name]);
  let cur = allLines?.find(l => l.name === name);
  while (cur?.parent_line_name && !seen.has(cur.parent_line_name)) {
    const parent = allLines.find(l => l.name === cur.parent_line_name);
    if (!parent) break;
    seen.add(parent.name);
    out.push(parent.name);
    cur = parent;
  }
  return out;
}

/**
 * เรียง lines สำหรับ dropdown แบบเป็นขั้น: ไลน์หลักก่อน ตามด้วยไลน์ย่อยของมัน (indent ด้วย depth)
 * ไลน์ที่ parent ไม่อยู่ใน list (เช่นโดน scope ตัด) จะโผล่เป็น top-level ของตัวเอง
 * @returns {Array<{line, depth}>}
 */
export function toHierarchicalOptions(lines) {
  if (!lines?.length) return [];
  const names = new Set(lines.map(l => l.name));
  const roots = lines.filter(l => !l.parent_line_name || !names.has(l.parent_line_name));
  const out = [];
  const walk = (parentName, depth) => {
    for (const child of lines) {
      if (child.parent_line_name === parentName) {
        out.push({ line: child, depth });
        walk(child.name, depth + 1);
      }
    }
  };
  for (const root of roots) {
    out.push({ line: root, depth: 0 });
    walk(root.name, 1);
  }
  // กันตกหล่น (เช่นข้อมูล parent วนกันเอง) — อะไรที่ยังไม่ถูกใส่ ให้ต่อท้ายแบบ flat
  const placed = new Set(out.map(o => o.line.id));
  for (const l of lines) if (!placed.has(l.id)) out.push({ line: l, depth: 0 });
  return out;
}

/* ── จับคู่แผนก (org_nodes department) ↔ ไลน์ (2026-07-21) ──
   เทียบแบบ normalize (ตัดช่องว่าง/ขีด + UPPERCASE) เพราะชื่อในสองตารางพิมพ์ไม่ตรงกันบ่อย
   (เช่น org แผนก "LWRBAR" vs ไลน์ "LWR BAR" — เทียบตรงตัวแล้ว dropdown ว่าง เลือกไลน์ไม่ได้)
   + fail-open: ไม่ match สักไลน์ = คืนลิสต์ที่รับมา (กรองด้วย section แล้ว) ห้ามคืนลิสต์ว่าง */
export const normOrgName = (s) => String(s || '').toUpperCase().replace(/[\s\-_]+/g, '');
export const filterLinesByDept = (lineList, department) => {
  if (!department) return lineList;
  const nd = normOrgName(department);
  const matched = lineList.filter(l => normOrgName(l.name) === nd || normOrgName(l.parent_line_name) === nd);
  return matched.length ? matched : lineList;
};

/* ══ ความลึกสำหรับ "ลิสต์ที่ถูกกรองมาแล้ว" (2026-09-08 · feedback หน้างาน) ═══════════
   จอที่แยกลิสต์เดียวกันเป็นหลายตาราง/หลายชั้น (เช่น /energy แยก "จุดที่มีมิเตอร์" กับ "ยังไม่มี")
   **ไลน์แม่มักไม่ได้อยู่ตารางเดียวกับไลน์ลูก** — ถ้าเยื้อง (indent) ตามความลึกของต้นไม้ทั้งหมด
   ไลน์ลูกจะไปเยื้องใต้ "แถวที่บังเอิญอยู่เหนือมัน" ซึ่งไม่ใช่แม่ของมันเลย
   เคสจริงที่ทำให้ต้องมีตัวนี้: HDF1/HDF2 ไปโผล่ใต้ GOR (คนละส่วนงาน) และ Line 60/61/SUB APRON
   ไปโผล่ใต้ LASER-789 → user ทัก "ไลน์แม่ลูกมั่วไปหมด" · **ลำดับชั้นที่ผิด = อ่านแล้วเชื่อผิดทันที**

   กฎ: นับเฉพาะบรรพบุรุษที่ **อยู่ในลิสต์เดียวกัน** · แม่ไม่อยู่ในลิสต์ = แบนราบ (depth 0) แล้วคืน
   `outsideParent` ให้จอเอาไปบอกเป็นข้อความแทน ("· ใต้ HYDROFORM") — ห้ามซ่อนความสัมพันธ์ทิ้งเฉยๆ */

/**
 * @param {Array<string>} keys   คีย์ของรายการที่จะแสดง (จะเป็นชื่อไลน์ตรงๆ หรือคีย์ผสมอย่าง 'line::HDF1' ก็ได้)
 * @param {(key:string)=>string|null} parentOfKey  แม่ของคีย์นั้น — ต้องตอบได้แม้คีย์นั้นไม่อยู่ใน keys
 *        (ไม่งั้นข้ามชั้นที่ถูกกรองออกไปหาปู่ที่ยังอยู่ในลิสต์ไม่เจอ)
 * @returns {Map<string,{depth:number, outsideParent:string|null}>}
 */
export function visibleDepths(keys, parentOfKey) {
  const has = new Set(keys || []);
  const parent = (k) => (typeof parentOfKey === 'function' ? parentOfKey(k) : null) || null;
  const out = new Map();
  for (const k of keys || []) {
    let depth = 0, cur = parent(k);
    const seen = new Set([k]);
    const direct = cur;
    while (cur && !seen.has(cur) && depth < 10) {   // กัน parent วนกันเอง (กฎเดียวกับ stdGroupOf)
      seen.add(cur);
      if (has.has(cur)) depth++;
      cur = parent(cur);
    }
    out.set(k, { depth, outsideParent: direct && !has.has(direct) ? direct : null });
  }
  return out;
}
