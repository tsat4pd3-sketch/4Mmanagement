/* ══ 🌳 orgScope — "ขอบเขต" ตามผังองค์กร ทุกมิติ ในตัวเดียว (pure · ห้าม import supabase/DOM) ══════
   2026-09-23 · user: *"เลือกส่วนงานตอนนี้เหมือนเลือกได้แค่ section และไม่ตรงกับผังองค์กร
   ควรกรองได้ทุกมิติในผังองค์กร"*

   ปัญหาเดิม: ทุกจอ KPI/OBEYA กรองด้วย `org_nodes kind='section'` + กลุ่มไลน์ (production_lines parent)
   ⇒ **แผนกที่ขึ้นตรงฝ่าย (MTN · JIG MTN · DIE MTN · QA) เลือกไม่ได้เลย** ทั้งที่ JIG MTN เป็น 1 ใน 3 ใบ KPI
   จริงที่ user ส่งมา · แผนกใต้ส่วนงาน (BIG PRESS/HYDROFORM) ก็ไม่มีในตัวเลือก · cost center เป็นอีกแกน

   ไฟล์นี้เป็นเจ้าของ:
     1) โครงต้นไม้ 1 ต้น = plant → division (ป้าย) → section → department → line_group → line
        (+ แกน cost_center แยกต่างหาก — ห้ามเอาไปเรียงปนสายไลน์ ดู kpiSetup.KPI_SCOPE_LEVELS)
     2) `lineNamesOf(kind, value)` — ขอบเขตหนึ่งครอบไลน์ผลิตไหนบ้าง (ตัวกรองข้อมูลจริงของทุกจอ)
     3) `ancestorsOf` / `sectionOf` / `sectionsOf` — ไต่ขึ้นบน (นิยาม KPI ระดับแม่ตกทอดถึงลูก)
     4) `labelOf` / `key` / `parse` — ป้ายและ URL param `?scope=kind:value`

   กติกา (ตกผลึกจากบั๊กที่เคยเกิดกับ dropdown ไลน์/ส่วนงาน):
     🔴 ไลน์ที่ผังยังไม่ผูก (ไม่มี org line node ชี้มา) ต้องมีที่อยู่ใต้ส่วนงานของมัน **ห้ามหายจากตัวเลือก**
     🔴 node ที่ไม่มีไลน์ผลิต (MTN · Store Raw Material) ยังต้องเลือกได้ — KPI กรอกมือลึกแค่ไหนก็ได้
        (`lineNamesOf` คืน [] · จอที่คำนวณอัตโนมัติต้องเขียนว่า "ข้อมูลไปไม่ถึงระดับนี้" ห้ามโชว์ 0)
     🔴 ชื่อ section เทียบแบบ normalize (PLN & STO vs Planning&Store — ผังใช้ code แต่ไลน์เก็บ text)
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

export const SCOPE_KIND_META = {
  plant:       { label: 'ทั้งโรงงาน', short: 'โรงงาน', icon: '🏭', depth: 0 },
  division:    { label: 'ฝ่าย',       short: 'ฝ่าย',   icon: '🏢', depth: 1 },
  section:     { label: 'ส่วนงาน',    short: 'ส่วนงาน', icon: '📁', depth: 2 },
  department:  { label: 'แผนก',      short: 'แผนก',   icon: '📂', depth: 3 },
  line_group:  { label: 'กลุ่มไลน์',   short: 'กลุ่ม',   icon: '🔗', depth: 4 },
  line:        { label: 'ไลน์',       short: 'ไลน์',   icon: '➖', depth: 5 },
  cost_center: { label: 'Cost Center', short: 'CC',    icon: '💰', depth: null },
};
export const SCOPE_KINDS = Object.keys(SCOPE_KIND_META);

export const PLANT = Object.freeze({ kind: 'plant', value: '' });

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s\-_&]+/g, '');
const nodeCode = (n) => n.code || n.name;

/** คีย์ตัวเดียวสำหรับ URL / Map — `plant` ไม่มีค่า */
export const scopeKey = (kind, value) => (kind && kind !== 'plant' ? `${kind}:${value ?? ''}` : 'plant');
export function parseScopeKey(s) {
  const t = String(s || '').trim();
  if (!t || t === 'plant') return { ...PLANT };
  const i = t.indexOf(':');
  if (i < 0) return { ...PLANT };
  const kind = t.slice(0, i), value = t.slice(i + 1);
  return SCOPE_KIND_META[kind] && value ? { kind, value } : { ...PLANT };
}
export const isPlant = (sc) => !sc || !sc.kind || sc.kind === 'plant' || !sc.value;

