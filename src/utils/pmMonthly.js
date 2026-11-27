/* ══════════════════════════════════════════════════════════════════════════════════════════
   📅 pmMonthly — ใบ PM ของช่าง สายอนุมัติ ขั้น ③④ + สรุปรายเดือน (2026-11-19 · คำสั่ง user)
   📄 docs/modules/pm-hub-check-setup.md §ใบ PM สายอนุมัติ 4 ขั้น — รอบ 2

   สาย (user 11/11): ① ผู้ตรวจสแกนบัตร → ② หัวหน้าผู้ตรวจยืนยันทีละใบ (`pmConfirmVerdict` · utils/amApproval.js)
     → **③ ผจก.ส่วนของผู้ตรวจ อนุมัติรายเดือน** (1 ลายเซ็น ต่อ ทีม × เดือน)
     → **④ ผจก.ส่วนที่ถูกตรวจ รับทราบรายเดือน** (1 ลายเซ็น ต่อ ทีม × ส่วนงานเจ้าของเครื่อง × เดือน)

   🔴 กฎที่ user ตัดสิน 19/11 (ห้ามผ่อนโดยไม่ถาม):
     1. **③ บล็อกจนใบทุกใบของเดือนผ่านขั้น ② ครบ** — ใบที่ยังรอ / ถูกตีกลับ = ยังไม่ครบ
     2. **ผู้มีสิทธิ์เซ็น = มอบหมายในผังองค์กร (`org_assignments`) ทั้ง `head` (หัวหน้า/ดูควบ) และ `acting` (รักษาการ)**
        ครอบโหนดเป้าหมาย **ตรงตัวหรือโหนดแม่ที่ตกทอดลงมา** (`unitChain`) · ตำแหน่งในโปรไฟล์ไม่ใช่ตัวตัดสิน
        — ผู้จัดการคนเดียวดูหลายแผนก = `head` หลายแถว · คนตำแหน่งต่ำกว่ารักษาการผู้จัดการ = `acting`
     3. ④ ทำได้หลัง ③ เซ็นแล้วเท่านั้น
   🔴 กฎของไฟล์ (หลักเดียวกับ AM รายเดือน · lib/amMonthlySignoff.js):
     · อ่านผัง/มอบหมายไม่ได้ = **ไม่ให้เซ็น** (`org_unreadable`) ห้ามเดาว่าครอบ
     · ทีมยังไม่ผูกโหนดผัง (`mtn_teams.org_node_id` ว่าง) / ส่วนงานหาโหนดไม่เจอ = บอกบนจอ ห้ามจับคู่ชื่อเดาเอง
     · บัญชีกลางเซ็นไม่ได้ · ผู้ตรวจใบใดใบหนึ่งของชุดนั้น เซ็นขั้น ③ ของชุดนั้นไม่ได้ (ตรวจเองอนุมัติเอง)
     · pure ล้วน (ไม่แตะ DB) — เทส `__tests__/pmMonthly.test.mjs` · `today` ต้องส่งเข้ามา (ด่าน +400 วัน)
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { unitChain, nodeMap } from './orgLayers.js';
import { isGranting } from './orgAssignments.js';

export const PM_SIGN_STEPS = Object.freeze({
  3: { step: 3, key: 'team_approve', label: 'ผจก.ส่วนของผู้ตรวจ อนุมัติ', short: 'อนุมัติ (③)' },
  4: { step: 4, key: 'area_ack', label: 'ผจก.ส่วนที่ถูกตรวจ รับทราบ', short: 'รับทราบ (④)' },
});
export const PM_REVOKE_REASON_MIN = 5;

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** ใบนี้ผ่านขั้น ② แล้วหรือยัง — `approved` เท่านั้น (pending / rejected / ว่าง = ยัง) */
export const isConfirmed = (insp) => insp?.approval_status === 'approved';

/**
 * สรุปใบ PM ของเดือน แยกตามทีม และ ทีม × ส่วนงานเจ้าของเครื่อง
 * @param {object[]} rows  ใบตรวจ `{ id, jig_id, status, approval_status, inspector_id, team }` (team = checklists.department)
 * @param {object}   ctx   `{ lineOfJig: Map|obj jig_id→line_name, sectionOfLine: (lineName)=>section|null }`
 * @returns {Map<team, { team, total, confirmed, waiting, rejected, ng, draft, machines:Set, inspectors:Set,
 *          sections: Map<section, { section, total, ng, machines:Set }>, noSection:number }>}
 */
