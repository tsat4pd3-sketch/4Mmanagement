/* ══ orgNodeRefs — "ใครอ้างโหนดในผังองค์กรอยู่" ก่อนลบ / เปลี่ยนชื่อ / ปิดใช้งาน ═══════════
   (2026-10-05 · คำสั่ง user "เช็ค relate table ที แก้ไห้ถูก")

   relate table ของ `org_nodes` (Main project) — วัดจริง 05/10:
     org_nodes.parent_id          → ลูกในผัง              17 แผนก · 28 กลุ่ม · 12 ทีม
     employees.org_node_id        → แกนสังกัดของพนักงาน    308 แถว
     profiles.org_node_id         → สังกัดของบัญชี          72 แถว
     org_assignments.org_node_id  → การแต่งตั้งหัวหน้าหน่วย  4 แถว  (cascade — หายพร้อมโหนด)
     + **"สำเนาชื่อ" ที่ทะเบียนอื่นเก็บเป็น text ไม่ผูก FK** (ไม่มีใครเตือนเวลาลบ/เปลี่ยนชื่อ):
       employees.section / department / group_name / team · profiles.section / team / sections[]
       **+ นอกฝั่งพนักงาน (เพิ่ม 08/10 — เดิมไม่ถูกนับเลย ⇒ กำพร้าเงียบ):**
       shift_schedules.dept_name 35 · kpi_definitions.scope_value (MTN 11 · JIG MTN 13 · PD1-4 56)
       · cost_centers.section  → ดู `ORG_TEXT_REF[].extra` ข้างล่าง
   🔴 **ลิสต์นี้ต้องวัดจากฐาน ไม่ใช่เขียนจากความจำ** — วิธีที่ใช้ 08/10 คือสแกน *ทุกคอลัมน์ text
      ของ schema public* หาค่าที่เท่ากับคีย์โหนด (query_to_xml ครอบ information_schema.columns)
      แล้วคัดตัวที่ "คนละความหมาย" ออกเอง (cost_centers.name = ชื่อศูนย์ต้นทุน ·
      pe_cp_items.person = ผู้ตรวจ) — ถ้าไล่จากลิสต์เดิม จะตก 3 ตารางนี้ทุกครั้ง

   🔴 คีย์ที่ใช้จับคู่ **ไม่เหมือนกันทุกชั้น — ห้ามเดาว่าเป็น `name` เสมอ**
      · กลุ่ม (`kind='line'`) ทะเบียนพนักงานเก็บ **ชื่อกลุ่ม** (operator.jsx: code ของ kind='line'
        เป็นเลขไลน์ '9'/'12' ไม่สื่อความหมาย และไม่ตรงข้อมูลเดิม) — ยอมรับ code เป็นค่าเดิมได้ด้วย
      · ส่วนงาน / แผนก / ทีม เก็บ **`code || name`** (= `orgKey` — dropdown ทุกหน้าอ่านผ่าน `orgValues()`)
        ทีมในผังชื่อ "Team A" แต่ `code='A'` ⇒ `employees.team = 'A'` (วัด 05/10: A 149 · B 125 · C 25 คน)
   🔴 **โหนด active ตัวอื่นที่ถือคีย์เดียวกัน = ลบตัวนี้แล้วชื่อยังไม่กำพร้า**
      (ทีม A/B/C มี 4 ชุด ชุดละกลุ่ม ⇒ ลบ "Team A" ของกลุ่มหนึ่งไม่ได้ทำให้ 149 คนเสียคีย์)
   🔴 **นับไม่ครบ = ห้ามตอบ 0** — คิวรีนับล้มต้องคืน `partial` แล้วให้จอ "ไม่ลบ" ไว้ก่อน
      (ENGINEERING-PRINCIPLES §2 ห้ามล้มเหลวเงียบ · การลบย้อนไม่ได้ ⇒ fail-closed)
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { orgKey } from './listOrder.js';   // .js = ให้ node --test resolve ได้ (ไฟล์นี้มีเทส)

export const ORG_KIND_TH = { section: 'ส่วนงาน', department: 'แผนก', line: 'กลุ่ม', team: 'ทีม' };

/* ทะเบียน "นอกฝั่งพนักงาน" ที่เก็บคีย์ผังเป็นข้อความด้วย — วัดจริง 08/10 ด้วยการสแกน
   **ทุกคอลัมน์ text ของ schema public** (query_to_xml) ไม่ใช่ไล่จากลิสต์ที่เขียนไว้
   🔴 3 ตัวนี้เคย "ไม่ถูกนับเลย" ⇒ ลบ/เปลี่ยนชื่อแผนกแล้ว KPI กับตารางกะกำพร้าเงียบ
      · `shift_schedules.dept_name`   35 แถวที่คีย์ 'MTN'
      · `kpi_definitions.scope_value` 'MTN' 11 · 'JIG MTN' 13 · PD1-4 56  ← นิยาม KPI ทั้งระบบ
      · `cost_centers.section`        รหัสศูนย์ต้นทุนผูกส่วนงาน/แผนก
   ⚠️ `kpi_definitions` เก็บทั้งส่วนงานและแผนกในคอลัมน์เดียว ⇒ **ต้องกรอง `scope_kind` ด้วย**
      ไม่กรอง = ส่วนงานชื่อซ้ำกับแผนกจะนับของกันเอง
   ⚠️ ไม่นับ `cost_centers.name` — นั่นคือ **ชื่อศูนย์ต้นทุนเอง** (มี 'MTN'/'DIE MTN' อยู่จริง
      แต่คนละความหมาย) · เช่นเดียวกับ `pe_cp_items.person` ('MTN' = ผู้ตรวจ ไม่ใช่หน่วยงาน)
   🔑 `pk` = คอลัมน์ที่เอาไปนับแถวตอน rename — `cost_centers` **ไม่มี `id`** (PK = `code`)
   ⚠️ ชื่อฟิลด์เป็น `tbl` ไม่ใช่ `table` **โดยเจตนา** — ด่าน `realtime-table-registered`
      สแกนหา `table: '<ชื่อ>'` ทั้งรีโป (= รูปของ option ตอน subscribe realtime)
      ใช้ `table:` ที่นี่ = ด่านเตือนผิดทุกครั้ง · **แก้ชื่อฟิลด์ฝั่งเรา ไม่ใช่ผ่อนด่าน** */
