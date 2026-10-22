/**
 * orgChartPrint — พิมพ์ "แผนผังองค์กร" ตามฟอร์มจริงของ HR  (2026-10-22 · คำขอ user)
 *
 * ที่มา: user ส่งใบจริง 2 ใบมาแล้วสั่ง *"อยากให้ export ออกมาในรูปแบบ ผัง organize แบบนี้ได้
 * ทั้งผังใหญ่โรงงาน และผังย่อยแผนก"*
 *   · ORG-001 TSAT4 Overall Rev.09 — ผังใหญ่: ฝ่าย → ส่วน → แผนก
 *   · ORG-015 TSAT4 HDF Rev.07     — ผังย่อย: ฝ่าย → ส่วน → แผนก → กลุ่ม + รายชื่อในกล่องกลุ่ม
 * ทั้งสองใบเป็นฟอร์มเดียวกัน FM-HRM-I-001(03) ต่างกันแค่ "ลึกแค่ไหน + ขอบเขตไหน"
 *
 * 🔴 กฎที่ยึดในไฟล์นี้
 *   · เลขฟอร์ม/Rev/ช่องเซ็น/โลโก้ อ่านจากทะเบียน `doc_forms` (doc_key `org_chart`) **ห้าม hardcode**
 *     — fallback = ค่าที่อ่านจากใบจริง ⇒ ทะเบียนล่มก็ยังพิมพ์ได้เหมือนเดิม
 *   · **ทีมไม่ใช่ชั้นในผังองค์กร** (คำสั่ง user 22/10) ⇒ `ORG_KINDS` ตัดออกเหมือนมุมมองผัง
 *   · ลำดับชั้นมาจาก `parent_id` เท่านั้น · ฝ่ายมาจากป้าย `division` ที่ตกทอดลงลูก
 *     (`divisionOfNode` — ผังไม่มี node ชั้นฝ่ายโดยตั้งใจ ดู utils/orgDivisions.js)
 *   · 🔴 กฎความซื่อสัตย์ของใบ: หน่วยที่ยังไม่มีหัวหน้าในระบบ = เว้น "—" + เขียนท้ายใบว่าขาดกี่หน่วย
 *     ห้ามเดาชื่อ · คนที่ไม่มีระดับ (grade) ต้องมีแถว "ไม่ระบุระดับ" ในตารางอัตรากำลัง ห้ามตัดทิ้ง
 */
import { supabase } from '../supabaseClient';
import { getDocForm, fullCode, sigAt } from '../utils/docForms';
import { divisionOfNode, divisionsSync } from '../utils/orgDivisions';
import { buildCcIndex } from '../utils/ccScope';
import { orgNodeCompare } from '../utils/listOrder';
import tsLogoUrl from '../assets/TS logo.png';

/** ชั้นที่เป็น "องค์กรจริง" — ต้องตรงกับ ORG_KINDS ใน components/OrgTreeView.jsx */
const ORG_KINDS = ['section', 'department', 'line'];
const KIND_TH = { section: 'ส่วน', department: 'แผนก', line: 'กลุ่ม' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function urlToDataUrl(url) {
  if (!url) return '';
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve('');
      fr.readAsDataURL(blob);
    });
  } catch { return ''; }
}

/* ── ข้อมูลที่ใบนี้ต้องใช้ — เลือกเฉพาะคอลัมน์ที่วาดจริง (กฎ egress ข้อ 11) ───────── */
async function loadChartData() {
  const [asg, emp, prof] = await Promise.all([
    supabase.from('org_assignments').select('profile_id, org_node_id, kind, ends_on'),
    supabase.from('employees').select('org_node_id, name, position, grade, staff_kind').eq('is_active', true),
    supabase.from('profiles').select('id, full_name, position'),
  ]);
  return {
    assignments: asg.data || null,     // null = อ่านไม่ได้ (ใบต้องเขียนบอก ห้ามเงียบ)
    employees: emp.data || null,
    profiles: prof.data || null,
    failed: [asg.error && 'ผู้รับผิดชอบหน่วย', emp.error && 'พนักงาน', prof.error && 'บัญชีผู้ใช้'].filter(Boolean),
  };
}