export function summarizePmMonth(rows = [], { lineOfJig = new Map(), sectionOfLine = () => null } = {}) {
  const lineOf = (id) => (lineOfJig instanceof Map ? lineOfJig.get(id) : lineOfJig?.[id]) || null;
  const out = new Map();
  for (const r of rows || []) {
    if (!r?.team) continue;
    if (!out.has(r.team)) out.set(r.team, { team: r.team, total: 0, confirmed: 0, waiting: 0, rejected: 0, ng: 0, draft: 0,
      machines: new Set(), inspectors: new Set(), sections: new Map(), noSection: 0 });
    const t = out.get(r.team);
    t.total++;
    if (isConfirmed(r)) t.confirmed++;
    else if (r.approval_status === 'rejected') t.rejected++;
    else t.waiting++;
    if (r.status === 'fail') t.ng++;
    if (r.status === 'pending') t.draft++;
    if (r.jig_id != null) t.machines.add(r.jig_id);
    if (r.inspector_id) t.inspectors.add(String(r.inspector_id));
    const sec = sectionOfLine(lineOf(r.jig_id));
    if (!sec) { t.noSection++; continue; }
    if (!t.sections.has(sec)) t.sections.set(sec, { section: sec, total: 0, ng: 0, machines: new Set() });
    const s = t.sections.get(sec);
    s.total++;
    if (r.status === 'fail') s.ng++;
    if (r.jig_id != null) s.machines.add(r.jig_id);
  }
  return out;
}

/** ③ พร้อมเซ็นไหม — ต้องมีใบ และทุกใบผ่านขั้น ② (กฎข้อ 1) */
export const teamMonthReady = (t) => !!t && t.total > 0 && t.confirmed === t.total;

/**
 * โหนดผังของส่วนงาน (ชื่อ/รหัสในทะเบียนไลน์ → org_nodes kind section) — **ต้องเจอ 1 โหนดพอดี**
 * เจอ 0 หรือ >1 = null (ห้ามเดา · จอเขียนว่า "หาส่วนงานในผังไม่เจอ")
 */