const KPI = (kindValue) => ({ tbl: 'kpi_definitions', col: 'scope_value', label: 'นิยาม KPI',
  kindCol: 'scope_kind', kindValue });
const CC = { tbl: 'cost_centers', col: 'section', label: 'รหัสศูนย์ต้นทุน', pk: 'code' };

/** คอลัมน์ "สำเนาชื่อ" ที่แต่ละชั้นของผังถูกคัดลอกไปเก็บ (ไม่ใช่ FK — จับคู่ด้วยข้อความ) */
export const ORG_TEXT_REF = {
  section:    { employees: ['section'],    profiles: ['section'], profileArrays: ['sections'],
                extra: [CC, KPI('section')] },
  department: { employees: ['department'],  profiles: [],          profileArrays: [],
                extra: [{ tbl: 'shift_schedules', col: 'dept_name', label: 'ตารางกะ' },
                        CC, KPI('department')] },
  line:       { employees: ['group_name'], profiles: [],           profileArrays: [], extra: [] },
  team:       { employees: ['team'],        profiles: ['team'],    profileArrays: [], extra: [] },
};

/** ค่าที่ทะเบียนอื่นเก็บไว้แทนโหนดนี้ — ตัวแรก = ค่าที่ระบบเขียนใหม่เสมอ */
export function orgRefValues(node) {
  if (!node) return [];
  if (node.kind === 'line') return [node.name, node.code].filter(Boolean).map(String);
  const k = orgKey(node);
  return k ? [String(k)] : [];
}

/** โหนด active ตัวอื่น (ชั้นเดียวกัน) ที่ยังถือคีย์เดียวกัน — มี = ชื่อไม่กำพร้าถึงลบตัวนี้ */
export function otherNodesWithSameValue(node, nodes) {
  const mine = new Set(orgRefValues(node));
  if (!mine.size) return [];
  return (nodes || []).filter(n =>
    n.id !== node.id && n.kind === node.kind && n.is_active !== false
    && orgRefValues(n).some(v => mine.has(v)));
}

/** คีย์จับคู่เปลี่ยนไหม — เปลี่ยน = สำเนาชื่อในทะเบียนอื่นชี้ของที่ไม่มีอยู่แล้ว */
export function orgRefKeyChange(node, nextName, nextCode) {
  const from = orgRefValues(node)[0] || '';
  const to   = orgRefValues({ ...node, name: nextName, code: nextCode })[0] || '';
  return from && to && from !== to ? { from, to } : null;
}

