import { useState } from 'react';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import InfoMore from '../components/InfoMore';
import { toast } from '../components/Toast';
import useTabParam from '../utils/useTabParam';
import { getWorkDate, addDaysStr } from '../utils/workDate';

/* ══ ✈️ เบิกเงินเดินทางต่างประเทศ — MOCKUP workflow (2026-10-29 · คำสั่ง user · ผัง "Overseas Business Travel Process") ══
   ถอดจากผัง swimlane 6 ช่อง: ผู้เดินทาง · ผู้อนุมัติ · HR/Compliance · Travel/Admin · Finance/Accounting/ECM
   ลำดับ 7 ข้อตามคอลัมน์ "คำอธิบาย" ของผัง = แถบสถานะ 7 ขั้นของทุกใบ:
     1 ขอเดินทาง → 2 อนุมัติ (Line Manager → Department Head → Executive · ไม่อนุมัติ = ส่งกลับแก้ไข)
     → 3 HR ตรวจสิทธิ์ + Compliance ตรวจข้อกำหนดประเทศ/ลูกค้า → 4 เตรียมเดินทาง (Admin: Passport → Visa? → ตั๋ว/โรงแรม/ประกัน/eSIM
       · Finance: ตรวจงบ (ขนานกับการอนุมัติ ตามลูกศรในผัง) + Advance ถ้าขอ) → Ready to Travel Check
     → 5 เดินทาง (บันทึกกิจกรรม) → 6 ยื่น Expense Claim + Business Trip Report
     → 7 Finance ตรวจค่าใช้จ่าย · คำนวณเบี้ยเลี้ยง · หักล้าง Advance · อนุมัติ · ลงบัญชี · ECM ปิดงาน
   ⚠️ ตัวอย่างหน้าจอ — **ไม่เขียน DB ใดๆ** ข้อมูลอยู่ใน state ของหน้า (รีเฟรช = เริ่มใหม่) · ชื่อคน/เลขใบ/อัตราเบี้ยเลี้ยงเป็นตัวอย่าง
   · Visa และ Advance = ขั้นตามเงื่อนไข (หมายเหตุในผัง)
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

const TABS = [
  { key: 'overview', label: '🗺️ ภาพรวม' },
  { key: 'traveler', label: '🧳 ผู้เดินทาง' },
  { key: 'approver', label: '✅ ผู้อนุมัติ' },
  { key: 'hr', label: '🛂 HR / Compliance' },
  { key: 'admin', label: '🎫 Travel / Admin' },
  { key: 'finance', label: '💰 Finance / ECM' },
];

const PHASES = ['ขอเดินทาง', 'อนุมัติ', 'HR / Compliance', 'เตรียมเดินทาง', 'เดินทาง', 'ยื่นเบิก', 'Finance ปิดงาน'];
const APPROVAL_LEVELS = [
  { k: 'lm', label: 'Line Manager' },
  { k: 'dh', label: 'Department Head' },
  { k: 'exec', label: 'Executive' },
];
const ADMIN_STEPS = [
  { k: 'quote', label: 'ขอ Flight Quotation' },
  { k: 'flight', label: 'จองตั๋วเครื่องบิน' },
  { k: 'hotel', label: 'จองโรงแรม' },
  { k: 'insurance', label: 'จัดทำประกันเดินทาง' },
  { k: 'esim', label: 'เตรียม eSIM / Roaming / VPN' },
];
const EXPENSE_CATS = ['ค่าเดินทางในประเทศปลายทาง', 'ค่าที่พัก (ส่วนเกิน)', 'ค่ารับรองลูกค้า', 'ค่าโทรศัพท์/อินเทอร์เน็ต', 'อื่นๆ'];
/* อัตราเบี้ยเลี้ยงตัวอย่าง — ระบบจริงต้องอ่านจากประกาศบริษัท (ห้ามฝังในโค้ด) */
const PER_DIEM_SAMPLE = 3000;

const btnPrimary = { padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800,
  background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' };
const btnGhost = { padding: '6px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700,
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)' };
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)' };
const h3 = { margin: 0, fontSize: 15 };
const muted = { fontSize: 12, color: 'var(--muted)' };