export function sectionNodeIdOf(sectionName, nodes = []) {
  const k = norm(sectionName);
  if (!k) return null;
  const hits = (nodes || []).filter((n) => n && n.kind === 'section' && n.is_active !== false
    && (norm(n.code) === k || norm(n.name) === k));
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * บัญชีนี้ครอบโหนดเป้าหมายไหม — มอบหมายที่มีผล (`isGranting`) ที่อยู่บนสายจากเป้าหมายขึ้นไป (`unitChain`)
 * @returns `{ ok, via: { kind, nodeId }|null }`
 */
export function coversNode(assignments = [], targetNodeId, nodes = [], today) {
  if (targetNodeId == null) return { ok: false, via: null };
  const chain = unitChain(targetNodeId, nodeMap(nodes)).map((n) => String(n.id));
  if (!chain.length) return { ok: false, via: null };
  const live = (assignments || []).filter((a) => a && a.org_node_id != null && isGranting(a, today));
  // ใกล้เป้าหมายที่สุดชนะ (ตัวเองก่อนแม่) — ให้จอบอกได้ว่าได้สิทธิ์จากหน่วยไหน
  for (const id of chain) {
    const a = live.find((x) => String(x.org_node_id) === id);
    if (a) return { ok: true, via: { kind: a.kind, nodeId: a.org_node_id } };
  }
  return { ok: false, via: null };
}

/**
 * ตัดสินว่าเซ็นได้ไหม — **ต้องคิดใหม่ตอนกด** (ห้ามใช้ค่าที่คิดตอน render) แล้วส่งให้ตัวเขียน
 * @param {object} p
 * @param {3|4}    p.step
 * @param {boolean} p.permitted     ถือคีย์ของขั้นนั้น (`PERM_OF_STEP`: ③ pm:monthly_approve · ④ pm:monthly_ack)
 * @param {boolean} p.sharedAccount บัญชีกลาง
 * @param {boolean} p.orgReadable   อ่านผัง + มอบหมายได้ครบ
 * @param {*}       p.targetNodeId  โหนดผังที่ต้องครอบ (③ = โหนดทีม · ④ = โหนดส่วนงาน) · null = ยังไม่ผูก/หาไม่เจอ
 * @param {object}  p.cover         ผลของ `coversNode`
 * @param {object}  p.team          แถวจาก `summarizePmMonth`
 * @param {boolean} p.alreadySigned มีลายเซ็นที่มีผลของชุดนี้แล้ว
 * @param {boolean} [p.step3Signed] (④) ขั้น ③ ของทีม×เดือนนี้เซ็นแล้ว
 * @param {string}  [p.myUid]       (③) ใช้กันตรวจเองอนุมัติเอง
 */
export function pmMonthlySignVerdict({ step, permitted = false, sharedAccount = false, orgReadable = true,
  targetNodeId = null, cover = null, team = null, alreadySigned = false, step3Signed = false, myUid = null } = {}) {
  const R = (o) => ({ step, ...o });
  if (!PM_SIGN_STEPS[step]) return R({ ok: false, code: 'bad_step' });
  if (!permitted) return R({ ok: false, code: 'no_perm' });
  if (sharedAccount) return R({ ok: false, code: 'shared' });
  if (alreadySigned) return R({ ok: false, code: 'already' });
  if (!team || !team.total) return R({ ok: false, code: 'no_data' });
  if (step === 3 && !teamMonthReady(team)) {
    return R({ ok: false, code: 'not_ready', waiting: team.waiting, rejected: team.rejected });
  }
  if (step === 3 && myUid && team.inspectors?.has?.(String(myUid))) return R({ ok: false, code: 'self' });
  if (step === 4 && !step3Signed) return R({ ok: false, code: 'need_step3' });
  if (!orgReadable) return R({ ok: false, code: 'org_unreadable' });
  if (targetNodeId == null) return R({ ok: false, code: step === 3 ? 'team_unmapped' : 'section_unmapped' });
  if (!cover?.ok) return R({ ok: false, code: 'not_covered' });
  return R({ ok: true, code: 'ok', via: cover.via });
}

/** ข้อความบอกเหตุ — **ต้องบอกทางแก้ด้วย** (ENGINEERING-PRINCIPLES · ห้ามขึ้นแค่ "ไม่มีสิทธิ์") */
export function pmMonthlySignText(v, { teamLabel = '', section = '' } = {}) {
  if (!v || v.ok) return '';
  const st = PM_SIGN_STEPS[v.step] || null;
  switch (v.code) {
    case 'no_perm': return `บัญชีนี้ไม่มีสิทธิ์${v.step === 4 ? 'รับทราบ' : 'อนุมัติ'} PM รายเดือน (pm:${v.step === 4 ? 'monthly_ack' : 'monthly_approve'}) — ขอจากแอดมินที่หน้าจัดการสิทธิ์`;
    case 'shared': return 'บัญชีกลางลงนามไม่ได้ — ต้องล็อกอินด้วยบัญชีของตัวเอง';
    case 'already': return 'ชุดนี้ลงนามแล้ว — ต้องการแก้ ให้เพิกถอนก่อนแล้วลงนามใหม่';
    case 'no_data': return 'เดือนนี้ไม่มีใบตรวจ PM ของทีมนี้';
    case 'not_ready': return `ยังอนุมัติไม่ได้ — ใบตรวจยังไม่ผ่านขั้น ② (หัวหน้าผู้ตรวจยืนยัน) ${v.waiting || 0} ใบ`
      + (v.rejected ? ` · ถูกตีกลับ ${v.rejected} ใบ` : '') + ' · ไปยืนยันที่แท็บ "ตรวจอุปกรณ์" ก่อน';
    case 'self': return 'คุณเป็นผู้ตรวจใบในชุดนี้ — อนุมัติงานตรวจของตัวเองไม่ได้ ให้ผู้จัดการ/รักษาการคนอื่นอนุมัติ';
    case 'need_step3': return 'ยังรับทราบไม่ได้ — ผจก.ส่วนของผู้ตรวจยังไม่อนุมัติ (ขั้น ③)';
    case 'org_unreadable': return 'ยังลงนามไม่ได้ — อ่านผังองค์กร/การมอบหมายไม่สำเร็จ จึงตัดสินไม่ได้ว่าคุณดูแลหน่วยนี้ไหม · โหลดหน้าใหม่';
    case 'team_unmapped': return `ทีม ${teamLabel || ''} ยังไม่ได้ผูกกับหน่วยในผังองค์กร (mtn_teams.org_node_id) — แจ้งแอดมิน`;
    case 'section_unmapped': return `หาส่วนงาน "${section || '-'}" ในผังองค์กรไม่เจอ (หรือเจอซ้ำหลายหน่วย) — ตรวจทะเบียนไลน์/ผังที่ /org-setup`;
    case 'not_covered': return 'คุณไม่ได้เป็นหัวหน้า/รักษาการของหน่วยนี้ในผังองค์กร'
      + (st ? ` (${st.label})` : '') + ' — ถ้ารับผิดชอบจริง ให้แอดมินลงมอบหมายที่ /org-setup (ดูควบ = head · รักษาการ = acting)';
    default: return 'ลงนามไม่ได้';
  }
}

/** ภาพรวม ณ ตอนลงนาม — เก็บใน `pm_monthly_signoffs.snapshot` (ตัวเลขสดต่างจากนี้ = จอเขียนบอก) */
export function pmSignSnapshot(team, section = null) {
  if (!team) return null;
  if (section) {
    const s = team.sections.get(section);
    return s ? { total: s.total, ng: s.ng, machines: s.machines.size } : null;
  }
  return { total: team.total, confirmed: team.confirmed, ng: team.ng, machines: team.machines.size, sections: team.sections.size };
}

/** ตัวเลขสดต่างจาก snapshot ไหม (ใบเพิ่ม/ลบ/เปลี่ยนผลหลังลงนาม) */
export function pmSnapshotDrift(snapshot, live) {
  if (!snapshot || !live) return false;
  return ['total', 'ng', 'machines'].some((k) => Number(snapshot[k] ?? 0) !== Number(live[k] ?? 0));
}

/* ── โครงตาราง `pm_monthly_signoffs` (Main · สร้าง 13/11 · migration 20261113c) ──────────────
   `kind` = 'team_approve' (③) | 'section_ack' (④) · `scope_key` = ③ คีย์ทีม · ④ `<คีย์ทีม>|<ส่วนงาน>`
   (④ ต่อ ทีม × ส่วนงาน ตามแบบที่ user อนุมัติ 19/11) — แปลงไป-กลับที่นี่ที่เดียว ห้ามประกอบเองในหน้า */
export const KIND_OF_STEP = Object.freeze({ 3: 'team_approve', 4: 'section_ack' });
export const STEP_OF_KIND = Object.freeze({ team_approve: 3, section_ack: 4 });
/** คีย์สิทธิ์ต่อขั้น (RLS ของตารางเช็คตาม kind) */
export const PERM_OF_STEP = Object.freeze({ 3: ['pm', 'monthly_approve'], 4: ['pm', 'monthly_ack'] });
export const scopeKeyOf = (team, step, section = '') => (step === 4 ? `${team}|${section || ''}` : String(team || ''));
export function parseSignRow(r) {
  const step = STEP_OF_KIND[r?.kind];
  if (!step) return null;
  const sk = String(r.scope_key || '');
  if (step === 3) return { step, team: sk, section: null };
  const i = sk.indexOf('|');
  if (i < 0) return null;   // แถวแบบอื่น (ไม่ใช่ ทีม|ส่วนงาน) — ไม่เดาความหมาย
  return { step, team: sk.slice(0, i), section: sk.slice(i + 1) };
}

/** คีย์ภายในจอ `<team>|<step>|<section>` */
export const signKey = (team, step, section = '') => `${team}|${step}|${section || ''}`;
/** แถวลายเซ็นที่มีผล (status='signed') ต่อ signKey — แถวที่แกะไม่ออกถูกข้าม (นับไว้ใน .skipped) */
export function activeSignoffs(rows = []) {
  const m = new Map();
  let skipped = 0;
  for (const r of rows || []) {
    if (r?.status !== 'signed') continue;
    const p = parseSignRow(r);
    if (!p) { skipped++; continue; }
    const k = signKey(p.team, p.step, p.section);
    if (!m.has(k)) m.set(k, { ...r, ...p });
  }
  m.skipped = skipped;
  return m;
}