/**
 * สร้างดัชนีขอบเขตจากผังองค์กร + ทะเบียนไลน์
 * @param nodes     org_nodes (id, kind, code, name, parent_id, ref_line_id, cost_center, division, sort_order, is_active)
 * @param lines     production_lines (id, name, section, parent_line_name, cost_center, is_active)
 * @param divisions org_divisions (code, label, icon, sort_order) — ว่างได้
 * @param costCenters ทะเบียน cost_centers (code, name, is_active) — ว่างได้ (ใช้แค่ "ชื่อ" ของรหัส)
 */
export function buildOrgScope({ nodes = [], lines = [], divisions = [], costCenters = [] } = {}) {
  const ccName = new Map((costCenters || [])
    .filter(c => c && c.code && c.is_active !== false)
    .map(c => [String(c.code), (c.name || '').trim()]));
  const act = nodes.filter(n => n && n.is_active !== false);
  const byId = new Map(act.map(n => [String(n.id), n]));
  const kids = new Map();
  act.forEach((n) => {
    const p = n.parent_id == null ? '' : String(n.parent_id);
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  });
  const bySort = (a, b) => ((a.sort_order ?? 9999) - (b.sort_order ?? 9999)) || String(nodeCode(a)).localeCompare(String(nodeCode(b)));
  kids.forEach(arr => arr.sort(bySort));

  const liveLines = lines.filter(l => l && l.name && l.is_active !== false);
  const lineById = new Map(liveLines.map(l => [String(l.id), l]));
  const byName = new Map(liveLines.map(l => [l.name, l]));
  const hasKids = (nm) => liveLines.some(l => l.parent_line_name === nm);
  /* กลุ่มไลน์ = "ราก" ของครอบครัว (ไต่ parent_line_name ขึ้นจนสุด · กันวน 6 ชั้น) — ทะเบียนจริง 2 ชั้น
     แต่ harness/โรงงานอื่นอาจ 3 ชั้น ⇒ ไลน์กลางไม่ถูกนับเป็นกลุ่มซ้อนกลุ่ม */
  const groupOf = (l) => {
    let cur = l;
    for (let i = 0; cur && cur.parent_line_name && i < 6; i++) cur = byName.get(cur.parent_line_name) || { name: cur.parent_line_name };
    return cur ? cur.name : l.name;
  };
  const familyOf = (grp) => liveLines.filter(l => l.name === grp || groupOf(l) === grp).map(l => l.name);
  /* ไลน์ที่โชว์เป็น "ไลน์" ใต้กลุ่ม = ทุกตัวในครอบครัวที่ไม่ใช่รากและไม่มีลูกเอง (ไลน์กลางที่มีลูก = แสดงผ่านลูกของมัน) */
  const leavesOf = (grp) => liveLines.filter(l => l.name !== grp && groupOf(l) === grp && !hasKids(l.name)).map(l => l.name).sort();

  // ฝ่ายของ node = ป้ายตัวเอง หรือตกทอดจากแม่ (กัน loop 10 ชั้น)
  const divisionOf = (n) => {
    let cur = n;
    for (let i = 0; cur && i < 10; i++) {
      if (cur.division) return cur.division;
      cur = cur.parent_id == null ? null : byId.get(String(cur.parent_id));
    }
    return null;
  };

  const opts = [];          // ตัวเลือกเรียงตามต้นไม้ (depth-first)
  const parentOf = new Map(); // key → parent key
  const linesOf = new Map();  // key → Set(ชื่อไลน์)
  const labelOfKey = new Map();
  const sectionOfKey = new Map();
  const seen = new Set();

  const push = (kind, value, label, depth, parentKey, lineSet, meta = {}) => {
    const k = scopeKey(kind, value);
    if (seen.has(k)) { // node ซ้ำ (เช่น 2 org line node ชี้ไลน์เดียวกัน) — รวมไลน์ ไม่เพิ่มตัวเลือกซ้ำ
      lineSet.forEach(x => linesOf.get(k).add(x));
      return k;
    }
    seen.add(k);
    opts.push({ key: k, kind, value, label, depth, parentKey, ...meta });
    parentOf.set(k, parentKey);
    linesOf.set(k, new Set(lineSet));
    labelOfKey.set(k, label);
    return k;
  };

  // ── ราก ──
  push('plant', '', SCOPE_KIND_META.plant.label, 0, null, liveLines.map(l => l.name));

  // ── ฝ่าย (ป้าย ไม่ใช่ node) ──
  const divList = (divisions && divisions.length ? divisions : [])
    .slice().sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  const topNodes = (kids.get('') || []).filter(n => n.kind === 'section' || n.kind === 'department');
  const divCodes = [...new Set([...divList.map(d => d.code), ...topNodes.map(divisionOf).filter(Boolean)])];
  const divLabel = (code) => divList.find(d => d.code === code)?.label || code;
  const divIcon = (code) => divList.find(d => d.code === code)?.icon || '🏢';

  const usedLine = new Set();     // ไลน์ที่ถูกวางในต้นไม้แล้ว (ผ่าน org line node หรือ section)
  const secKeys = new Map();      // norm(section) → key ของ section

  // ไลน์ใต้ department: org line node → production line → กลุ่มไลน์ทั้งครอบครัว
  const placeDepartment = (dep, parentKey, depth, secCode) => {
    const dKey = scopeKey('department', nodeCode(dep));
    const lineNodes = (kids.get(String(dep.id)) || []).filter(n => n.kind === 'line');
    const groups = new Map(); // grp → true
    const orphanNodes = [];   // org line node ที่ไม่ผูก production line (เช่น Store Raw Material)
    lineNodes.forEach((ln) => {
      const pl = ln.ref_line_id == null ? null : lineById.get(String(ln.ref_line_id));
      if (pl) groups.set(groupOf(pl), true); else orphanNodes.push(ln);
    });
    const all = new Set();
    groups.forEach((_, grp) => familyOf(grp).forEach(x => all.add(x)));
    push('department', nodeCode(dep), nodeCode(dep), depth, parentKey, all, { cost_center: dep.cost_center || null });
    if (secCode) sectionOfKey.set(dKey, secCode);
    [...groups.keys()].sort().forEach((grp) => {
      const fam = familyOf(grp);
      fam.forEach(x => usedLine.add(x));
      const gKey = push('line_group', grp, grp, depth + 1, dKey, fam);
      if (secCode) sectionOfKey.set(gKey, secCode);
      leavesOf(grp).forEach((nm) => {
        const lk = push('line', nm, nm, depth + 2, gKey, [nm], { cost_center: byName.get(nm)?.cost_center || null });
        if (secCode) sectionOfKey.set(lk, secCode);
      });
    });
    orphanNodes.sort(bySort).forEach((ln) => {
      const lk = push('line', nodeCode(ln), nodeCode(ln), depth + 1, dKey, [], { noData: true, cost_center: ln.cost_center || null });
      if (secCode) sectionOfKey.set(lk, secCode);
    });
    return dKey;
  };

  const placeSection = (sec, parentKey, depth) => {
    const code = nodeCode(sec);
    const secLines = liveLines.filter(l => norm(l.section) === norm(code)).map(l => l.name);
    const sKey = push('section', code, code, depth, parentKey, secLines, { cost_center: sec.cost_center || null });
    sectionOfKey.set(sKey, code);
    secKeys.set(norm(code), sKey);
    (kids.get(String(sec.id)) || []).filter(n => n.kind === 'department')
      .forEach(dep => placeDepartment(dep, sKey, depth + 1, code));
    // 🔴 ไลน์ในส่วนงานที่ผังยังไม่ผูกกับแผนกไหน → วางใต้ส่วนงานตรงๆ (ห้ามหาย)
    const loose = secLines.filter(x => !usedLine.has(x));
    const grps = [...new Set(loose.map(nm => groupOf(byName.get(nm))))].sort();
    grps.forEach((grp) => {
      const fam = familyOf(grp).filter(x => !usedLine.has(x));
      fam.forEach(x => usedLine.add(x));
      const gKey = push('line_group', grp, grp, depth + 1, sKey, fam, { unlinked: true });
      sectionOfKey.set(gKey, code);
      leavesOf(grp).filter(nm => fam.includes(nm)).forEach((nm) => {
        const lk = push('line', nm, nm, depth + 2, gKey, [nm], { cost_center: byName.get(nm)?.cost_center || null });
        sectionOfKey.set(lk, code);
      });
    });
    return sKey;
  };

  const placeTop = (n, parentKey, depth) => (n.kind === 'section'
    ? placeSection(n, parentKey, depth)
    : placeDepartment(n, parentKey, depth, null));

  divCodes.forEach((dc) => {
    const mine = topNodes.filter(n => divisionOf(n) === dc);
    if (!mine.length) return;
    const dKey = push('division', dc, divLabel(dc), 1, 'plant', [], { icon: divIcon(dc) });
    mine.forEach(n => placeTop(n, dKey, 2));
    // ฝ่ายครอบทุกไลน์ของลูก
    mine.forEach(n => linesOf.get(scopeKey(n.kind, nodeCode(n)))?.forEach(x => linesOf.get(dKey).add(x)));
  });
  const noDiv = topNodes.filter(n => !divisionOf(n));
  noDiv.forEach(n => placeTop(n, 'plant', 1));   // ยังไม่ติดป้ายฝ่าย = อยู่ใต้โรงงานตรงๆ (ห้ามซ่อน)

  // ส่วนงานที่มีแต่ในทะเบียนไลน์ ไม่มีในผัง (โรงงานใหม่ตอน rollout / ผังยังไม่ครบ) → ตะกร้ารับ
  const secInLines = [...new Set(liveLines.map(l => l.section).filter(Boolean))];
  secInLines.filter(s => !secKeys.has(norm(s))).sort().forEach((s) => {
    placeSection({ id: `virtual-${s}`, code: s, name: s }, 'plant', 1);
    const k = scopeKey('section', s);
    const o = opts.find(x => x.key === k); if (o) o.unlinked = true;
  });
  // ไลน์ที่ไม่มี section เลย → ตะกร้าท้ายสุด
  const noSec = liveLines.filter(l => !l.section && !usedLine.has(l.name));
  if (noSec.length) {
    const grps = [...new Set(noSec.map(groupOf))].sort();
    grps.forEach((grp) => {
      const fam = familyOf(grp);
      const gKey = push('line_group', grp, grp, 1, 'plant', fam, { unlinked: true });
      leavesOf(grp).forEach(nm => push('line', nm, nm, 2, gKey, [nm], { cost_center: byName.get(nm)?.cost_center || null }));
    });
  }

  // ── แกน cost center (คนละสายกับไลน์ · ancestors = plant เท่านั้น) ──
  const ccLines = new Map();
  const addCc = (cc, names) => { if (!cc) return; if (!ccLines.has(cc)) ccLines.set(cc, new Set()); names.forEach(x => ccLines.get(cc).add(x)); };
  liveLines.forEach(l => addCc(l.cost_center, [l.name]));
  act.forEach((n) => {
    if (!n.cost_center) return;
    const k = scopeKey(n.kind === 'line' ? 'line' : n.kind, nodeCode(n));
    addCc(n.cost_center, linesOf.get(k) ? [...linesOf.get(k)] : []);
  });
  /* 🔴 cost center ของ "กลุ่มไลน์" — ไล่ 3 ชั้นตามลำดับ ห้ามข้าม:
       1. แถวไลน์แม่เองมีรหัส → ใช้รหัสนั้น (ไลน์แม่ก็เป็นแถวใน production_lines และมีรหัสของมันเอง)
       2. ไม่มี → ถ้าลูกทั้งครอบครัวเหลือรหัสเดียว ถือเป็นของกลุ่ม
       3. ลูกใช้คนละรหัส → `cc_multi` **ห้ามหยิบรหัสใดรหัสหนึ่งมาเป็นของกลุ่ม** (จอต้องเขียนว่ามีหลายรหัส) */
  opts.filter(o => o.kind === 'line_group').forEach((o) => {
    const own = byName.get(o.value)?.cost_center || null;
    if (own) { o.cost_center = own; return; }
    const set = new Set([...(linesOf.get(o.key) || [])].map(nm => byName.get(nm)?.cost_center).filter(Boolean));
    if (set.size === 1) o.cost_center = [...set][0];
    else if (set.size > 1) { o.cost_center = null; o.cc_multi = set.size; }
  });

  /* ── แผนที่ 2 ทาง ระหว่าง "หน่วยในผัง" กับ "รหัส cost center" (23/09 · คำสั่ง user
     *"อย่าปนกัน cost center แยกอีกช่อง · เลือก PD4 ควรโชว์รหัส · พิมพ์รหัสควรเจอ PD3"*)
     เจ้าของรหัส = หน่วยที่ **กว้างที่สุด** ที่ผูกรหัสนั้น (ส่วนงาน ชนะ แผนก ชนะ กลุ่ม ชนะ ไลน์)
     — รหัสระดับส่วนงานจะได้คำตอบเป็นส่วนงาน ไม่ใช่ไลน์ลูกตัวใดตัวหนึ่ง
     ⚠️ 1 รหัสผูกได้หลายหน่วย (ข้อมูลจริงมีซ้ำ) ⇒ เก็บทั้งหมด จอเลือกจะได้เตือนได้ */
  const OWNER_RANK = { section: 0, department: 1, line_group: 2, line: 3 };
  const ccOwners = new Map();   // cc → [{ kind, value }] เรียงจากกว้างไปแคบ
  opts.forEach((o) => {
    if (!o.cost_center || o.kind === 'cost_center') return;
    if (!ccOwners.has(o.cost_center)) ccOwners.set(o.cost_center, []);
    ccOwners.get(o.cost_center).push({ kind: o.kind, value: o.value });
  });
  ccOwners.forEach(arr => arr.sort((a, b) => (OWNER_RANK[a.kind] ?? 9) - (OWNER_RANK[b.kind] ?? 9)));

  [...ccLines.keys()].sort().forEach(cc => push('cost_center', cc, cc, 1, 'plant', [...ccLines.get(cc)], {
    icon: '💰', cc_name: ccName.get(cc) || '', owners: ccOwners.get(cc) || [],
  }));

  // ── API ──
  const lineNamesOf = (kind, value) => [...(linesOf.get(scopeKey(kind, value)) || [])];
  const ancestorsOf = (kind, value) => {
    const out = [];
    let k = parentOf.get(scopeKey(kind, value));
    for (let i = 0; k && i < 12; i++) { out.unshift(parseScopeKey(k)); k = parentOf.get(k); }
    if (!out.length && !isPlant({ kind, value })) out.unshift({ ...PLANT });
    return out;
  };
  const sectionOf = (kind, value) => {
    if (kind === 'section') return value;
    return sectionOfKey.get(scopeKey(kind, value)) || null;
  };
  const sectionsOf = (kind, value) => {
    if (isPlant({ kind, value })) return null;   // null = ไม่จำกัด
    const own = sectionOf(kind, value);
    if (own) return new Set([own]);
    const k = scopeKey(kind, value);
    const set = new Set();
    opts.forEach((o) => { if (o.kind === 'section' && ancestorsOf(o.kind, o.value).some(a => scopeKey(a.kind, a.value) === k)) set.add(o.value); });
    return set;
  };
  const labelOf = (kind, value) => {
    if (isPlant({ kind, value })) return SCOPE_KIND_META.plant.label;
    const m = SCOPE_KIND_META[kind];
    return `${m ? m.short : kind}: ${labelOfKey.get(scopeKey(kind, value)) || value}`;
  };
  const pathOf = (kind, value) => ancestorsOf(kind, value).filter(a => !isPlant(a) && a.kind !== 'division')
    .map(a => labelOfKey.get(scopeKey(a.kind, a.value)) || a.value);
  const has = (kind, value) => seen.has(scopeKey(kind, value));
  const childrenOf = (kind, value) => {
    const k = scopeKey(kind, value);
    return opts.filter(o => o.parentKey === k);
  };
  const optionOf = (kind, value) => opts.find(o => o.key === scopeKey(kind, value)) || null;

  /** รหัส cost center ของหน่วยในผัง — `{ code, multi }` · multi = ลูกใช้หลายรหัส (code เป็น null) */
  const ccOf = (kind, value) => {
    const o = optionOf(kind, value);
    if (!o) return { code: null, multi: 0 };
    return { code: o.cost_center || null, multi: o.cc_multi || 0 };
  };
  /** หน่วยในผังที่ผูกรหัสนี้ (กว้าง → แคบ) — ว่าง = รหัสนี้ไม่มีใครในผังอ้างถึง */
  const ccOwnersOf = (cc) => (ccOwners.get(String(cc || '')) || []).slice();
  /** ป้ายรหัส: `2140462000 · PD3` (ชื่อมาจากทะเบียน cost_centers ไม่ใช่เดาจากผัง) */
  const ccLabel = (cc) => {
    const code = String(cc || '');
    const nm = ccName.get(code) || '';
    return nm ? `${code} · ${nm}` : code;
  };

  return { options: opts, lineNamesOf, ancestorsOf, sectionOf, sectionsOf, labelOf, pathOf, has, childrenOf, optionOf, ccOf, ccOwnersOf, ccLabel };
}