const EMPTY = { empId: 0, profId: 0, heads: 0, textEmp: 0, textProf: 0, textOther: 0 };

/** นับทุกอย่างที่อ้างโหนดนี้ — คิวรีนับล้มสักตัว = `partial: true` (ห้ามเอา 0 ไปตัดสินใจลบ) */
export async function loadOrgNodeRefs(supabase, node, nodes) {
  const values = orgRefValues(node);
  const sharedWith = otherNodesWithSameValue(node, nodes);
  const HEAD = { count: 'exact', head: true };
  const t = ORG_TEXT_REF[node.kind] || { employees: [], profiles: [], profileArrays: [], extra: [] };
  const jobs = [
    ['empId',  supabase.from('employees').select('id', HEAD).eq('org_node_id', node.id)],
    ['profId', supabase.from('profiles').select('id', HEAD).eq('org_node_id', node.id)],
    ['heads',  supabase.from('org_assignments').select('id', HEAD).eq('org_node_id', node.id)],
  ];
  if (values.length) {
    for (const col of t.employees)     jobs.push([`emp:${col}`,  supabase.from('employees').select('id', HEAD).in(col, values)]);
    for (const col of t.profiles)      jobs.push([`prof:${col}`, supabase.from('profiles').select('id', HEAD).in(col, values)]);
    for (const col of t.profileArrays) jobs.push([`prof:${col}`, supabase.from('profiles').select('id', HEAD).overlaps(col, values)]);
    for (const x of t.extra || []) {
      let q = supabase.from(x.tbl).select(x.pk || 'id', HEAD).in(x.col, values);
      if (x.kindCol) q = q.eq(x.kindCol, x.kindValue);   // 🔴 ไม่กรอง = นับข้ามชั้นกันเอง
      jobs.push([`other:${x.label}`, q]);
    }
  }
  const res = await Promise.all(jobs.map(([, q]) => q));
  const out = { ...EMPTY, values, sharedWith, partial: false, otherBy: [] };
  res.forEach((r, i) => {
    const key = jobs[i][0];
    if (r?.error) { out.partial = true; return; }
    const n = r?.count || 0;
    if (key === 'empId') out.empId = n;
    else if (key === 'profId') out.profId = n;
    else if (key === 'heads') out.heads = n;
    else if (key.startsWith('emp:')) out.textEmp += n;
    else if (key.startsWith('other:')) {
      out.textOther += n;
      if (n) out.otherBy.push({ label: key.slice('other:'.length), n });
    }
    else out.textProf += n;            // บัญชีอาจถูกนับ 2 ทาง (section + sections[]) — นับเกินดีกว่าหายเงียบ
  });
  return out;
}

/** ข้อความ "ลบไม่ได้" — คืน null = ลบได้ · มีข้อความ = บล็อก */
export function orgRefBlockMessage(node, refs) {
  if (!refs) return null;
  if (refs.partial) {
    return `ยังไม่ลบ "${node.name}" — ตรวจไม่ครบว่ามีอะไรอ้างถึงอยู่ (คิวรีนับล้ม) · ลองใหม่อีกครั้ง`;
  }
  const parts = [];
  if (refs.empId)  parts.push(`พนักงาน ${refs.empId} คนสังกัดอยู่`);
  if (refs.profId) parts.push(`บัญชีผู้ใช้ ${refs.profId} รายการสังกัดอยู่`);
  if (!refs.sharedWith?.length) {
    const v = (refs.values || []).join(' / ');
    if (refs.textEmp)  parts.push(`ทะเบียนพนักงาน ${refs.textEmp} คนยังเขียน "${v}" ไว้`);
    if (refs.textProf) parts.push(`บัญชีผู้ใช้ ${refs.textProf} รายการยังเขียน "${v}" ไว้`);
    // ทะเบียนนอกฝั่งพนักงาน (ตารางกะ · นิยาม KPI · ศูนย์ต้นทุน) — บอกเป็นรายชื่อทะเบียน
    for (const o of refs.otherBy || []) parts.push(`${o.label} ${o.n} รายการยังเขียน "${v}" ไว้`);
  }
  if (!parts.length) return null;
  return `ลบไม่ได้: "${node.name}" ยังถูกใช้อยู่ — ${parts.join(' · ')}`
       + ' · ย้ายคนออกที่หน้าพนักงานก่อน หรือกด "ปิดใช้งาน" แทนการลบ';
}