const baht = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-US')} บาท`;
const fmtDate = (s) => { try { return new Date(`${s}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return s; } };
/* จำนวนวันเดินทาง (นับวันไป-กลับรวม) — แกะวันไม่ออก = null ห้ามเดา */
function tripDays(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`); const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}
const claimTotal = (r) => r.claim.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
const perDiemOf = (r) => { const d = tripDays(r.from, r.to); return d == null ? null : d * PER_DIEM_SAMPLE; };

function blankRequest(today) {
  return { traveler: 'ผู้เดินทาง (ตัวอย่าง)', purpose: '', country: '', from: addDaysStr(today, 14), to: addDaysStr(today, 18), budget: '', advReq: false, advAmount: '' };
}

/* ใบใหม่ — ทุกขั้นยังว่าง */
function newRecord(id, f, today) {
  return {
    id, no: `TR-${today.slice(2, 4)}${today.slice(5, 7)}-${String(id).padStart(3, '0')}`,
    traveler: f.traveler, purpose: f.purpose.trim(), country: f.country.trim(), from: f.from, to: f.to,
    budget: Number(f.budget) || 0, advReq: !!f.advReq, advAmount: f.advReq ? Number(f.advAmount) || 0 : 0,
    appr: { lm: false, dh: false, exec: false }, returned: null,
    budgetOk: false, hrOk: false, compOk: false,
    admin: { passport: false, visaReq: null, visaApplied: false, quote: false, flight: false, hotel: false, insurance: false, esim: false },
    visaDocsSent: false, adv: { approved: false, paid: false }, ready: false,
    trip: { started: false, ended: false, activities: [] },
    claim: { lines: [], submitted: false }, report: { text: '', submitted: false },
    fin: { verified: false, finalOk: false, posted: false, archived: false },
    log: [{ at: today, text: 'ผู้เดินทางยื่นคำขอ' }],
  };
}

function seed(today) {
  const a = newRecord(1, { traveler: 'สมชาย (ตัวอย่าง)', purpose: 'ประชุมทบทวนแม่พิมพ์กับลูกค้า', country: 'ญี่ปุ่น', from: addDaysStr(today, 10), to: addDaysStr(today, 13), budget: 85000, advReq: true, advAmount: 20000 }, today);
  const b = newRecord(2, { traveler: 'สุดา (ตัวอย่าง)', purpose: 'อบรมระบบเชื่อมที่ผู้ผลิตเครื่อง', country: 'จีน', from: addDaysStr(today, 5), to: addDaysStr(today, 9), budget: 60000, advReq: false }, today);
  Object.assign(b, { appr: { lm: true, dh: true, exec: true }, budgetOk: true, hrOk: true, compOk: true });
  b.admin = { ...b.admin, passport: true, visaReq: true };
  const c = newRecord(3, { traveler: 'วิชัย (ตัวอย่าง)', purpose: 'Audit supplier ชิ้นส่วนกด', country: 'เวียดนาม', from: addDaysStr(today, -8), to: addDaysStr(today, -5), budget: 45000, advReq: true, advAmount: 10000 }, today);
  Object.assign(c, {
    appr: { lm: true, dh: true, exec: true }, budgetOk: true, hrOk: true, compOk: true, ready: true,
    admin: { passport: true, visaReq: false, visaApplied: false, quote: true, flight: true, hotel: true, insurance: true, esim: true },
    adv: { approved: true, paid: true },
    trip: { started: true, ended: true, activities: ['เข้า audit สายการผลิต 2 วัน', 'สรุปผลกับ supplier'] },
    claim: { submitted: true, lines: [{ cat: 'ค่าเดินทางในประเทศปลายทาง', amount: 3200, receipt: true }, { cat: 'ค่ารับรองลูกค้า', amount: 4500, receipt: true }] },
    report: { text: 'ผล audit ผ่าน 2 จุดต้องแก้ไข (ตัวอย่าง)', submitted: true },
  });
  return [c, b, a];
}

/* ── สถานะของใบ: อยู่ขั้นไหน + รอใครบ้าง (ขั้น 4 มีหลายคนทำขนานกัน) ── */
const nextApproval = (r) => APPROVAL_LEVELS.find(l => !r.appr[l.k]) || null;
const adminNext = (r) => {
  const a = r.admin;
  if (!a.passport) return 'ตรวจ Passport';
  if (a.visaReq == null) return 'ตัดสินว่าต้องใช้ Visa หรือไม่';
  if (a.visaReq && !a.visaApplied) return r.visaDocsSent ? 'ยื่น Visa และติดตามผล' : null;   // รอเอกสารจากผู้เดินทางก่อน
  const s = ADMIN_STEPS.find(x => !a[x.k]);
  return s ? s.label : null;
};
const adminDone = (r) => r.admin.passport && r.admin.visaReq != null && (!r.admin.visaReq || r.admin.visaApplied) && ADMIN_STEPS.every(x => r.admin[x.k]);
const advDone = (r) => !r.advReq || r.adv.paid;
/* เหตุที่ยังกด Ready to Travel ไม่ได้ — ต้องบอกบนจอ ไม่ใช่แค่ปุ่มเทา */
const readyBlockers = (r) => [
  !adminDone(r) && 'งานเตรียมของ Admin ยังไม่ครบ',
  !r.budgetOk && 'Finance ยังไม่ตรวจงบประมาณ',
  !advDone(r) && 'Advance ยังไม่โอน',
].filter(Boolean);

function phaseOf(r) {
  if (r.returned || nextApproval(r)) return 1;
  if (!r.hrOk || !r.compOk) return 2;
  if (!r.ready) return 3;
  if (!r.trip.ended) return 4;
  if (!r.claim.submitted || !r.report.submitted) return 5;
  if (!r.fin.archived) return 6;
  return 7;
}

function waitsOf(r) {
  const w = [];
  if (r.fin.archived) return w;
  if (r.returned) return [{ role: 'traveler', text: `แก้ไขแล้วส่งใหม่ (${r.returned.by} ส่งกลับ)` }];
  const lvl = nextApproval(r);
  if (lvl) w.push({ role: 'approver', text: `${lvl.label} พิจารณา` });
  if (!r.budgetOk) w.push({ role: 'finance', text: 'ตรวจสอบงบประมาณ' });
  if (lvl) return w;
  if (!r.hrOk) { w.push({ role: 'hr', text: 'HR ตรวจสิทธิ์การเดินทาง' }); return w; }
  if (!r.compOk) { w.push({ role: 'hr', text: 'Compliance ตรวจข้อกำหนดประเทศ/ลูกค้า' }); return w; }
  if (!r.ready) {
    if (r.admin.visaReq && !r.visaDocsSent) w.push({ role: 'traveler', text: 'ส่งเอกสาร Visa' });
    const an = adminNext(r);
    if (an) w.push({ role: 'admin', text: an });
    if (r.advReq && r.budgetOk && !r.adv.approved) w.push({ role: 'finance', text: 'อนุมัติ Advance' });
    else if (r.advReq && r.adv.approved && !r.adv.paid) w.push({ role: 'finance', text: 'โอน Advance ให้ผู้เดินทาง' });
    if (!readyBlockers(r).length) w.push({ role: 'admin', text: 'Ready to Travel Check' });
    return w;
  }
  if (!r.trip.started) return [{ role: 'traveler', text: 'เริ่มเดินทาง' }];
  if (!r.trip.ended) return [{ role: 'traveler', text: 'บันทึกกิจกรรม / จบการเดินทาง' }];
  if (!r.claim.submitted) w.push({ role: 'traveler', text: 'ยื่น Expense Claim' });
  if (!r.report.submitted) w.push({ role: 'traveler', text: 'ยื่น Business Trip Report' });
  if (w.length) return w;
  const f = r.fin;
  const step = !f.verified ? 'ตรวจค่าใช้จ่าย (ใบเสร็จ/นโยบาย)' : !f.finalOk ? 'อนุมัติค่าใช้จ่าย (Final Approval)' : !f.posted ? 'ลงบัญชี' : 'ECM จัดเก็บเอกสารและปิดงาน';
  return [{ role: 'finance', text: step }];
}

const ROLE_LABEL = { traveler: 'ผู้เดินทาง', approver: 'ผู้อนุมัติ', hr: 'HR/Compliance', admin: 'Travel/Admin', finance: 'Finance' };

/* แถบ 7 ขั้น — วงทึบ ✓ = ผ่าน · วงขอบหนา = อยู่ขั้นนี้ · ส่งกลับแก้ไข = ขั้นอนุมัติแดง */
function PhaseBar({ r }) {
  const at = phaseOf(r);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PHASES.length}, minmax(0, 1fr))`, maxWidth: 820, paddingTop: 4 }}>
      {PHASES.map((label, i) => {
        const done = i < at;
        const bad = !!r.returned && i === 1;
        const cur = i === at && !bad;
        const c = bad ? '#ef4444' : done ? '#22c55e' : cur ? 'var(--accent)' : 'var(--muted)';
        return (
          <div key={label} style={{ position: 'relative', display: 'grid', justifyItems: 'center', alignContent: 'start', gap: 3, textAlign: 'center' }}>
            {i < PHASES.length - 1 && (
              <span style={{ position: 'absolute', top: 10, left: '50%', width: '100%', height: 2, background: i < at ? '#22c55e' : 'var(--border2)' }} />
            )}
            <span aria-current={cur ? 'step' : undefined}
              style={{ position: 'relative', width: 22, height: 22, borderRadius: '50%', boxSizing: 'border-box', display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 800, background: done || bad ? c : 'var(--card)', border: `${cur ? 3 : 2}px solid ${c}`, color: done || bad ? '#fff' : c }}>
              {bad ? '✕' : done ? '✓' : i + 1}
            </span>
            <span style={{ fontSize: 11, fontWeight: done || cur || bad ? 700 : 400, color: c }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Check({ ok, children }) {
  return <div style={{ fontSize: 13, color: ok ? '#22c55e' : 'var(--muted)' }}>{ok ? '✓' : '○'} {children}</div>;
}

export default function OverseasTravelMockup() {
  const [tab, setTab] = useTabParam(TABS.map(t => t.key), 'overview');
  const today = getWorkDate();
  const [items, setItems] = useState(() => seed(today));
  const [seq, setSeq] = useState(4);
  const [form, setForm] = useState(() => blankRequest(today));
  const [editId, setEditId] = useState(null);                 // ใบที่ถูกส่งกลับ กำลังแก้
  const [returnFor, setReturnFor] = useState(null);
  const [reason, setReason] = useState('');
  const [activity, setActivity] = useState('');
  const [line, setLine] = useState({ cat: EXPENSE_CATS[0], amount: '', receipt: true });

  const upd = (id, fn, logText) => setItems(xs => xs.map(r => {
    if (r.id !== id) return r;
    const n = fn(JSON.parse(JSON.stringify(r)));   // ไม่ใช้ structuredClone — จอ TV Chromium 94 ไม่มี
    if (logText) n.log = [...n.log, { at: today, text: logText }];
    return n;
  }));

  const missing = [
    !form.purpose.trim() && 'วัตถุประสงค์', !form.country.trim() && 'ประเทศ',
    !form.from && 'วันไป', !form.to && 'วันกลับ',
    form.from && form.to && tripDays(form.from, form.to) == null && 'วันกลับต้องไม่ก่อนวันไป',
    !(Number(form.budget) > 0) && 'งบประมาณ', form.advReq && !(Number(form.advAmount) > 0) && 'ยอด Advance',
  ].filter(Boolean);

  const submit = () => {
    if (missing.length) { toast.error(`กรอกไม่ครบ: ${missing.join(' · ')}`); return; }
    if (editId) {
      upd(editId, (r) => {
        const fresh = newRecord(r.id, form, today);
        return { ...fresh, no: r.no, log: r.log };     // ส่งใหม่ = เริ่มอนุมัติใหม่ทั้งสาย
      }, 'ผู้เดินทางแก้ไขและส่งใหม่');
      toast.success('ส่งใหม่แล้ว — เริ่มอนุมัติใหม่ตั้งแต่ Line Manager');
    } else {
      setItems(xs => [newRecord(seq, form, today), ...xs]);
      setSeq(n => n + 1);
      toast.success('ยื่นคำขอแล้ว — ส่งถึง Line Manager + Finance ตรวจงบ (จำลอง)');
    }
    setForm(blankRequest(today)); setEditId(null);
  };

  const startEdit = (r) => {
    setEditId(r.id);
    setForm({ traveler: r.traveler, purpose: r.purpose, country: r.country, from: r.from, to: r.to, budget: String(r.budget), advReq: r.advReq, advAmount: String(r.advAmount || '') });
  };

  const doReturn = (r) => {
    const lvl = nextApproval(r);
    if (!reason.trim()) { toast.error('ส่งกลับแก้ไขต้องใส่เหตุผล'); return; }
    upd(r.id, (n) => { n.returned = { by: lvl.label, reason: reason.trim() }; return n; }, `${lvl.label} ส่งกลับแก้ไข: ${reason.trim()}`);
    setReturnFor(null); setReason('');
  };

  const counts = Object.fromEntries(Object.keys(ROLE_LABEL).map(k => [k, items.filter(r => waitsOf(r).some(w => w.role === k)).length]));
  const tabs = TABS.map(t => (counts[t.key] ? { ...t, badge: counts[t.key] } : t));
  const mine = (role) => items.filter(r => waitsOf(r).some(w => w.role === role));
  const prepItems = items.filter(r => !r.returned && phaseOf(r) === 3);

  /* ⚠️ render function (ไม่ใช่ component ที่ประกาศใน body) — กันช่องพิมพ์ใน children หลุดโฟกัสทุกตัวอักษร */
  const reqCard = (r, children, opts = {}) => {
    const waits = waitsOf(r);
    return (
      <div key={r.id} style={{ ...card, display: 'grid', gap: 8, borderLeft: `4px solid ${r.returned ? '#ef4444' : r.fin.archived ? '#22c55e' : 'var(--accent)'}` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14 }}>{r.no}</b>
          <span style={{ fontSize: 14 }}>{r.purpose}</span>
          <span style={{ marginLeft: 'auto', ...muted }}>{r.traveler} · {r.country} · {fmtDate(r.from)} – {fmtDate(r.to)} ({tripDays(r.from, r.to) ?? '?'} วัน)</span>
        </div>
        <div style={{ ...muted, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>งบประมาณ {baht(r.budget)}</span>
          <span>Advance: {r.advReq ? baht(r.advAmount) : 'ไม่ขอ'}</span>
        </div>
        <PhaseBar r={r} />
        {r.returned && <div style={{ fontSize: 13, color: '#ef4444' }}>↩ {r.returned.by} ส่งกลับแก้ไข: {r.returned.reason}</div>}
        <div style={{ fontSize: 13 }}>
          {waits.length
            ? <>⏳ รอ: {waits.map(w => `${ROLE_LABEL[w.role]} — ${w.text}`).join(' · ')}</>
            : <span style={{ color: '#22c55e', fontWeight: 700 }}>✓ ปิดงานแล้ว (ECM จัดเก็บเอกสาร)</span>}
        </div>
        {opts.log && (
          <details style={{ fontSize: 12 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>ประวัติ ({r.log.length})</summary>
            <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
              {r.log.map((l, i) => <div key={i}><span style={muted}>{fmtDate(l.at)} · </span>{l.text}</div>)}
            </div>
          </details>
        )}
        {children}
      </div>
    );
  };

  const empty = (text) => <div style={{ ...card, ...muted, fontSize: 13 }}>{text}</div>;
  const field = { display: 'grid', gap: 4, fontSize: 13 };

  return (
    <Page>
      <PageHeader
        title="เบิกเงินเดินทางต่างประเทศ"
        icon="✈️"
        sub={<span><b style={{ color: '#f59e0b' }}>🧪 MOCKUP</b> · ข้อมูลจำลองในหน้านี้ ไม่บันทึกลงฐานข้อมูล (รีเฟรช = เริ่มใหม่)</span>}
        tabs={tabs} tab={tab} onTab={setTab}
      />
      <div style={{ marginBottom: 12 }}>
        <InfoMore lead="ลำดับงาน 7 ขั้นตามผัง: ขอเดินทาง → อนุมัติ 3 ระดับ → HR/Compliance → เตรียมเดินทาง → เดินทาง → ยื่นเบิก → Finance ปิดงาน">
          สลับแท็บด้านบนเพื่อเล่นเป็นแต่ละฝ่าย — ตัวเลขบนแท็บ = จำนวนใบที่รอฝ่ายนั้น ·
          Finance ตรวจงบได้ตั้งแต่ยื่นคำขอ (ขนานกับการอนุมัติ) · Visa และ Advance เป็นขั้นตามเงื่อนไข ·
          อัตราเบี้ยเลี้ยง {baht(PER_DIEM_SAMPLE)}/วัน เป็นตัวอย่าง — ระบบจริงต้องอ่านจากประกาศบริษัท
        </InfoMore>
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {items.length ? items.map(r => reqCard(r, null, { log: true })) : empty('ยังไม่มีคำขอ')}
        </div>
      )}

      {tab === 'traveler' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', alignItems: 'start' }}>
          <div style={{ ...card, display: 'grid', gap: 10 }}>
            <h3 style={h3}>{editId ? `✏️ แก้ไขคำขอ ${items.find(r => r.id === editId)?.no || ''}` : '🧳 Travel Request — ยื่นคำขอเดินทาง'}</h3>
            <label style={field}>วัตถุประสงค์
              <input value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="เช่น ประชุมลูกค้า / อบรม / audit supplier" />
            </label>
            <label style={field}>ประเทศปลายทาง
              <input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={field}>วันไป<input type="date" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} /></label>
              <label style={field}>วันกลับ<input type="date" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} /></label>
              <span style={{ ...muted, alignSelf: 'end', paddingBottom: 8 }}>{tripDays(form.from, form.to) ? `${tripDays(form.from, form.to)} วัน` : ''}</span>
            </div>
            <label style={field}>งบประมาณโดยประมาณ (บาท)
              <input type="number" min="0" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} style={{ maxWidth: 200 }} />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={form.advReq} onChange={e => setForm(f => ({ ...f, advReq: e.target.checked }))} /> ขอเงินทดรอง (Advance)
            </label>
            {form.advReq && (
              <label style={field}>ยอด Advance (บาท)
                <input type="number" min="0" value={form.advAmount} onChange={e => setForm(f => ({ ...f, advAmount: e.target.value }))} style={{ maxWidth: 200 }} />
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={btnPrimary} onClick={submit}>{editId ? 'ส่งใหม่ → Line Manager' : 'ยื่นคำขอ → Line Manager'}</button>
              {editId && <button type="button" style={btnGhost} onClick={() => { setEditId(null); setForm(blankRequest(today)); }}>ยกเลิกแก้ไข</button>}
              {missing.length > 0 && <span style={muted}>ยังขาด: {missing.join(' · ')}</span>}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <h3 style={h3}>งานที่รอผู้เดินทาง ({counts.traveler})</h3>
            {mine('traveler').length ? mine('traveler').map(r => reqCard(r, (
              <div style={{ display: 'grid', gap: 8 }}>
                {r.returned && <div><button type="button" style={btnPrimary} onClick={() => startEdit(r)}>✏️ แก้ไขคำขอ</button></div>}
                {!r.returned && r.admin.visaReq && !r.visaDocsSent && !r.ready && (
                  <div><button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.visaDocsSent = true; return n; }, 'ผู้เดินทางส่งเอกสาร Visa')}>📄 ส่งเอกสาร Visa</button></div>
                )}
                {r.ready && !r.trip.started && (
                  <div><button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.trip.started = true; return n; }, 'เริ่มเดินทางปฏิบัติงาน')}>✈️ เริ่มเดินทาง</button></div>
                )}
                {r.trip.started && !r.trip.ended && (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {r.trip.activities.map((a, i) => <div key={i} style={{ fontSize: 13 }}>• {a}</div>)}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <input value={activity} onChange={e => setActivity(e.target.value)} placeholder="บันทึกกิจกรรมระหว่างเดินทาง" style={{ flex: 1, minWidth: 200 }} />
                      <button type="button" style={btnGhost} onClick={() => {
                        if (!activity.trim()) return;
                        upd(r.id, n => { n.trip.activities = [...n.trip.activities, activity.trim()]; return n; }); setActivity('');
                      }}>+ บันทึก</button>
                    </div>
                    <div><button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.trip.ended = true; return n; }, 'จบการเดินทาง')}>🏠 จบการเดินทาง</button></div>
                  </div>
                )}
                {r.trip.ended && !r.claim.submitted && (
                  <div style={{ display: 'grid', gap: 6, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                    <b style={{ fontSize: 13 }}>Expense Claim — ค่าใช้จ่าย + เอกสารประกอบ</b>
                    {r.claim.lines.map((l, i) => (
                      <div key={i} style={{ fontSize: 13, display: 'flex', gap: 8 }}>
                        <span>• {l.cat}</span><span>{baht(l.amount)}</span><span style={{ color: l.receipt ? '#22c55e' : '#f59e0b' }}>{l.receipt ? 'มีใบเสร็จ' : 'ไม่มีใบเสร็จ'}</span>
                        <button type="button" style={{ ...btnGhost, padding: '0 8px' }} onClick={() => upd(r.id, n => { n.claim.lines = n.claim.lines.filter((_, j) => j !== i); return n; })}>✕</button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select value={line.cat} onChange={e => setLine(l => ({ ...l, cat: e.target.value }))}>{EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}</select>
                      <input type="number" min="0" value={line.amount} onChange={e => setLine(l => ({ ...l, amount: e.target.value }))} placeholder="บาท" style={{ width: 120 }} />
                      <label style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input type="checkbox" checked={line.receipt} onChange={e => setLine(l => ({ ...l, receipt: e.target.checked }))} /> มีใบเสร็จ
                      </label>
                      <button type="button" style={btnGhost} onClick={() => {
                        if (!(Number(line.amount) > 0)) { toast.error('ใส่ยอดเงิน'); return; }
                        upd(r.id, n => { n.claim.lines = [...n.claim.lines, { ...line, amount: Number(line.amount) }]; return n; });
                        setLine(l => ({ ...l, amount: '' }));
                      }}>+ เพิ่มรายการ</button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.claim.submitted = true; return n; }, `ยื่น Expense Claim ${baht(claimTotal(r))}`)}>ยื่น Expense Claim ({baht(claimTotal(r))})</button>
                      <span style={muted}>ไม่มีค่าใช้จ่ายนอกเบี้ยเลี้ยง = ยื่นแบบไม่มีรายการได้</span>
                    </div>
                  </div>
                )}
                {r.trip.ended && !r.report.submitted && (
                  <div style={{ display: 'grid', gap: 6, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                    <b style={{ fontSize: 13 }}>Business Trip Report — สรุปผลการเดินทาง</b>
                    <textarea rows={3} value={r.report.text} onChange={e => { const v = e.target.value; upd(r.id, n => { n.report.text = v; return n; }); }} />
                    <div>
                      <button type="button" style={btnPrimary} onClick={() => {
                        if (!r.report.text.trim()) { toast.error('สรุปผลการเดินทางก่อนยื่น'); return; }
                        upd(r.id, n => { n.report.submitted = true; return n; }, 'ยื่น Business Trip Report');
                      }}>ยื่น Business Trip Report</button>
                    </div>
                  </div>
                )}
              </div>
            ))) : empty('ไม่มีงานรอผู้เดินทาง')}
          </div>
        </div>
      )}

      {tab === 'approver' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={h3}>รอพิจารณา ({counts.approver}) — ลำดับ Line Manager → Department Head → Executive</h3>
          {mine('approver').length ? mine('approver').map((r) => {
            const lvl = nextApproval(r);
            return reqCard(r, (
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {APPROVAL_LEVELS.map(l => <Check key={l.k} ok={r.appr[l.k]}>{l.label}</Check>)}
                </div>
                {returnFor === r.id ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <input value={reason} onChange={e => setReason(e.target.value)} placeholder="เหตุผลที่ส่งกลับแก้ไข (บังคับ)" style={{ flex: 1, minWidth: 220 }} />
                    <button type="button" style={{ ...btnGhost, color: '#ef4444' }} onClick={() => doReturn(r)}>ยืนยันส่งกลับ</button>
                    <button type="button" style={btnGhost} onClick={() => { setReturnFor(null); setReason(''); }}>ยกเลิก</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.appr[lvl.k] = true; return n; }, `${lvl.label} อนุมัติ`)}>✅ อนุมัติ (ในฐานะ {lvl.label})</button>
                    <button type="button" style={btnGhost} onClick={() => { setReturnFor(r.id); setReason(''); }}>↩ ส่งกลับแก้ไข</button>
                  </div>
                )}
              </div>
            ));
          }) : empty('ไม่มีคำขอรอพิจารณา')}
        </div>
      )}

      {tab === 'hr' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={h3}>รอ HR / Compliance ({counts.hr})</h3>
          {mine('hr').length ? mine('hr').map(r => reqCard(r, (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {!r.hrOk
                ? <button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.hrOk = true; return n; }, 'HR ตรวจสิทธิ์การเดินทาง: ผ่าน')}>🛂 HR: สิทธิ์การเดินทางผ่าน</button>
                : <button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.compOk = true; return n; }, `Compliance ตรวจข้อกำหนด ${r.country}: ผ่าน`)}>📋 Compliance: ข้อกำหนดประเทศ/ลูกค้าผ่าน</button>}
            </div>
          ))) : empty('ไม่มีคำขอรอ HR / Compliance')}
        </div>
      )}

      {tab === 'admin' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* แท็บนี้โชว์ทุกใบที่อยู่ขั้นเตรียมเดินทาง (รวมใบที่รอเอกสาร Visa จากผู้เดินทาง) — ตัวเลขบนแท็บนับเฉพาะที่ Admin กดได้ */}
          <h3 style={h3}>ขั้นเตรียมเดินทาง ({prepItems.length} ใบ · รอ Admin ทำ {counts.admin})</h3>
          {prepItems.length ? prepItems.map((r) => {
            const a = r.admin;
            const blockers = readyBlockers(r);
            const tick = (k, label) => upd(r.id, n => { n.admin[k] = true; return n; }, `Admin: ${label}`);
            const nextStep = ADMIN_STEPS.find(x => !a[x.k]);
            return reqCard(r, (
              <div style={{ display: 'grid', gap: 6 }}>
                <Check ok={a.passport}>ตรวจ Passport (อายุ / ความถูกต้อง)</Check>
                <Check ok={a.visaReq != null}>ต้องใช้ Visa หรือไม่: {a.visaReq == null ? '—' : a.visaReq ? 'ต้องใช้' : 'ไม่ต้องใช้'}</Check>
                {a.visaReq && <Check ok={r.visaDocsSent}>ผู้เดินทางส่งเอกสาร Visa</Check>}
                {a.visaReq && <Check ok={a.visaApplied}>Admin ยื่น Visa และติดตามผล</Check>}
                {ADMIN_STEPS.map(x => <Check key={x.k} ok={a[x.k]}>{x.label}</Check>)}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {!a.passport && <button type="button" style={btnPrimary} onClick={() => tick('passport', 'ตรวจ Passport ผ่าน')}>ตรวจ Passport ผ่าน</button>}
                  {a.passport && a.visaReq == null && (<>
                    <button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.admin.visaReq = true; return n; }, 'Admin: ต้องใช้ Visa — แจ้งผู้เดินทางส่งเอกสาร')}>ต้องใช้ Visa</button>
                    <button type="button" style={btnGhost} onClick={() => upd(r.id, n => { n.admin.visaReq = false; return n; }, 'Admin: ไม่ต้องใช้ Visa')}>ไม่ต้องใช้ Visa</button>
                  </>)}
                  {a.visaReq && !a.visaApplied && (r.visaDocsSent
                    ? <button type="button" style={btnPrimary} onClick={() => tick('visaApplied', 'ยื่น Visa และติดตามผล')}>ยื่น Visa แล้ว</button>
                    : <span style={muted}>รอผู้เดินทางส่งเอกสาร Visa</span>)}
                  {a.passport && a.visaReq != null && (!a.visaReq || a.visaApplied) && nextStep && (
                    <button type="button" style={btnPrimary} onClick={() => tick(nextStep.k, nextStep.label)}>✓ {nextStep.label}</button>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                  <button type="button" style={btnPrimary} disabled={blockers.length > 0}
                    onClick={() => upd(r.id, n => { n.ready = true; return n; }, 'Ready to Travel Check: ยืนยันการเดินทาง')}>🧳 Ready to Travel Check</button>
                  {blockers.length > 0 && <span style={muted}>ยังกดไม่ได้: {blockers.join(' · ')}</span>}
                </div>
              </div>
            ));
          }) : empty('ไม่มีคำขอรอ Travel / Admin')}
        </div>
      )}

      {tab === 'finance' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <h3 style={h3}>รอ Finance / Accounting / ECM ({counts.finance})</h3>
          {mine('finance').length ? mine('finance').map((r) => {
            const f = r.fin;
            const inClose = r.claim.submitted && r.report.submitted;
            const pd = perDiemOf(r);
            const claimSum = claimTotal(r);
            const settle = pd == null ? null : claimSum + pd - (r.adv.paid ? r.advAmount : 0);
            const set = (k, label) => upd(r.id, n => { n.fin[k] = true; return n; }, label);
            return reqCard(r, (
              <div style={{ display: 'grid', gap: 6 }}>
                {!r.budgetOk && (
                  <div><button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.budgetOk = true; return n; }, `Finance ตรวจงบประมาณ ${baht(r.budget)}: ผ่าน`)}>💰 Budget Verification: งบผ่าน</button></div>
                )}
                {r.budgetOk && r.advReq && !r.adv.approved && !r.ready && (
                  <div><button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.adv.approved = true; return n; }, `อนุมัติ Advance ${baht(r.advAmount)}`)}>อนุมัติ Advance {baht(r.advAmount)} (ตามระเบียบ)</button></div>
                )}
                {r.advReq && r.adv.approved && !r.adv.paid && (
                  <div><button type="button" style={btnPrimary} onClick={() => upd(r.id, n => { n.adv.paid = true; return n; }, `โอน Advance ${baht(r.advAmount)} ให้ผู้เดินทาง`)}>โอน Advance ให้ผู้เดินทาง</button></div>
                )}
                {inClose && (
                  <div style={{ display: 'grid', gap: 4 }}>
                    <b style={{ fontSize: 13 }}>Expense Claim</b>
                    {r.claim.lines.length
                      ? r.claim.lines.map((l, i) => (
                        <div key={i} style={{ fontSize: 13 }}>• {l.cat} {baht(l.amount)} <span style={{ color: l.receipt ? '#22c55e' : '#f59e0b' }}>{l.receipt ? '(มีใบเสร็จ)' : '(ไม่มีใบเสร็จ)'}</span></div>))
                      : <div style={muted}>ไม่มีรายการค่าใช้จ่าย</div>}
                    <div style={{ fontSize: 13 }}>รวมค่าใช้จ่าย <b>{baht(claimSum)}</b></div>
                    <div style={{ fontSize: 13 }}>
                      เบี้ยเลี้ยง {pd == null ? 'คำนวณไม่ได้ (วันเดินทางไม่ถูกต้อง)' : <><b>{baht(pd)}</b> <span style={muted}>({tripDays(r.from, r.to)} วัน × {baht(PER_DIEM_SAMPLE)} อัตราตัวอย่าง)</span></>}
                    </div>
                    <div style={{ fontSize: 13 }}>หักล้าง Advance {r.adv.paid ? `− ${baht(r.advAmount)}` : '(ไม่มี)'}</div>
                    {settle != null && (
                      <div style={{ fontSize: 14, fontWeight: 800, color: settle >= 0 ? 'var(--text)' : '#f59e0b' }}>
                        {settle >= 0 ? `บริษัทจ่ายเพิ่มให้ผู้เดินทาง ${baht(settle)}` : `ผู้เดินทางคืนเงินบริษัท ${baht(-settle)}`}
                      </div>
                    )}
                    {r.report.text && <div style={muted}>Trip report: {r.report.text}</div>}
                    {r.claim.lines.some(l => !l.receipt) && <div style={{ fontSize: 12, color: '#f59e0b' }}>⚠ มีรายการที่ไม่มีใบเสร็จ — ตรวจตามนโยบายก่อนผ่าน</div>}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <Check ok={f.verified}>ตรวจค่าใช้จ่าย</Check><Check ok={f.finalOk}>Final Approval</Check>
                      <Check ok={f.posted}>ลงบัญชี</Check><Check ok={f.archived}>ECM ปิดงาน</Check>
                    </div>
                    <div>
                      {!f.verified && <button type="button" style={btnPrimary} onClick={() => set('verified', 'Finance ตรวจค่าใช้จ่าย (ใบเสร็จ/นโยบาย) + คำนวณเบี้ยเลี้ยง + หักล้าง Advance')}>✓ ตรวจค่าใช้จ่ายผ่าน</button>}
                      {f.verified && !f.finalOk && <button type="button" style={btnPrimary} onClick={() => set('finalOk', 'Final Approval อนุมัติค่าใช้จ่าย')}>✓ Final Approval</button>}
                      {f.finalOk && !f.posted && <button type="button" style={btnPrimary} onClick={() => set('posted', 'Accounting ลงบัญชีค่าใช้จ่าย')}>✓ ลงบัญชี</button>}
                      {f.posted && !f.archived && <button type="button" style={btnPrimary} onClick={() => set('archived', 'ECM จัดเก็บเอกสารและปิดงาน')}>🗄️ ECM จัดเก็บเอกสาร / ปิดงาน</button>}
                    </div>
                  </div>
                )}
              </div>
            ));
          }) : empty('ไม่มีงานรอ Finance')}
        </div>
      )}
    </Page>
  );
}
