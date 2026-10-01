/* ═══ 📥 นำเข้า BOM จาก SAP — Display Multilevel BOM / BOM & Routing Report (2026-10-01 · คำสั่ง user) ═══
   user: *"หน้าที่เราแคพจาก SAP มา กับ export ออกมา อยากให้มีระบบ import เข้าไปเลย
          และแตกให้ได้ข้อมูลตรงกับ SAP ... ระบบไป map part master มาให้ครบ ทำขั้นให้ถูก"*

   🔴 ไฟล์ที่ SAP คายออกมา **ไม่ใช่ .xls จริง** — เป็น **TSV เข้ารหัส UTF-16LE** ที่ตั้งนามสกุล .xls
      (ตรวจแล้วกับไฟล์จริง 01/10: 6,788 bytes · BOM `FF FE` · CRLF) ⇒ อ่านด้วย TextDecoder('utf-16le')
      **ห้ามใช้ไลบรารี xlsx กับไฟล์นี้** (จะพังหรือได้ขยะ) — ตัว sniff อยู่ที่ `decodeSapExport()`

   🔴 "ชั้น" ของ SAP มาเป็น **จุดนำหน้าตัวเลข** (`.1` `..2` `.....5`) ไม่ใช่คอลัมน์ parent ⇒
      parent = แถวก่อนหน้าที่ลึกน้อยกว่า 1 ชั้น (stack) — แปลงเป็น `bom_items.parent_mat` ของ ESM
      **ชั้นเดียวกับที่ `buildBomIndex()` ใช้** (ห้ามประกอบต้นไม้เอง ดู utils/bomTree.js)

   🔴 Quantity ของ SAP = **ต่อ 1 หน่วยของตัวแม่** (ไม่ใช่ต่อ 1 FG) — ตรงกับ `qty_per_unit` ของ ESM พอดี
      ⇒ **ห้ามคูณสะสมตอนนำเข้า** (จอ BOM คูณ "ต่อ 1 FG" ให้เองตอนกาง)

   รองรับ 2 เลย์เอาต์ที่ user ใช้จริง — จับจาก **หัวตาราง** ไม่ใช่ตำแหน่งคอลัมน์ตายตัว:
     A) Display Multilevel BOM : Plnt·SPT·Item·Level·Obj·Object description·Quantity·Un·CostRel·MS·SLoc·SLoc·…
     B) BOM & Routing Report   : Plant·Material No.·…·BOM Level·Component…·Component Quantity·…
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

const norm  = (s) => (s ?? '').toString().trim();
const upper = (s) => norm(s).toUpperCase();

/** ตัวเลขแบบ SAP: "  1.000" · "0.038" · "1,234.5" — คืน null เมื่อว่าง/ไม่ใช่ตัวเลข (ห้ามคืน 0) */
export function sapNum(v) {
  const s = norm(v).replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** ไฟล์ SAP = UTF-16LE มี BOM · เผื่อ UTF-8 ด้วย (บางเครื่อง export มาคนละแบบ) */
export function decodeSapExport(buf) {
  const b = new Uint8Array(buf);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  // ไม่มี BOM: ถ้าไบต์คี่เป็น 0 เยอะ = utf-16le ที่ไม่มี BOM
  let zeros = 0, n = Math.min(b.length, 200);
  for (let i = 1; i < n; i += 2) if (b[i] === 0) zeros++;
  if (n > 20 && zeros > n / 4) return new TextDecoder('utf-16le').decode(b);
  return new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');
}

/* ── หัวตาราง: map ชื่อคอลัมน์ → บทบาท (เทียบแบบ "ขึ้นต้นด้วย" กันช่องว่าง/จุดต่อท้าย) ── */
const HEAD = [
  ['level',   ['level', 'bom level', 'explosion level']],
  ['item',    ['item']],
  ['mat',     ['obj', 'component no', 'component', 'component material', 'material no']],
  ['desc',    ['object description', 'component material description', 'material description']],
  ['qty',     ['quantity', 'component quantity', 'qty']],
  ['uom',     ['un', 'component unit', 'component uom', 'uom']],
  ['plant',   ['plnt', 'plant']],
  ['spt',     ['spt', 's..']],
  ['costrel', ['costrelevncy', 'costrel']],
  ['mstat',   ['matlstatus', 'ms']],
  ['partno',  ['part number']],
  ['model',   ['model']],
  ['chgno',   ['change number', 'change no']],
];
const headRole = (cell) => {
  const c = upper(cell).toLowerCase().replace(/\.+$/, '').replace(/\s+/g, ' ');
  if (!c) return null;
  /* เทียบ 2 ทาง: หัวยาวกว่าคีย์ ("component no") และ **หัวที่ถูกย่อ** ("lev" ← "level")
     — SAP export บางใบย่อหัวคอลัมน์ ทำให้ `c.startsWith(k)` อย่างเดียวจับไม่ได้ (เคสจริง 01/10) */
  for (const [role, keys] of HEAD)
    if (keys.some(k => c === k || c.startsWith(k) || (c.length >= 3 && k.startsWith(c)))) return role;
  return c.startsWith('sloc') || c.startsWith('prod.sloc') || c.startsWith('stor') ? 'sloc' : null;
};

/* 🔎 หาคอลัมน์ "ชั้น" จาก **ค่าในข้อมูล** เมื่อหัวตารางบอกไม่ได้ (ชื่อหัวเพี้ยน/ถูกย่อ/ไฟล์ผ่าน Excel มา)
   ค่าชั้นของ SAP หน้าตาแน่นอนมาก: `.1` `..2` `.....5` — และถ้าไฟล์ผ่าน Excel มา `.1` จะกลายเป็น `0.1`
   ⇒ สแกนทุกคอลัมน์ เลือกตัวที่ค่าเข้ารูปนี้มากที่สุด (ต้องเกินครึ่งของแถวที่มีค่า) */
const LEVEL_VALUE = /^0?\.{1,9}\d{0,2}$|^\.{1,9}$/;
export function sniffLevelCol(dataRows) {
  const width = Math.max(0, ...dataRows.map(r => r.length));
  let best = -1, bestHit = 0;
  for (let c = 0; c < width; c++) {
    let hit = 0, seen = 0;
    dataRows.forEach(r => { const v = norm(r[c]); if (!v) return; seen++; if (LEVEL_VALUE.test(v)) hit++; });
    if (seen && hit > seen / 2 && hit > bestHit) { best = c; bestHit = hit; }
  }
  return best < 0 ? null : best;
}

/** depth จากคอลัมน์ Level: ".....5" → 5 · "5" → 5 · ".1" → 1 · ว่าง/อ่านไม่ออก → null */
export function sapDepth(level) {
  const s = norm(level);
  if (!s) return null;
  const m = s.match(/(\d+)\s*$/);
  if (m) return Number(m[1]);
  const dots = (s.match(/^\.+/) || [''])[0].length;   // บางเวอร์ชันมีแต่จุด ไม่มีเลข
  return dots || null;
}

/**
 * แกะไฟล์ SAP → โครงที่พร้อมลง `bom_items`
 * @returns {{root:object, rows:Array, warnings:string[], layout:string}}
 *   rows[] = { depth, item_no, mat_no, part_name, qty_per_unit, uom, parent_mat,
 *              prod_sloc, storage_location, plant, spt, cost_rel, mat_status, part_no, change_no }
 */
export function parseSapBom(text) {
  const lines = String(text || '').split(/\r?\n/);
  const warnings = [];
  const root = { mat_no: '', description: '', plant: '', base_qty: null };

  /* ① บล็อกหัวของ Display Multilevel BOM — "Material \t\t\t\t 10101158" */
  for (const ln of lines.slice(0, 12)) {
    const c = ln.split('\t').map(norm).filter(Boolean);
    if (c.length < 2) continue;
    const k = c[0].toLowerCase();
    if (k.startsWith('material') && !root.mat_no) root.mat_no = c[c.length - 1];
    else if (k.startsWith('description')) root.description = c[c.length - 1];
    else if (k.startsWith('plant')) root.plant = c[c.length - 1].split('/')[0].trim();
    else if (k.startsWith('base qty')) root.base_qty = sapNum(c[c.length - 1]);
  }

  /* ② หาแถวหัวตาราง = แถวที่ map บทบาทได้ครบทั้ง mat + qty (หรือ level) */
  let hi = -1, col = null;
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    if (cells.length < 4) continue;
    const m = {}; const slocs = [];
    cells.forEach((c, idx) => {
      const r = headRole(c);
      if (!r) return;
      if (r === 'sloc') { slocs.push(idx); return; }
      if (m[r] === undefined) m[r] = idx;
    });
    if (m.mat !== undefined && (m.qty !== undefined || m.level !== undefined)) {
      hi = i; col = { ...m, sloc1: slocs[0], sloc2: slocs[1] }; break;
    }
  }
  if (hi < 0) return { root, rows: [], warnings: ['หาแถวหัวตารางไม่เจอ — ไฟล์นี้อาจไม่ใช่ BOM ที่ export จาก SAP'], layout: 'unknown' };
  const layout = col.level !== undefined && col.spt !== undefined ? 'multilevel' : 'report';

  /* ③ เตรียมแถวข้อมูล แล้ว **ยืนยันคอลัมน์ชั้นด้วยค่าจริง** ก่อนเริ่มผูกต้นไม้
     🔴 เคสจริง 01/10: ไฟล์ของอีกใบหัวคอลัมน์ไม่ตรง ⇒ ชั้นอ่านไม่ออกทั้งใบ แล้วโค้ดเดิม
        **ยุบทุกแถวเป็นชั้น 1 เงียบๆ** = BOM แบนผิดโครง + ITEM ชนกันจนชน unique index
        ⇒ ตอนนี้: หาคอลัมน์ชั้นจากค่าจริงก่อน · หาไม่เจอ = **ไม่นำเข้า** ไม่ใช่เดาให้ */
  const body = [];
  for (let i = hi + 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    if (cells.length < 3) continue;
    if (!upper(cells[col.mat])) continue;
    body.push({ i, cells });
  }
  const levelOk = (ci) => ci !== undefined && ci !== null &&
    body.filter(b => sapDepth(b.cells[ci]) != null).length > body.length / 2;
  if (!levelOk(col.level)) {
    const sniff = sniffLevelCol(body.map(b => b.cells));
    if (levelOk(sniff)) {
      col.level = sniff;
      warnings.push(`หัวคอลัมน์ "ชั้น" ไม่ตรงรูปแบบที่รู้จัก — ใช้คอลัมน์ที่ ${sniff + 1} แทน (ดูจากค่าในไฟล์)`);
    } else {
      return { root, rows: [], layout, warnings: [
        'อ่านคอลัมน์ "ชั้น" (Level) ของไฟล์นี้ไม่ได้ — ไม่นำเข้าให้ เพราะถ้าเดาเป็นชั้น 1 ทั้งใบ โครง BOM จะผิด',
        'ไฟล์ที่ผ่าน Excel มาแล้วบันทึกทับ มักทำคอลัมน์นี้เพี้ยน — ให้ export จาก SAP ใหม่แล้วอัปโหลดไฟล์นั้นตรงๆ ห้ามเปิดแก้ใน Excel ก่อน',
      ] };
    }
  }

  const rows = [], stack = [];     // stack[d] = mat ของแถวล่าสุดที่ depth = d
  for (const { i, cells } of body) {
    const mat = upper(cells[col.mat]);
    if (root.mat_no && mat === upper(root.mat_no) && rows.length === 0) continue;   // แถว level 0 = ตัวหัวใบเอง

    const depth = sapDepth(cells[col.level]);
    if (depth == null) { warnings.push(`แถว ${i + 1} (${mat}) อ่านชั้นไม่ออก — ข้ามแถวนี้ (ห้ามเดาชั้นให้)`); continue; }

    const qty  = col.qty !== undefined ? sapNum(cells[col.qty]) : null;
    const s1   = col.sloc1 !== undefined ? upper(cells[col.sloc1]) : '';
    const s2   = col.sloc2 !== undefined ? upper(cells[col.sloc2]) : '';
    const parent = depth > 1 ? (stack[depth - 1] || null) : null;
    if (depth > 1 && !parent) warnings.push(`แถว ${i + 1} (${mat}) ชั้น ${depth} แต่ไม่มีตัวแม่ชั้น ${depth - 1} ก่อนหน้า — ผูกไว้ชั้นบนสุดแทน`);

    rows.push({
      depth,
      item_no: col.item !== undefined ? sapNum(cells[col.item]) : null,
      mat_no: mat,
      part_name: col.desc !== undefined ? norm(cells[col.desc]) : '',
      qty_per_unit: qty,
      uom: col.uom !== undefined ? upper(cells[col.uom]) : '',
      parent_mat: parent,
      prod_sloc: s1 || null,           // SAP "Prod.SLoc" — จุดที่ผลิตเบิกไปใช้
      storage_location: s2 || null,    // SAP "Stor. Loc." — ที่เก็บ (คอลัมน์เดิมของ ESM)
      plant: col.plant !== undefined ? norm(cells[col.plant]) : '',
      spt: col.spt !== undefined ? norm(cells[col.spt]) : '',
      cost_rel: col.costrel !== undefined ? norm(cells[col.costrel]) : '',
      mat_status: col.mstat !== undefined ? norm(cells[col.mstat]) : '',
      part_no: col.partno !== undefined ? norm(cells[col.partno]) : '',
      change_no: col.chgno !== undefined ? norm(cells[col.chgno]) : '',
    });
    stack[depth] = mat;
    stack.length = depth + 1;          // ตัดลูกของพี่คนก่อนทิ้ง ไม่งั้นชั้นลึกไปเกาะผิดตัว
  }

  if (!rows.length) warnings.push('ไม่พบบรรทัด component ในไฟล์');
  if (!root.mat_no && rows.length) warnings.push('ไฟล์ไม่ได้บอกเลข Material ของหัวใบ — ต้องเลือกใบปลายทางเอง');
  const noQty = rows.filter(r => r.qty_per_unit == null).length;
  if (noQty) warnings.push(`${noQty} แถวไม่มีจำนวน — ต้องเติมเองก่อนใช้คำนวณความต้องการวัตถุดิบ`);
  return { root, rows, warnings, layout };
}