/** หมายเหตุท้าย confirm ตอนลบ — ของที่จะหายไปด้วย / ของที่ไม่กำพร้าเพราะมีโหนดอื่นถือคีย์ */
export function orgRefDeleteNote(refs) {
  if (!refs) return '';
  const l = [];
  if (refs.heads) l.push(`⚠ การแต่งตั้งหัวหน้าหน่วยนี้ ${refs.heads} รายการจะถูกลบไปด้วย`);
  if (refs.sharedWith?.length && (refs.textEmp || refs.textProf)) {
    l.push(`ℹ คีย์ "${(refs.values || []).join(' / ')}" ยังมีโหนดอื่นถืออยู่ ${refs.sharedWith.length} ตัว`
         + ' — ทะเบียนที่อ้างชื่อนี้จึงไม่กำพร้า');
  }
  return l.length ? '\n\n' + l.join('\n') : '';
}

/** หมายเหตุตอน "ปิดใช้งาน" — หายจาก dropdown ทั้งระบบ คนที่ผูกอยู่จะเลือกใหม่ไม่ได้
 *  พนักงานคนเดียวกันถูกนับได้ 2 ทาง (org_node_id + สำเนาชื่อ) ⇒ ใช้ค่ามากสุด ไม่บวกกัน */
export function orgRefDeactivateNote(refs) {
  if (!refs || refs.partial) return '';
  const emps = Math.max(refs.empId || 0, refs.textEmp || 0);
  const bits = [];
  if (emps) bits.push(`พนักงาน ${emps} คน`);
  if (refs.profId) bits.push(`บัญชี ${refs.profId} รายการ`);
  if (!bits.length) return '';
  return `\n\n⚠ มี${bits.join(' · ')} ผูกอยู่กับหน่วยนี้`
       + ' — ข้อมูลเดิมไม่หาย แต่จะเลือกหน่วยนี้ใหม่ไม่ได้จนเปิดกลับ';
}

/** ไล่เปลี่ยน "สำเนาชื่อ" ตามโหนดที่เพิ่งเปลี่ยนคีย์ — คืนจำนวนแถวที่เขียนได้จริงรายคอลัมน์
 *  🔴 นับแถวจาก `.select('id')` ไม่ใช่ `!error` — RLS ปฏิเสธ UPDATE = สำเร็จ 0 แถว ไม่มี error
 *     (db-write-rules ข้อ 2) */
export async function renameOrgRefs(supabase, node, from, to) {
  const t = ORG_TEXT_REF[node.kind] || { employees: [], profiles: [], profileArrays: [], extra: [] };
  const out = { rows: 0, failed: [] };
  const run = async (table, col, q, pk = 'id') => {
    const { data, error } = await q.select(pk);
    if (error) out.failed.push(`${table}.${col}: ${error.message}`);
    else out.rows += (data || []).length;
  };
  for (const col of t.employees) {
    await run('employees', col, supabase.from('employees').update({ [col]: to }).eq(col, from));
  }
  for (const col of t.profiles) {
    await run('profiles', col, supabase.from('profiles').update({ [col]: to }).eq(col, from));
  }
  // profiles.sections = text[] (ขอบเขตที่บัญชีมองเห็น) — แก้ทีละแถว ต่อท้ายของเดิม ห้ามเขียนทับทั้ง array
  for (const col of t.profileArrays) {
    const { data, error } = await supabase.from('profiles').select(`id, ${col}`).overlaps(col, [from]);
    if (error) { out.failed.push(`profiles.${col}: ${error.message}`); continue; }
    for (const row of data || []) {
      const next = [...new Set((row[col] || []).map(v => (v === from ? to : v)))];
      await run('profiles', col, supabase.from('profiles').update({ [col]: next }).eq('id', row.id));
    }
  }
  // ทะเบียนนอกฝั่งพนักงาน — ลืมไล่ตามที่นี่ = KPI/ตารางกะชี้ชื่อที่ไม่มีอยู่แล้ว (เงียบ)
  for (const x of t.extra || []) {
    let q = supabase.from(x.tbl).update({ [x.col]: to }).eq(x.col, from);
    if (x.kindCol) q = q.eq(x.kindCol, x.kindValue);
    await run(x.tbl, x.col, q, x.pk || 'id');
  }
  return out;
}