/** ขอบเขต `def` (นิยาม KPI) ครอบขอบเขตที่เลือกอยู่ไหม — เท่ากัน หรือเป็นบรรพบุรุษ (นิยามระดับแม่ตกทอดถึงลูก) */
export function scopeCovers(index, defScope, selected) {
  if (isPlant(defScope)) return true;
  if (isPlant(selected)) return false;
  if (defScope.kind === selected.kind && defScope.value === selected.value) return true;
  return index.ancestorsOf(selected.kind, selected.value)
    .some(a => a.kind === defScope.kind && a.value === defScope.value);
}
export const sameScope = (a, b) => (isPlant(a) && isPlant(b)) || (!!a && !!b && a.kind === b.kind && a.value === b.value);

/** ขอบเขตของแถว kpi_definitions (รองรับแถวเก่าที่มีแต่ section/line_group) */
export function scopeOfDef(d) {
  if (!d) return { ...PLANT };
  if (d.scope_kind && d.scope_kind !== 'plant' && d.scope_value) return { kind: d.scope_kind, value: d.scope_value };
  if (d.line_group) return { kind: 'line_group', value: d.line_group };
  if (d.section) return { kind: 'section', value: d.section };
  return { ...PLANT };
}

/** คอลัมน์ที่ต้องเขียนลง kpi_definitions สำหรับขอบเขตหนึ่ง — เขียน `section` เผื่อจอเก่าที่ยังกรองด้วย section
 *  (trigger `fn_kpi_def_scope_sync` เติม line_group ให้เองเมื่อ kind = line_group) */
