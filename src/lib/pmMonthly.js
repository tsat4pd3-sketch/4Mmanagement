/**
 * pmMonthly — 📅 สรุปผลตรวจ PM ของช่าง รายเดือน + กฎลงนามขั้น ③ / ④ (PM รอบ 2 · 2026-11-13 · คำสั่ง user)
 * pure ล้วน · เทส src/lib/__tests__/pmMonthly.test.mjs (ไม่แตะฐาน — ตัวโหลดอยู่ `PmMonthlyReport.jsx`)
 *
 * สายใบ PM: ① ผู้ตรวจ (สแกนบัตร) → ② หัวหน้าผู้ตรวจยืนยันทีละใบ (`inspections.approval_status='approved'`)
 *           → ③ ผจก.ส่วนของผู้ตรวจ อนุมัติรายเดือน ต่อ "ทีมช่าง"  → ④ ผจก.ส่วนที่ถูกตรวจ รับทราบรายเดือน ต่อ "ส่วนงาน"
 * 🔴 ลำดับบังคับ: ③ ได้เมื่อใบของทีมนั้นในเดือนผ่าน ② ครบ · ④ ได้เมื่อทุกทีมที่ตรวจในส่วนงานนั้นผ่าน ③ แล้ว
 * 🔴 ส่วนงานของใบ = ส่วนงานของ "ไลน์ของเครื่อง" (`jigs.line_name` → ทะเบียนไลน์ `section`) · ไม่รู้ = ถัง "ไม่ทราบส่วนงาน" (ห้ามหาย)
 * 🔴 ไม่รู้ตำแหน่ง = ไม่บล็อก แต่คืน `assumed` ให้จอเขียนบอก (กติกาเดียวกับ AM/MO)
 */

export const PM_MONTHLY_MIN_RANK = 60;            // ผู้จัดการ
export const PM_REVOKE_REASON_MIN = 5;
export const UNKNOWN_SECTION = '(ไม่ทราบส่วนงาน)';

const norm = (v) => String(v ?? '').trim().toLowerCase();

/** เดือนจบแล้วหรือยัง — เทียบกับ "วันทำงาน" ปัจจุบัน (YYYY-MM-DD) · ห้ามใช้ timezone เครื่อง */
export function pmMonthComplete(month, todayWorkDate) {
  if (!/^\d{4}-\d{2}$/.test(String(month || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayWorkDate || ''))) {
    return { complete: false, opensOn: null };
  }
  const [y, m] = month.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const next = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { complete: todayWorkDate >= next, opensOn: `${next} 08:00` };
}

/** ถังสถานะของใบ (ขั้น ②) */
export function pmApprovalBucket(i) {
  const a = norm(i?.approval_status);
  if (a === 'approved') return 'confirmed';
  if (a === 'rejected') return 'rejected';
  return 'pending';
}

/**
 * สร้างสรุปรายเดือน
 * @param {object[]} rows  ใบตรวจ { id, team, line_name, machine, status:'pass'|'fail'|..., approval_status }
 * @param {Map<string,string>|object} sectionOfLine  ชื่อไลน์ (ตัวพิมพ์ใดก็ได้) → ส่วนงาน
 * @returns {{ teams: object[], sections: object[], total: object }}
 */
export function buildPmMonthly(rows = [], sectionOfLine = new Map()) {
  const secOf = (ln) => {
    const k = norm(ln);
    if (!k) return UNKNOWN_SECTION;
    const v = sectionOfLine instanceof Map ? sectionOfLine.get(k) : sectionOfLine?.[k];
    return v || UNKNOWN_SECTION;
  };
  const blank = () => ({ total: 0, pass: 0, fail: 0, other: 0, confirmed: 0, pending: 0, rejected: 0, machines: new Set() });
  const add = (acc, r) => {
    acc.total += 1;
    const st = norm(r.status);
    if (st === 'pass') acc.pass += 1; else if (st === 'fail') acc.fail += 1; else acc.other += 1;
    acc[pmApprovalBucket(r)] += 1;
    if (r.machine) acc.machines.add(r.machine);
  };
  const teams = new Map();
  const sections = new Map();
  const total = blank();
  for (const r of rows) {
    const team = r.team || '(ไม่ทราบทีม)';
    const sec = secOf(r.line_name);
    if (!teams.has(team)) teams.set(team, { ...blank(), sections: new Set() });
    if (!sections.has(sec)) sections.set(sec, { ...blank(), byTeam: new Map() });
    const t = teams.get(team); add(t, r); t.sections.add(sec);
    const s = sections.get(sec); add(s, r);
    if (!s.byTeam.has(team)) s.byTeam.set(team, blank());
    add(s.byTeam.get(team), r);
    add(total, r);
  }
  const fin = (o) => ({ total: o.total, pass: o.pass, fail: o.fail, other: o.other, confirmed: o.confirmed,
    pending: o.pending, rejected: o.rejected, machines: o.machines.size });
  return {
    teams: [...teams.entries()].map(([team, o]) => ({ team, ...fin(o), sections: [...o.sections].sort() }))
      .sort((a, b) => a.team.localeCompare(b.team)),
    sections: [...sections.entries()].map(([section, o]) => ({
      section, ...fin(o),
      byTeam: [...o.byTeam.entries()].map(([team, x]) => ({ team, ...fin(x) })).sort((a, b) => a.team.localeCompare(b.team)),
    })).sort((a, b) => (a.section === UNKNOWN_SECTION) - (b.section === UNKNOWN_SECTION) || a.section.localeCompare(b.section, 'th')),
    total: fin(total),
  };
}