/** หัวหน้าหน่วย + รักษาการ จาก org_assignments (แถวที่ยังไม่สิ้นสุด) */
function buildHeadIndex(assignments, profiles) {
  const byProfile = new Map((profiles || []).map(p => [p.id, p]));
  const m = new Map();   // nodeId → { head, acting }
  (assignments || []).forEach(a => {
    if (a.ends_on) return;
    const p = byProfile.get(a.profile_id);
    if (!p) return;
    const cur = m.get(a.org_node_id) || {};
    cur[a.kind === 'acting' ? 'acting' : 'head'] = { name: p.full_name || '', position: p.position || '' };
    m.set(a.org_node_id, cur);
  });
  return m;
}

/* ── ตารางอัตรากำลัง (มุมขวาล่างของใบจริง: ตำแหน่ง | ระดับ | อัตรากำลัง | รวม) ───── */
const NO_GRADE = '— ไม่ระบุระดับ —';
function manpowerRows(emps) {
  const m = new Map();
  emps.forEach(e => {
    const pos = String(e.position || '').trim() || '— ไม่ระบุตำแหน่ง —';
    const gr = String(e.grade || '').trim() || NO_GRADE;
    const k = `${pos}\u0000${gr}`;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return [...m.entries()]
    .map(([k, n]) => { const [pos, grade] = k.split('\u0000'); return { pos, grade, n }; })
    .sort((a, b) => b.n - a.n || a.pos.localeCompare(b.pos, 'th'));
}

/* ── ตัวช่วยเดินผัง ────────────────────────────────────────────────────────────── */
function childIndex(nodes) {
  const m = new Map();
  nodes.forEach(n => {
    const k = n.parent_id || '__root__';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(n);
  });
  m.forEach(arr => arr.sort(orgNodeCompare));
  return m;
}
/** ทุก node ในสายของ root (รวม root) */
function subtreeIds(rootId, kids) {
  const out = new Set([rootId]);
  const walk = (id, d) => {
    if (d > 10) return;
    (kids.get(id) || []).forEach(c => { out.add(c.id); walk(c.id, d + 1); });
  };
  walk(rootId, 0);
  return out;
}

/* ── ชิ้นส่วนใบ ───────────────────────────────────────────────────────────────── */
function boxHtml(n, { heads, ccIdx, empByNode, withRoster }) {
  const h = heads.get(n.id) || {};
  const cc = ccIdx.ccOfNode(n.id);
  const who = h.head || h.acting;
  const actingMark = !h.head && h.acting ? '*' : '';
  const roster = withRoster ? (empByNode.get(n.id) || []) : [];
  const rosterHtml = roster.length
    ? `<div class="roster">${roster.map(e =>
        `<div>${esc(e.position || 'พนักงาน')}${e.grade ? ` (${esc(e.grade)})` : ''} · ${esc(e.name)}</div>`).join('')}</div>`
    : '';
  return `<div class="box k-${n.kind}">
    <div class="bname">${esc(n.name)}</div>
    ${cc?.cc ? `<div class="bcc">Cost ${esc(cc.cc)}${cc.from && cc.from.id !== n.id ? ' *ตกทอด' : ''}</div>` : '<div class="bcc none">ไม่มีรหัส Cost Center</div>'}
    <div class="bwho">${who ? `${esc(who.name)}${actingMark}` : '—'}</div>
    <div class="bpos">${who ? esc(who.position || '') : 'ยังไม่ได้ระบุผู้รับผิดชอบ'}</div>
    ${rosterHtml}
  </div>`;
}

/** วาดแถวของชั้นหนึ่ง (band) — ใบจริงเรียงเป็นแถบตามชั้น ไม่ใช่ต้นไม้เยื้อง */
function bandHtml(label, nodesOfBand, opts) {
  if (!nodesOfBand.length) return '';
  return `<div class="band">
    <div class="blabel">${esc(label)}</div>
    <div class="brow">${nodesOfBand.map(n => boxHtml(n, opts)).join('')}</div>
  </div>`;
}

/**
 * @param {object} p
 * @param {'overall'|'dept'} p.mode  overall = ทั้งโรงงาน (ฝ่าย→ส่วน→แผนก) · dept = เจาะหน่วยเดียวลงถึงกลุ่ม
 * @param {string}  [p.rootId]       mode='dept' → id ของส่วน/แผนกที่จะกาง
 * @param {Array}   p.nodes          org_nodes ทั้งหมด (ยังไม่กรองทีม)
 * @param {string}  [p.plantName]
 */
export async function printOrgChart({ mode = 'overall', rootId = null, nodes = [], plantName = 'TSAT Plant 4' }) {
  const df = await getDocForm('org_chart', {
    form_code: 'FM-HRM-I-001',
    rev: '03',
    title: 'แผนผังองค์กร',
    sig_blocks: ['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'],
    paper_size: 'A3',
    orientation: 'landscape',
  });

  const { assignments, employees, profiles, failed } = await loadChartData();
  const heads = buildHeadIndex(assignments, profiles);
  const org = nodes.filter(n => ORG_KINDS.includes(n.kind) && n.is_active !== false);
  const kids = childIndex(org);
  const ccIdx = buildCcIndex(nodes);

  /* ขอบเขตของใบ */
  const root = rootId ? org.find(n => n.id === rootId) : null;
  const scopeIds = root ? subtreeIds(root.id, kids) : null;
  const inScope = (n) => !scopeIds || scopeIds.has(n.id);
  const scoped = org.filter(inScope);

  /* คนในขอบเขต — ใช้ทั้งตารางอัตรากำลังและ roster ในกล่องกลุ่ม */
  const empByNode = new Map();
  const scopedEmps = [];
  (employees || []).forEach(e => {
    if (!e.org_node_id) return;
    if (scopeIds && !scopeIds.has(e.org_node_id)) return;
    scopedEmps.push(e);
    if (!empByNode.has(e.org_node_id)) empByNode.set(e.org_node_id, []);
    empByNode.get(e.org_node_id).push(e);
  });
  empByNode.forEach(arr => arr.sort((a, b) =>
    String(a.grade || 'zz').localeCompare(String(b.grade || 'zz')) || String(a.name).localeCompare(String(b.name), 'th')));
  const noNodeEmps = (employees || []).filter(e => !e.org_node_id).length;

  /* แถบตามชั้น */
  const deepest = mode === 'dept' ? 'line' : 'department';
  const bandKinds = ORG_KINDS.slice(0, ORG_KINDS.indexOf(deepest) + 1);
  const opts = { heads, ccIdx, empByNode, withRoster: mode === 'dept' };
  const bands = bandKinds
    .map(k => bandHtml(KIND_TH[k], scoped.filter(n => n.kind === k), { ...opts, withRoster: opts.withRoster && k === 'line' }))
    .join('');

  /* แถบฝ่าย — ฝ่ายไม่ใช่ node จึงสรุปจากป้ายที่ตกทอด */
  const divCodes = [...new Set(scoped.map(n => divisionOfNode(n.id, nodes)).filter(Boolean))];
  const divLabel = (c) => divisionsSync().find(d => d.code === c)?.label || c;
  const divBand = divCodes.length
    ? `<div class="band"><div class="blabel">ฝ่าย</div><div class="brow">${
        divCodes.map(c => `<div class="box k-division"><div class="bname">${esc(divLabel(c))}</div></div>`).join('')}</div></div>`
    : '';

  /* ตารางอัตรากำลัง */
  const mp = manpowerRows(scopedEmps);
  const mpTotal = scopedEmps.length;
  const mpHtml = `<table class="mp"><thead><tr><th>ตำแหน่ง</th><th>ระดับ</th><th class="num">อัตรากำลัง</th></tr></thead><tbody>
    ${mp.map(r => `<tr><td>${esc(r.pos)}</td><td>${esc(r.grade)}</td><td class="num">${r.n}</td></tr>`).join('')}
    <tr class="sum"><td colspan="2">รวม</td><td class="num">${mpTotal}</td></tr>
  </tbody></table>`;

  /* หมายเหตุ — ต้องบอกความจริงของข้อมูลเสมอ */
  const noHead = scoped.filter(n => !heads.get(n.id)).length;
  const notes = [
    '* = รักษาการ (ยังไม่มีผู้ดำรงตำแหน่งจริงในระบบ)',
    '*ตกทอด = หน่วยนี้ไม่ได้ตั้งรหัส Cost Center เอง ใช้ของหน่วยแม่',
    noHead > 0 && `⚠ ยังไม่ได้ระบุผู้รับผิดชอบ ${noHead} หน่วย — เติมได้ที่หน้า “แผนผังองค์กร → จัดการหน่วยงาน”`,
    !scopeIds && noNodeEmps > 0 && `⚠ พนักงาน ${noNodeEmps} คนยังไม่ได้ผูกกับหน่วยในผัง จึงไม่ถูกนับในตารางอัตรากำลัง`,
    failed.length > 0 && `⚠ อ่านข้อมูลไม่สำเร็จ: ${failed.join(' · ')} — ใบนี้ไม่ครบ`,
    'ทีม A/B/C ใช้จัดกะการทำงาน ไม่ใช่ชั้นในผังองค์กร จึงไม่แสดงในใบนี้',
  ].filter(Boolean);

  const logo = await urlToDataUrl(df.logo_url || tsLogoUrl);
  const code = fullCode(df);
  const scopeName = root ? `${KIND_TH[root.kind]} ${root.name}` : 'ทั้งโรงงาน';
  const today = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'long', day: 'numeric' });

  const sigHtml = (df.sig_blocks || []).map((label, i) => {
    const s = sigAt(df, i);
    return `<div class="sig"><div class="sline">${esc(s?.name || '')}</div>
      <div class="slabel">${esc(s?.label || label)}</div></div>`;
  }).join('');

  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>${esc(df.title)} — ${esc(scopeName)}</title>
<style>
  @page { size: ${df.paper_size || 'A3'} ${df.orientation || 'landscape'}; margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun','TH SarabunPSK',sans-serif; margin:0; color:#111; font-size:10pt; }
  .head { display:flex; align-items:flex-start; gap:10px; border-bottom:2px solid #111; padding-bottom:6px; }
  .head img { height:38px; }
  .htitle { flex:1; }
  .htitle h1 { margin:0; font-size:16pt; }
  .htitle .sub { font-size:10pt; color:#444; }
  .sigbox { display:flex; gap:10px; }
  .sig { width:86px; text-align:center; }
  .sline { height:28px; border-bottom:1px solid #111; font-size:9pt; display:flex; align-items:flex-end; justify-content:center; }
  .slabel { font-size:8.5pt; color:#333; margin-top:2px; }
  .band { margin-top:10px; }
  .blabel { font-size:9.5pt; font-weight:700; color:#fff; background:#0D3D14; display:inline-block; padding:1px 10px; border-radius:3px; }
  .brow { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
  .box { border:1px solid #111; border-radius:3px; padding:4px 6px; min-width:132px; max-width:210px; page-break-inside:avoid; }
  .k-division { background:#068734; color:#fff; border-color:#068734; }
  .k-section    { background:#eef5ff; }
  .k-department { background:#f1fbf3; }
  .k-line       { background:#fff8ec; }
  .bname { font-weight:700; font-size:10pt; }
  .bcc  { font-family:monospace; font-size:8.5pt; color:#333; }
  .bcc.none { color:#b45309; font-family:inherit; }
  .bwho { font-size:9.5pt; margin-top:2px; }
  .bpos { font-size:8.5pt; color:#444; }
  .roster { margin-top:3px; border-top:1px dashed #999; padding-top:2px; font-size:8pt; line-height:1.35; }
  .foot { display:flex; gap:14px; align-items:flex-start; margin-top:12px; border-top:1px solid #111; padding-top:6px; page-break-inside:avoid; }
  .notes { flex:1; font-size:8.5pt; line-height:1.6; }
  table.mp { border-collapse:collapse; font-size:8.5pt; }
  table.mp th, table.mp td { border:1px solid #111; padding:1px 6px; }
  table.mp th { background:#0D3D14; color:#fff; }
  table.mp .num { text-align:right; }
  table.mp .sum { font-weight:700; background:#f2f2f2; }
  .docfoot { display:flex; justify-content:space-between; font-size:8.5pt; color:#555; margin-top:6px; }
</style></head><body>
  <div class="head">
    ${logo ? `<img src="${logo}" alt="">` : ''}
    <div class="htitle">
      <h1>${esc(df.title)}</h1>
      <div class="sub">${esc(plantName)} · ขอบเขต: <b>${esc(scopeName)}</b> · พิมพ์ ${esc(today)}</div>
    </div>
    <div class="sigbox">${sigHtml}</div>
  </div>
  ${divBand}${bands}
  <div class="foot">
    <div class="notes">${notes.map(t => `<div>${esc(t)}</div>`).join('')}</div>
    <div>${mpHtml}</div>
  </div>
  <div class="docfoot"><span>${esc(df.footer_note || '')}</span>
    <span>${esc(code)}${df.effective_date ? ` · Effective: ${esc(df.effective_date)}` : ''}</span></div>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}
