/* ══ orgNodeRefs — "ใครอ้างโหนดในผังองค์กรอยู่" ก่อนลบ / เปลี่ยนชื่อ / ปิดใช้งาน ═══════════
   (2026-10-05 · คำสั่ง user "เช็ค relate table ที แก้ไห้ถูก")

   relate table ของ `org_nodes` (Main project) — วัดจริง 05/10:
     org_nodes.parent_id          → ลูกในผัง              17 แผนก · 28 กลุ่ม · 12 ทีม
     employees.org_node_id        → แกนสังกัดของพนักงาน    308 แถว
     profiles.org_node_id         → สังกัดของบัญชี          72 แถว
     org_assignments.org_node_id  → การแต่งตั้งหัวหน้าหน่วย  4 แถว  (cascade — หายพร้อมโหนด)
     + **"สำเนาชื่อ" ที่ทะเบียนอื่นเก็บเป็น text ไม่ผูก FK** (ไม่มีใครเตือนเวลาลบ/เปลี่ยนชื่อ):
       employees.section / department / group_name / team · profiles.section / team / sections[]

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

/** คอลัมน์ "สำเนาชื่อ" ที่แต่ละชั้นของผังถูกคัดลอกไปเก็บ (ไม่ใช่ FK — จับคู่ด้วยข้อความ) */
export const ORG_TEXT_REF = {
  section:    { employees: ['section'],    profiles: ['section'], profileArrays: ['sections'] },
  department: { employees: ['department'],  profiles: [],          profileArrays: [] },
  line:       { employees: ['group_name'], profiles: [],           profileArrays: [] },
  team:       { employees: ['team'],        profiles: ['team'],    profileArrays: [] },
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

const EMPTY = { empId: 0, profId: 0, heads: 0, textEmp: 0, textProf: 0 };

/** นับทุกอย่างที่อ้างโหนดนี้ — คิวรีนับล้มสักตัว = `partial: true` (ห้ามเอา 0 ไปตัดสินใจลบ) */
export async function loadOrgNodeRefs(supabase, node, nodes) {
  const values = orgRefValues(node);
  const sharedWith = otherNodesWithSameValue(node, nodes);
  const HEAD = { count: 'exact', head: true };
  const t = ORG_TEXT_REF[node.kind] || { employees: [], profiles: [], profileArrays: [] };
  const jobs = [
    ['empId',  supabase.from('employees').select('id', HEAD).eq('org_node_id', node.id)],
    ['profId', supabase.from('profiles').select('id', HEAD).eq('org_node_id', node.id)],
    ['heads',  supabase.from('org_assignments').select('id', HEAD).eq('org_node_id', node.id)],
  ];
  if (values.length) {
    for (const col of t.employees)     jobs.push([`emp:${col}`,  supabase.from('employees').select('id', HEAD).in(col, values)]);
    for (const col of t.profiles)      jobs.push([`prof:${col}`, supabase.from('profiles').select('id', HEAD).in(col, values)]);
    for (const col of t.profileArrays) jobs.push([`prof:${col}`, supabase.from('profiles').select('id', HEAD).overlaps(col, values)]);
  }
  const res = await Promise.all(jobs.map(([, q]) => q));
  const out = { ...EMPTY, values, sharedWith, partial: false };
  res.forEach((r, i) => {
    const key = jobs[i][0];
    if (r?.error) { out.partial = true; return; }
    const n = r?.count || 0;
    if (key === 'empId') out.empId = n;
    else if (key === 'profId') out.profId = n;
    else if (key === 'heads') out.heads = n;
    else if (key.startsWith('emp:')) out.textEmp += n;
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
  const t = ORG_TEXT_REF[node.kind] || { employees: [], profiles: [], profileArrays: [] };
  const out = { rows: 0, failed: [] };
  const run = async (table, col, q) => {
    const { data, error } = await q.select('id');
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
  return out;
}