/** snapshot ที่เก็บตอนลงนาม (ตัวเลขของทีม/ส่วนงาน ณ ตอนนั้น) */
export function pmSnapshot(row, { month, kind } = {}) {
  if (!row) return null;
  const pick = ({ total, pass, fail, other, confirmed, pending, rejected, machines }) => ({ total, pass, fail, other, confirmed, pending, rejected, machines });
  return { month, kind, ...pick(row), ...(row.byTeam ? { byTeam: row.byTeam.map(t => ({ team: t.team, ...pick(t) })) } : {}),
    ...(row.sections ? { sections: row.sections } : {}) };
}

/** ตัวเลขสดต่างจาก snapshot ไหม (ต้องเขียนบนจอ ห้ามเงียบ) */
export function pmSnapshotDrift(snapshot, row) {
  if (!snapshot || !row) return false;
  return ['total', 'pass', 'fail', 'confirmed', 'pending', 'rejected'].some(k => Number(snapshot[k] ?? 0) !== Number(row[k] ?? 0));
}

/**
 * ลงนามได้ไหม — ใช้ทั้ง ③ (`kind:'team_approve'`) และ ④ (`kind:'section_ack'`)
 * @param {{ kind:string, permitted:boolean, sharedAccount?:boolean, signerRank?:number|null, scopeOk?:boolean,
 *           monthComplete?:boolean, alreadySigned?:boolean, pendingConfirm?:number, teamsWaiting?:string[] }} p
 * code: ok · no_perm · shared_account · rank_too_low · scope · month_running · already_signed · pending_confirm · wait_team_approve · empty
 */
export function pmMonthlyVerdict({ kind, permitted = false, sharedAccount = false, signerRank = null, scopeOk = true,
  monthComplete = false, alreadySigned = false, pendingConfirm = 0, teamsWaiting = [], total = 0 } = {}) {
  const known = signerRank != null && Number.isFinite(Number(signerRank));
  const assumed = known ? [] : ['approver'];
  if (!permitted) return { ok: false, code: 'no_perm', assumed };
  if (sharedAccount) return { ok: false, code: 'shared_account', assumed };
  if (known && Number(signerRank) < PM_MONTHLY_MIN_RANK) return { ok: false, code: 'rank_too_low', assumed };
  if (!scopeOk) return { ok: false, code: 'scope', assumed };
  if (!monthComplete) return { ok: false, code: 'month_running', assumed };
  if (alreadySigned) return { ok: false, code: 'already_signed', assumed };
  if (!total) return { ok: false, code: 'empty', assumed };
  if (kind === 'team_approve' && pendingConfirm > 0) return { ok: false, code: 'pending_confirm', assumed, n: pendingConfirm };
  if (kind === 'section_ack' && teamsWaiting.length) return { ok: false, code: 'wait_team_approve', assumed, teams: teamsWaiting };
  return { ok: true, code: 'ok', assumed };
}

