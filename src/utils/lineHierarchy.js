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
        family = "ใครมีสิทธิ์เห็นอะไร" (scope ของ leader — ครอบ **แม่/ปู่ + ลูก/หลานของตัวเอง**)
                 ⚠️ **ไม่รวมไลน์พี่น้อง** — สายล่าง BFS จากตัวเองเท่านั้น ไม่ไล่ลงจาก ancestors
                    (คอมเมนต์เดิมเขียนว่า "พี่น้อง" ซึ่งผิด · แก้ 2026-09-15 ตอนไล่เคส LASER-345
                     — เอกสารที่ผิดทำให้ session ถัดไปคิดว่าไลน์ลูกเห็นของพี่น้องกันอยู่)
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

/* ══ ลำดับมาตรฐานของ "รายชื่อไลน์" ทั้งระบบ (2026-10-01 · คำสั่ง user) ═════════════════════
   ที่มา: *"บางหน้าโอเค บางหน้าเรียงมั่ว ไม่มีแพทเทิร์นในการเรียง"* — ต้นเหตุจริง 3 ข้อ:
     (1) `toHierarchicalOptions` **ไม่เคยเรียงเอง** — ลำดับบนจอ = ลำดับที่หน้านั้นบังเอิญ query มา
         (`order('name')` / ไม่สั่งเรียง / กรองจาก array อื่น) ⇒ จอเดียวกันคนละหน้าเรียงไม่เหมือนกัน
     (2) ถึงเรียงตามชื่อ ก็ **ไม่แยกส่วนงาน** — LINE A (PD1) ไปอยู่ระหว่าง APRON (PD3) กับ ASSY (PD2)
     (3) เรียงแบบ byte/collation ของ DB — `Line 60` กับ `LINE …` ไปคนละที่ · `LINE 10` มาก่อน `LINE 9`
   กติกา (ทุก dropdown/ชิปไลน์ต้องได้ลำดับนี้ — ห้ามเรียงเองในหน้า · มีด่าน regressionGuards):
     1. **ส่วนงาน** เรียงธรรมชาติ (PD1 → PD2 → … ) · ไลน์ที่ไม่มีส่วนงาน = ท้ายสุด (ห้ามหาย)
     2. ในส่วนงานเดียวกัน **ไลน์แม่** เรียงธรรมชาติ — ไม่สนตัวพิมพ์/ช่องว่าง/วงเล็บ · เลขเรียงแบบตัวเลข
     3. **ไลน์ลูกอยู่ใต้แม่ทันที** เรียงธรรมชาติเหมือนกัน (ไลน์ลูกตามส่วนงานของแม่ — ลำดับชั้นชนะส่วนงาน)
   ไม่ใช้ `sort_order` ที่กรอกมือ — ไม่มีคอลัมน์นั้น และทะเบียน ~35 แถว กติกาตายตัวคาดเดาได้ดีกว่า */
const COLL = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
const normKey = (s) => String(s ?? '').replace(/[\s()_\-]+/g, ' ').trim();
/** เทียบชื่อไลน์/ส่วนงานแบบ "ธรรมชาติ" — `LINE 9` < `LINE 10` · `Line 60` = `LINE 60` */
export const lineNameCompare = (a, b) => COLL.compare(normKey(a), normKey(b)) || COLL.compare(String(a ?? ''), String(b ?? ''));
/** เทียบส่วนงาน — ว่าง/null ไปท้ายสุด */
export const sectionCompare = (a, b) => (!a) - (!b) || lineNameCompare(a || '', b || '');

/**
 * เรียง lines สำหรับ dropdown แบบเป็นขั้น: ส่วนงาน → ไลน์หลัก → ไลน์ย่อยของมัน (indent ด้วย depth)
 * ไลน์ที่ parent ไม่อยู่ใน list (เช่นโดน scope ตัด) จะโผล่เป็น top-level ของตัวเอง
 * **ลำดับไม่ขึ้นกับลำดับ input อีกแล้ว** (2026-10-01) — ส่ง array ลำดับไหนมาก็ได้ผลเดียวกัน
 * @returns {Array<{line, depth, section}>}  section = ส่วนงานของรากต้นไม้ (ใช้ตั้งหัวกลุ่ม)
 */
export function toHierarchicalOptions(lines) {
  if (!lines?.length) return [];
  const byName = (a, b) => lineNameCompare(a.name, b.name);
  const names = new Set(lines.map(l => l.name));
  const roots = lines.filter(l => !l.parent_line_name || !names.has(l.parent_line_name))
    .sort((a, b) => sectionCompare(a.section, b.section) || byName(a, b));
  const kids = new Map();
  for (const l of lines) {
    if (!l.parent_line_name || !names.has(l.parent_line_name)) continue;
    if (!kids.has(l.parent_line_name)) kids.set(l.parent_line_name, []);
    kids.get(l.parent_line_name).push(l);
  }
  for (const arr of kids.values()) arr.sort(byName);
  const out = [];
  const placed = new Set();
  const walk = (line, depth, section) => {
    if (placed.has(line)) return;          // กันวนลูป (parent ชี้กันเอง)
    placed.add(line);
    out.push({ line, depth, section });
    for (const c of kids.get(line.name) || []) walk(c, depth + 1, section);
  };
  for (const root of roots) walk(root, 0, root.section || null);
  // กันตกหล่น (เช่นข้อมูล parent วนกันเอง) — อะไรที่ยังไม่ถูกใส่ ให้ต่อท้ายแบบ flat (เรียงแล้ว)
  const rest = lines.filter(l => !placed.has(l)).sort(byName);
  for (const l of rest) out.push({ line: l, depth: 0, section: l.section || null });
  return out;
}

/** เรียง "ชื่อไลน์ล้วนๆ" (ลิสต์ที่สร้างจากข้อมูลที่โหลดมา เช่นชื่อไลน์ของกะ/ใบ/ชิป) ตามลำดับมาตรฐานเดียวกัน
 *  ชื่อที่อยู่ในทะเบียน = ตามลำดับทะเบียน (ส่วนงาน→แม่→ลูก) · ชื่อที่ไม่อยู่ในทะเบียน = ต่อท้าย เรียงธรรมชาติ (ห้ามหาย)
 *  @param registry แถว production_lines (ไม่ส่ง = เรียงธรรมชาติอย่างเดียว) */
export function sortLineNames(names, registry = []) {
  const uniq = [...new Set((names || []).filter(n => n != null && n !== ''))];
  const rank = new Map(toHierarchicalOptions(registry || []).map((o, i) => [o.line.name, i]));
  return uniq.sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : Infinity, rb = rank.has(b) ? rank.get(b) : Infinity;
    return (ra === rb ? 0 : ra < rb ? -1 : 1) || lineNameCompare(a, b);
  });
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