/**
 * เทียบของใหม่จาก SAP กับของเดิมในใบ — คีย์ = (parent_mat, mat_no) ชุดเดียวกับ unique ของตาราง
 * @returns {{add:Array, update:Array, same:Array, extra:Array}}
 *   extra = แถวที่มีใน ESM แต่ไม่มีใน SAP (**ไม่ลบให้** — คนตัดสิน อาจเป็นชั้น OP ที่หน้างานเพิ่มเอง)
 */
export function diffSapBom(sapRows, existing, opts = {}) {
  const isOp = opts.isOpMat || (() => false);
  const key = (r) => `${upper(r.parent_mat) || '·'}|${upper(r.mat_no)}`;
  const cur = new Map((existing || []).map(r => [key(r), r]));
  const add = [], update = [], same = [];
  (sapRows || []).forEach(r => {
    const old = cur.get(key(r));
    if (!old) { add.push(r); return }
    const diffs = [];
    if (r.qty_per_unit != null && Number(old.qty_per_unit) !== Number(r.qty_per_unit)) diffs.push(`จำนวน ${old.qty_per_unit} → ${r.qty_per_unit}`);
    if (r.uom && upper(old.uom) !== r.uom) diffs.push(`หน่วย ${old.uom} → ${r.uom}`);
    if (r.item_no != null && Number(old.item_no) !== Number(r.item_no)) diffs.push(`ITEM ${old.item_no ?? '—'} → ${r.item_no}`);
    if (r.storage_location && upper(old.storage_location) !== r.storage_location) diffs.push(`คลัง ${old.storage_location || '—'} → ${r.storage_location}`);
    (diffs.length ? update : same).push({ ...r, id: old.id, diffs });
  });
  const seen = new Set((sapRows || []).map(key));
  const extra = (existing || []).filter(r => !seen.has(key(r)) && !isOp(r.mat_no));
  return { add, update, same, extra };
}

/** mat ที่ยังไม่มีในทะเบียนกลาง Parts Master — ต้องลงทะเบียนก่อน (step 1 ของ workflow) */
export function missingInPartsMaster(sapRows, pmMats) {
  const have = new Set([...(pmMats || [])].map(upper));
  const out = new Map();
  (sapRows || []).forEach(r => {
    if (have.has(upper(r.mat_no)) || out.has(upper(r.mat_no))) return;
    out.set(upper(r.mat_no), { mat_no: r.mat_no, part_name: r.part_name, uom: r.uom || 'PC', part_no: r.part_no || null });
  });
  return [...out.values()];
}