/** ข้อความบนจอของ verdict (ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล) */
export function pmMonthlyText(v, { opensOn = '', kind = '', teamLabel = (t) => t } = {}) {
  if (!v || v.ok) return '';
  const who = kind === 'section_ack' ? 'ผจก.ส่วนที่ถูกตรวจ' : 'ผจก.ส่วนของผู้ตรวจ';
  switch (v.code) {
    case 'no_perm': return `ลงนามได้เฉพาะผู้ถือสิทธิ์ "${kind === 'section_ack' ? 'PM: รับทราบผลตรวจรายเดือน' : 'PM: อนุมัติผลตรวจรายเดือน'}"`;
    case 'shared_account': return 'บัญชีกลางลงนามไม่ได้ — ให้เข้าด้วยบัญชีของตัวเอง';
    case 'rank_too_low': return `ขั้นนี้ต้องเป็นระดับผู้จัดการ (${who})`;
    case 'scope': return kind === 'section_ack'
      ? 'ส่วนงานนี้อยู่นอกขอบเขตที่คุณรับผิดชอบ — ดูได้ แต่ลงนามไม่ได้'
      : 'ทีมนี้ไม่ได้ตั้งไว้ในบัญชีของคุณ (ช่อง "ทีมช่างซ่อม" ที่ /add-user) — ดูได้ แต่ลงนามไม่ได้';
    case 'month_running': return `เดือนนี้ยังไม่จบ — ลงนามได้${opensOn ? `ตั้งแต่ ${opensOn}` : 'หลังสิ้นเดือน'}`;
    case 'already_signed': return 'ลงนามแล้ว — ต้องเพิกถอนลายเซ็นเดิมก่อนจึงลงนามใหม่ได้';
    case 'empty': return 'เดือนนี้ไม่มีใบตรวจ — ไม่มีอะไรให้ลงนาม';
    case 'pending_confirm': return `ยังมีใบที่รอหัวหน้าผู้ตรวจยืนยัน ${v.n} ใบ — ต้องยืนยันครบก่อน`;
    case 'wait_team_approve': return `รอ ผจก. ทีม ${(v.teams || []).map(teamLabel).join(', ')} อนุมัติก่อน`;
    case 'reason': return `ต้องระบุเหตุผลการเพิกถอนอย่างน้อย ${PM_REVOKE_REASON_MIN} ตัวอักษร`;
    default: return 'ลงนามไม่ได้';
  }
}

/** เพิกถอนได้ไหม — ผู้ลงนามเอง หรือผู้ถือคีย์ระดับผู้จัดการ · ต้องมีเหตุผล */
export function pmRevokeVerdict({ permitted = false, sharedAccount = false, revokerRank = null, isSigner = false, reason = '' } = {}) {
  const known = revokerRank != null && Number.isFinite(Number(revokerRank));
  const assumed = known ? [] : ['approver'];
  if (!permitted) return { ok: false, code: 'no_perm', assumed };
  if (sharedAccount) return { ok: false, code: 'shared_account', assumed };
  if (!isSigner && known && Number(revokerRank) < PM_MONTHLY_MIN_RANK) return { ok: false, code: 'rank_too_low', assumed };
  if (String(reason || '').trim().length < PM_REVOKE_REASON_MIN) return { ok: false, code: 'reason', assumed };
  return { ok: true, code: 'ok', assumed };
}

/** แถว Excel (array-of-arrays) — ชีตเดียว: สรุปรายส่วนงาน × ทีม + สถานะลงนาม */
export function pmMonthlyAoa(summary, { month, teamLabel = (t) => t, signOf = () => null } = {}) {
  const head = ['เดือน', 'ส่วนงานที่ถูกตรวจ', 'ทีมช่าง', 'ใบตรวจ', 'ผ่าน', 'ไม่ผ่าน', 'อื่นๆ', 'หัวหน้ายืนยันแล้ว', 'รอยืนยัน', 'ตีกลับ', 'จำนวนเครื่อง',
    '③ ผจก.ทีมอนุมัติ', '④ ผจก.ส่วนรับทราบ'];
  const out = [head];
  for (const s of summary?.sections || []) {
    const ack = signOf('section_ack', s.section);
    for (const t of s.byTeam) {
      const ap = signOf('team_approve', t.team);
      out.push([month, s.section, teamLabel(t.team), t.total, t.pass, t.fail, t.other, t.confirmed, t.pending, t.rejected, t.machines,
        ap ? `${ap.signed_by_name || ''} ${String(ap.signed_at || '').slice(0, 10)}` : 'ยังไม่อนุมัติ',
        ack ? `${ack.signed_by_name || ''} ${String(ack.signed_at || '').slice(0, 10)}` : 'ยังไม่รับทราบ']);
    }
  }
  return out;
}
