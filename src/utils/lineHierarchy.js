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