export function defScopeColumns(index, sc) {
  if (isPlant(sc)) return { scope_kind: 'plant', scope_value: null, section: null, line_group: null };
  return {
    scope_kind: sc.kind, scope_value: sc.value,
    section: index ? index.sectionOf(sc.kind, sc.value) : (sc.kind === 'section' ? sc.value : null),
    line_group: sc.kind === 'line_group' ? sc.value : null,
  };
}

/**
 * ตัดตัวเลือกให้เหลือเฉพาะที่อยู่ในขอบเขตของ user
 * @param scopeSet Set(ชื่อไลน์ที่ user เห็น) | null = ไม่จำกัด
 * @param sections ส่วนงานที่ user สังกัด ([] = ไม่จำกัด) — ใช้กับ node ที่ไม่มีไลน์ (แผนกช่าง/สโตร์)
 */
export function filterScopeOptions(index, { scopeSet = null, sections = [], withCostCenter = true } = {}) {
  const opts = withCostCenter ? index.options : index.options.filter(o => o.kind !== 'cost_center');
  const secLimited = !!(sections && sections.length);
  if (!scopeSet && !secLimited) return opts;
  const secAllowed = (s) => !secLimited || sections.some(x => norm(x) === norm(s));
  const okBySection = (o) => {
    if (o.kind === 'plant') return true;
    const s = index.sectionOf(o.kind, o.value);
    if (s) return secAllowed(s);
    if (!secLimited) return true;
    // ฝ่าย = ผ่านถ้ามีส่วนงานลูกที่ผ่าน (ไม่งั้นเลือกทางขึ้นไม่ได้) · แผนกขึ้นตรงฝ่าย/CC = นอกสังกัด
    if (o.kind === 'division') return opts.some(c => c.kind === 'section' && c.parentKey === o.key && secAllowed(c.value));
    return false;
  };
  return opts.filter((o) => {
    if (!okBySection(o)) return false;
    const names = index.lineNamesOf(o.kind, o.value);
    if (scopeSet && names.length && !names.some(n => scopeSet.has(n))) return false;
    return true;
  });
}
