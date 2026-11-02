/* 🧩 scopePicker — ยุบช่อง ③ (ส่วนงาน) เข้ากับ ④ (Cost Center) ให้เหลือตัวเลือกเดียว "ตามผังองค์กร"
 * (2026-11-02 · คำสั่ง user: *"3 กับ 4 ควรจะรวมกัน … เลือก 4 มันครอบคลุมอยู่แล้ว มันตามผังองค์กร"*
 *  ต่อยอดจาก 28/10 *"ยุบเหลือแกนเดียว · CC ละเอียดกว่า"*)
 *
 * หลัก: admin ติ๊ก "หน่วยที่ดูแล" ที่ต้นไม้ CC ที่เดียว แล้วระบบ **derive** `profiles.sections`
 * (ขอบเขตที่เห็น = ส่วนงานของหน่วยที่ติ๊ก) ให้เอง — ไม่ต้องติ๊ก 2 ที่ให้ขัดกันอีก
 *   · เห็น  = ส่วนงานแม่ของทุกหน่วยที่ติ๊ก (`profiles.sections` · ~40 จอยังอ่านช่องนี้ ⇒ ต้องมีค่าเสมอ)
 *   · แก้   = หน่วยที่ติ๊กตามลำดับชั้น (`profiles.resp_cost_centers` · `ccScope.js` ตัดสินเหมือนเดิม)
 *
 * 🔴 กฎข้าม session: **ห้ามคืน sections แคบกว่าที่ตั้งไว้เดิม** (บทเรียน 26/10)
 *   · ยังไม่ติ๊ก CC เลย ⇒ คืน `legacy` เดิมเป๊ะ (บัญชีเก่าพฤติกรรมไม่เปลี่ยน)
 *   · ค่าเดิมที่ map กลับเป็น CC ไม่ได้ (หน่วยหายจากผัง/ไม่มีรหัส) ⇒ **คงไว้** ไม่ทิ้ง
 * 🔴 ไฟล์นี้ pure — รับดัชนีจาก `buildCcIndex()` (`ccScope.js`) ไม่สร้างกฎ CC ชุดที่ 2
 */

const norm = (s) => String(s ?? '').trim().toLowerCase();
const keyOf = (n) => (n?.code || n?.name || '').toString().trim();

/** โหนด "ชั้นขอบเขต" ของเส้นทางนี้ = section บนสุด · ไม่มี section (แผนกขึ้นตรงฝ่าย) = รากของสาย */
function scopeNodeOfPath(path) {
  if (!path?.length) return null;
  return path.find((n) => n.kind === 'section') || path[0];
}

/** ส่วนงานที่ "เห็น" จาก CC ที่ติ๊ก — คืน `{ sections, unknown }` · `unknown` = รหัสที่ผังไม่รู้จัก */
export function sectionsFromCcs(ccIdx, ccs = []) {
  const out = new Set(), unknown = [];
  (ccs || []).forEach((cc) => {
    const nodes = ccIdx?.nodesOfCc?.(cc) || [];
    if (!nodes.length) { unknown.push(cc); return; }
    nodes.forEach((n) => {
      const top = scopeNodeOfPath(ccIdx.pathOfNode(n.id));
      const k = keyOf(top);
      if (k) out.add(k);
    });
  });
  return { sections: [...out], unknown };
}

/** หาโหนดของค่า section เดิม (ชื่อ/รหัส · section หรือ department ที่เป็นราก) */
function nodeOfSectionValue(nodes, value) {
  const v = norm(value);
  if (!v) return null;
  const hit = (kind) => (nodes || []).find((n) => n.kind === kind && [n.code, n.name].some((t) => norm(t) === v)) || null;
  /* 🔴 ชื่อซ้ำ 2 ชั้นมีจริง — section "QA" (2140441000) กับ department "QA" สำนักงานใต้มัน (214055654)
     ค่า sections เดิมหมายถึง "ทั้งส่วนงาน" เสมอ ⇒ ต้องเลือก section ก่อน ไม่งั้นติ๊ก CC ของแผนก = แคบลงเงียบ */
  return hit('section') || hit('department');
}

/**
 * แปลงค่า `sections` เดิมเป็น CC ที่ควรติ๊กไว้ล่วงหน้า (เปิดจอบัญชีเก่าแล้วต้องเห็นว่าติ๊กอยู่)
 * คืน `{ ccs, unmapped }` · `unmapped` = ค่าเดิมที่แปลงไม่ได้ — ต้องคงไว้ ห้ามทิ้ง
 * 🔴 ติ๊กให้เฉพาะโหนดที่ **มีรหัสของตัวเอง** — รหัสที่ตกทอดจากแม่ติ๊กแทนไม่ได้ (จะกว้างกว่าค่าเดิม)
 */
export function ccsForSections(ccIdx, nodes, sections = []) {
  const ccs = [], unmapped = [];
  (sections || []).forEach((s) => {
    const n = nodeOfSectionValue(nodes, s);
    const r = n ? ccIdx?.ccOfNode?.(n.id) : null;
    if (r?.cc && !r.inherited) { if (!ccs.includes(r.cc)) ccs.push(r.cc); }
    else unmapped.push(s);
  });
  return { ccs, unmapped };
}

/**
 * ค่า `sections` ที่จะบันทึกจริง
 *   · ไม่ติ๊ก CC เลย        → `legacy` เดิมเป๊ะ
 *   · ติ๊กแล้ว              → derive จาก CC ∪ ค่าเดิมที่แปลงเป็น CC ไม่ได้ (ไม่หาย)
 */
export function effectiveSections(ccIdx, nodes, ccs = [], legacy = []) {
  const base = (legacy || []).filter(Boolean);
  if (!ccs?.length) return base;
  const { sections } = sectionsFromCcs(ccIdx, ccs);
  const { unmapped } = ccsForSections(ccIdx, nodes, base);
  const seen = new Set(sections.map(norm));
  unmapped.forEach((s) => { if (!seen.has(norm(s))) { seen.add(norm(s)); sections.push(s); } });
  return sections;
}
