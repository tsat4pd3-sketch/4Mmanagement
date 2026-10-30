import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import PageHeader from '../components/PageHeader';
import Page from '../components/Page';
import ReadOnlyNote from '../components/ReadOnlyNote';
import InfoMore from '../components/InfoMore';
import FilterBar from '../components/FilterBar';
import SearchInput from '../components/SearchInput';
import CustomerSelect from '../components/CustomerSelect';
import PersonSelect from '../components/PersonSelect';
import useColumnHistory from '../utils/useColumnHistory';
import useTabParam, { useMergeParams } from '../utils/useTabParam';
import { fetchAllRows } from '../utils/fetchAllRows';
import { checkWriteRows } from '../utils/dbWrite';
import { loadDocForms } from '../utils/docForms';
import { statusColor } from '../utils/statusTone';
import { ALL, allOf } from '../utils/filterLabels';
import { todayLocal, fmtDate } from '../utils/dateFormat';
import { nextProjectCode, buildPartRows } from '../utils/npi';
import {
  RFQ_STATUS, RFQ_STATUS_PHASE1, RFQ_OUTCOMES, PROCESS_TYPES, PRIORITIES, VOLUME_SOURCES,
  rfqStatusMeta, isClosed, nextRfqNo, annualSales, awardSummary, npiProjectDraftFromRfq, snapshotDrift,
} from '../utils/mktRfq';
import { issueProductionOrder, reprintProductionOrder } from '../lib/mktProductionOrderDoc';
import { inp, card, btn, ghost, thSt, tdSt, Field, Pill, Modal, WarnBar } from '../components/NpiUi';
import { DeleteButton } from '../components/IconButton';

/* ═══════════════════════════════════════════════════════════════════════════
   💼 RFQ / เสนอราคา — Marketing (Q-neX เฟส 1) — /rfq · 2026-10-30
   แบบเต็ม: docs/MARKETING-QNEX-DESIGN.md · กฎโมดูล: docs/modules/mkt-rfq.md

   ทำอะไร (เฟส 1 = ปิดลูปทั้งสายให้ต่อกันก่อน — ยังไม่มี auto-calc / มอบงานแผนก):
     📋 รายการ   — ทะเบียน RFQ (ตาราง) → ใบงาน: พาร์ท/ชิ้นย่อย · volume (บอกที่มา) · สถานะ
                    · CRD → สร้าง/ผูกโปรเจค NPI (ระบบเสนอ คนยืนยัน) · ผลได้งาน/ไม่ได้งาน
                    · ได้งาน → ออกใบแจ้งจัดทำ F-MKT-001/002 ให้โรงงาน (เขียนทะเบียนก่อนพิมพ์)
     📈 ผลงาน    — สรุปได้/ไม่ได้งาน + ยอดขายต่อปี แบบ Model Report

   ใครใช้: Marketing (เจ้าของ · role marketing) · IEC/engineer_nm ดู CRD ที่ส่งมา · ผู้จัดการ
   ข้อจำกัด/ห้าม:
     · ตาราง mkt_* อยู่ Main เท่านั้น (มีราคา — DR เป็น anon-open)
     · สถานะ/เลข running/ยอดขาย/snapshot ใบ คิดใน src/utils/mktRfq.js เท่านั้น
     · สี = statusColor(tone) จาก statusTone.js — ห้ามตั้ง hex ในหน้า
     · เลขพาร์ทลูกค้าใน RFQ เป็นของใหม่ (ยังไม่มีในทะเบียนไหน) ⇒ พิมพ์เองได้โดยตั้งใจ
   ═══════════════════════════════════════════════════════════════════════════ */

const TABS = [{ key: 'list', label: '📋 รายการ RFQ' }, { key: 'report', label: '📈 ได้งาน / ไม่ได้งาน' }];
const RFQ_COLS = 'id, rfq_no, customer, model, title, process_type, priority, received_date, due_date, sop_date_customer, status, '
  + 'customer_target_price, annual_volume, volume_source, apw, mpw, crd_no, crd_sent_at, npi_project_id, owner_name, remark, created_by_name, created_at';
const AWARD_COLS = 'id, rfq_id, outcome, decided_at, loss_reason, unit_price, tooling_price, annual_volume, annual_sales, po_no, to_no, '
  + 'production_order_no, production_order_snapshot, production_order_issued_at, production_order_issued_by, reprint_count, decided_by_name';
const emptyRfq = { rfq_no: '', customer: '', model: '', title: '', process_type: 'steel', priority: 'normal', received_date: '', due_date: '',
  sop_date_customer: '', status: 'received', customer_target_price: '', annual_volume: '', volume_source: '', apw: '', mpw: '', owner_name: '', remark: '' };
const emptyPart = { part_no: '', part_name: '', parent_part_id: '', material_spec: '', thickness_mm: '', qty_per: 1, coating: '', cad_revision: '', remark: '' };
const num = (v) => (v === '' || v == null ? null : Number(v));
const fmtN = (v, d = 0) => (v == null || v === '' ? '—' : Number(v).toLocaleString('th-TH', { minimumFractionDigits: d, maximumFractionDigits: d }));

export default function Rfq() {
  const { role, fullName } = useContext(UserContext);
  const canEdit = can('rfq', 'edit', role);
  const canAward = can('rfq', 'award', role);
  const [tab, setTab] = useTabParam(TABS.map(t => t.key), 'list');
  const [sp] = useSearchParams();
  const setParams = useMergeParams();
  const rfqId = sp.get('rfq') || '';
  const today = todayLocal();
  const custHist = useColumnHistory(supabase, 'mkt_rfqs', 'customer');
  const ownerHist = useColumnHistory(supabase, 'mkt_rfqs', 'owner_name');

  const [rfqs, setRfqs] = useState([]);
  const [awards, setAwards] = useState([]);
  const [npiProjects, setNpiProjects] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [warn, setWarn] = useState('');
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fCust, setFCust] = useState('');
  const [rfqModal, setRfqModal] = useState(null);
  const [partModal, setPartModal] = useState(null);
  const [npiModal, setNpiModal] = useState(null);
  const [awardModal, setAwardModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const setRfq = useCallback((id) => setParams({ rfq: id || null }), [setParams]);

  /* ── โหลดทะเบียน (ทั้งหมดแบบ paginate — RFQ โตตามการใช้งาน) ── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    const w = [];
    const [r, a, pj, t, tp, td] = await Promise.all([
      fetchAllRows(supabase, 'mkt_rfqs', RFQ_COLS, qq => qq.order('created_at', { ascending: false })),
      fetchAllRows(supabase, 'mkt_awards', AWARD_COLS),
      supabase.from('npi_projects').select('id, project_code, name, customer, model, sop_date, status').order('created_at', { ascending: false }),
      supabase.from('npi_templates').select('id, code, label, customer, is_active, sort').eq('is_active', true).order('sort'),
      supabase.from('npi_template_phases').select('*').order('seq'),
      supabase.from('npi_template_deliverables').select('*').eq('is_active', true).order('seq'),
    ]);
    if (r.error) w.push(`โหลดทะเบียน RFQ ไม่ได้ (${r.error.message}) — ยังไม่ apply migration 20261030b_mkt_rfq_phase1_main (MAIN) ?`);
    if (a.error) w.push(`โหลดผลได้งาน/ไม่ได้งานไม่ได้ (${a.error.message})`);
    if (pj.error || t.error) w.push('โหลดทะเบียน NPI ไม่ได้ — ผูก/สร้างโปรเจค NPI จากหน้านี้ไม่ได้');
    setRfqs(r.data || []); setAwards(a.data || []); setNpiProjects(pj.data || []);
    setTemplates((t.data || []).map(x => ({ ...x, phases: (tp.data || []).filter(p => p.template_id === x.id), delivs: (td.data || []).filter(d => d.template_id === x.id) })));
    setWarn(w.join(' · ')); setLoading(false);
  }, []);
  useEffect(() => { loadAll(); loadDocForms(); }, [loadAll]);

  /* ── พาร์ทของ RFQ ที่เลือก ── */
  const loadParts = useCallback(async (id) => {
    if (!id) { setParts([]); return; }
    const { data, error } = await supabase.from('mkt_rfq_parts').select('*').eq('rfq_id', id).order('sort').order('created_at');
    if (error) { toast.error(`โหลดพาร์ทไม่ได้: ${error.message}`); setParts([]); return; }
    setParts(data || []);
  }, []);
  useEffect(() => { let alive = true; (async () => { if (!alive) return; await loadParts(rfqId); })(); return () => { alive = false; }; }, [rfqId, loadParts]);

  const awardOf = useMemo(() => { const m = {}; awards.forEach(a => { m[a.rfq_id] = a; }); return m; }, [awards]);
  const rfq = rfqs.find(r => r.id === rfqId) || null;
  const award = rfq ? awardOf[rfq.id] || null : null;
  const npiOf = useMemo(() => { const m = {}; npiProjects.forEach(p => { m[p.id] = p; }); return m; }, [npiProjects]);

  /* ── ตัวกรอง (การดู ไม่ใช่ด่าน) ── */
  const customers = useMemo(() => [...new Set(rfqs.map(r => r.customer).filter(Boolean))].sort(), [rfqs]);
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return rfqs.filter(r => (!fStatus || r.status === fStatus) && (!fCust || r.customer === fCust)
      && (!qq || [r.rfq_no, r.customer, r.model, r.title, r.crd_no, r.owner_name].some(v => String(v || '').toLowerCase().includes(qq))));
  }, [rfqs, q, fStatus, fCust]);
  const hidden = rfqs.length - filtered.length;

  /* ── CRUD RFQ ── */
  const saveRfq = async () => {
    const m = rfqModal;
    if (!m.customer?.trim()) return toast.error('เลือกลูกค้า');
    if (m.annual_volume !== '' && m.annual_volume != null && !m.volume_source) return toast.error('ใส่ volume แล้วต้องบอกที่มาด้วย (RFQ / ประมาณการขาย / Model Report)');
    setSaving(true);
    const row = {
      rfq_no: m.rfq_no?.trim() || nextRfqNo(rfqs.map(r => r.rfq_no), today),
      customer: m.customer.trim(), model: m.model?.trim() || null, title: m.title?.trim() || null,
      process_type: m.process_type || 'steel', priority: m.priority || 'normal',
      received_date: m.received_date || null, due_date: m.due_date || null, sop_date_customer: m.sop_date_customer || null,
      status: m.status || 'received',
      customer_target_price: num(m.customer_target_price), annual_volume: num(m.annual_volume), volume_source: m.volume_source || null,
      apw: num(m.apw), mpw: num(m.mpw), owner_name: m.owner_name?.trim() || null, remark: m.remark?.trim() || null,
    };
    const res = m.id
      ? await supabase.from('mkt_rfqs').update(row).eq('id', m.id).select('id')
      : await supabase.from('mkt_rfqs').insert({ ...row, created_by_name: fullName || null }).select('id');
    setSaving(false);
    if (!checkWriteRows(res, 'บันทึก RFQ')) return;
    toast.success('บันทึก RFQ แล้ว'); setRfqModal(null); await loadAll();
    if (!m.id) setRfq(res.data[0].id);
  };
  const delRfq = async (r) => {
    if (awardOf[r.id]) return toast.info('RFQ นี้มีผลตัดสินแล้ว — ลบไม่ได้ ให้เปลี่ยนสถานะเป็น "ยกเลิก" แทน');
    if (!window.confirm(`ลบ ${r.rfq_no} (${r.customer || '—'}) พร้อมพาร์ททั้งหมด?`)) return;
    if (!checkWriteRows(await supabase.from('mkt_rfqs').delete().eq('id', r.id).select('id'), 'ลบ RFQ')) return;
    toast.success('ลบแล้ว'); setRfq(''); loadAll();
  };
  const setStatus = async (s) => {
    if (!rfq) return;
    if (!checkWriteRows(await supabase.from('mkt_rfqs').update({ status: s }).eq('id', rfq.id).select('id'), 'เปลี่ยนสถานะ')) return;
    loadAll();
  };

  /* ── CRUD พาร์ท ── */
  const savePart = async () => {
    const m = partModal;
    if (!m.part_no?.trim()) return toast.error('กรอก Part No.');
    setSaving(true);
    const row = {
      part_no: m.part_no.trim(), part_name: m.part_name?.trim() || null, parent_part_id: m.parent_part_id || null,
      material_spec: m.material_spec?.trim() || null, thickness_mm: num(m.thickness_mm), qty_per: Number(m.qty_per) || 1,
      coating: m.coating?.trim() || null, cad_revision: m.cad_revision?.trim() || null, remark: m.remark?.trim() || null,
      sort: m.sort ?? parts.length,
    };
    const res = m.id
      ? await supabase.from('mkt_rfq_parts').update(row).eq('id', m.id).select('id')
      : await supabase.from('mkt_rfq_parts').insert({ ...row, rfq_id: rfq.id }).select('id');
    setSaving(false);
    if (!checkWriteRows(res, 'บันทึกพาร์ท')) return;
    toast.success('บันทึกพาร์ทแล้ว'); setPartModal(null); loadParts(rfq.id);
  };
  const delPart = async (p) => {
    if (!window.confirm(`ลบพาร์ท ${p.part_no}?`)) return;
    if (!checkWriteRows(await supabase.from('mkt_rfq_parts').delete().eq('id', p.id).select('id'), 'ลบพาร์ท')) return;
    toast.success('ลบแล้ว'); loadParts(rfq.id);
  };

  /* ── CRD → โปรเจค NPI (ระบบเสนอ คนยืนยัน) ── */
  const openNpiModal = () => {
    const d = npiProjectDraftFromRfq(rfq, parts);
    setNpiModal({ mode: rfq.npi_project_id ? 'link' : 'create', existing_id: rfq.npi_project_id || '', template_id: templates[0]?.id || '',
      name: d.name, customer: d.customer, model: d.model, kickoff_date: today, sop_date: d.sop_date, description: d.description,
      crd_no: rfq.crd_no || '', crd_sent_at: rfq.crd_sent_at || today, parts: d.parts.map(p => ({ ...p, on: true })) });
  };
  const saveNpi = async () => {
    const m = npiModal;
    setSaving(true);
    let projectId = m.existing_id || null;
    if (m.mode === 'create') {
      if (!m.name.trim()) { setSaving(false); return toast.error('กรอกชื่อโปรเจค'); }
      const tpl = templates.find(t => t.id === m.template_id);
      if (!tpl) { setSaving(false); return toast.error('เลือกแม่แบบเฟส (ลูกค้า) — ยังไม่มีแม่แบบ ให้ไปตั้งที่ /npi แท็บ ⚙️'); }
      const resP = await supabase.from('npi_projects').insert({
        project_code: nextProjectCode(npiProjects.map(p => p.project_code), today),
        name: m.name.trim(), customer: m.customer || null, model: m.model || null, template_id: tpl.id,
        kickoff_date: m.kickoff_date || null, sop_date: m.sop_date || null, status: 'planning',
        description: m.description || null, created_by_name: fullName || null,
      }).select('id');
      if (!checkWriteRows(resP, 'สร้างโปรเจค NPI')) { setSaving(false); return; }
      projectId = resP.data[0].id;
      // พาร์ทแม่ของ RFQ → npi_parts + เฟส/รายการเอกสารจากแม่แบบ (snapshot — ท่าเดียวกับ /npi)
      const fails = [];
      for (const p of m.parts.filter(x => x.on)) {
        const r1 = await supabase.from('npi_parts').insert({ project_id: projectId, part_no: p.part_no, part_name: p.part_name || null }).select('id');
        if (r1.error || !r1.data?.length) { fails.push(`${p.part_no}: ${r1.error?.message || '0 แถว'}`); continue; }
        const { phaseRows, delivRows } = buildPartRows({ partId: r1.data[0].id, templatePhases: tpl.phases, templateDelivs: tpl.delivs, sopDate: m.sop_date || null, kickoffDate: m.kickoff_date || null });
        const e1 = phaseRows.length ? (await supabase.from('npi_part_phases').insert(phaseRows)).error : null;
        const e2 = delivRows.length ? (await supabase.from('npi_deliverables').insert(delivRows)).error : null;
        if (e1 || e2) fails.push(`${p.part_no}: เฟส/เอกสาร ${(e1 || e2).message}`);
      }
      if (fails.length) toast.error(`สร้างโปรเจคแล้ว แต่พาร์ทไม่ครบ: ${fails.join(' · ')} — ไปเติมที่ /npi`);
    }
    if (!projectId) { setSaving(false); return toast.error('เลือกโปรเจค NPI ที่จะผูก'); }
    const res = await supabase.from('mkt_rfqs').update({
      npi_project_id: projectId, crd_no: m.crd_no?.trim() || null, crd_sent_at: m.crd_sent_at || null,
      ...(rfq.status === 'received' ? { status: 'assessing' } : {}),
    }).eq('id', rfq.id).select('id');
    setSaving(false);
    if (!checkWriteRows(res, 'ผูกโปรเจค NPI')) return;
    toast.success(m.mode === 'create' ? 'สร้างโปรเจค NPI และผูกกับ RFQ แล้ว' : 'ผูกโปรเจค NPI แล้ว');
    setNpiModal(null); loadAll();
  };

  /* ── ผลได้งาน/ไม่ได้งาน ── */
  const openAward = () => setAwardModal({
    outcome: award?.outcome || 'awarded', decided_at: award?.decided_at || today, loss_reason: award?.loss_reason || '',
    unit_price: award?.unit_price ?? '', tooling_price: award?.tooling_price ?? '', annual_volume: award?.annual_volume ?? rfq.annual_volume ?? '',
    po_no: award?.po_no || '', to_no: award?.to_no || '',
  });
  const saveAward = async () => {
    const m = awardModal;
    if (m.outcome === 'lost' && !m.loss_reason.trim()) return toast.error('ไม่ได้งานต้องบันทึกเหตุผล (Lost reason)');
    if (award?.production_order_no && m.outcome !== 'awarded') return toast.error('ออกใบแจ้งจัดทำไปแล้ว — เปลี่ยนผลเป็นไม่ได้งาน/ยกเลิกไม่ได้ (ติดต่อ admin ถ้าออกใบผิด)');
    setSaving(true);
    const row = {
      rfq_id: rfq.id, outcome: m.outcome, decided_at: m.decided_at || null, loss_reason: m.loss_reason?.trim() || null,
      unit_price: num(m.unit_price), tooling_price: num(m.tooling_price), annual_volume: num(m.annual_volume),
      annual_sales: annualSales(m.annual_volume, m.unit_price),       // ขาดตัวใดตัวหนึ่ง = null (ห้าม 0)
      po_no: m.po_no?.trim() || null, to_no: m.to_no?.trim() || null, decided_by_name: fullName || null,
    };
    // upsert คีย์ = rfq_id (unique index คอลัมน์ล้วน — กฎเขียน DB ข้อ 3) · ต้องมี policy UPDATE ด้วย (มี)
    const res = await supabase.from('mkt_awards').upsert(row, { onConflict: 'rfq_id' }).select('id');
    if (!checkWriteRows(res, 'บันทึกผล')) { setSaving(false); return; }
    const r2 = await supabase.from('mkt_rfqs').update({ status: m.outcome }).eq('id', rfq.id).select('id');
    setSaving(false);
    if (!checkWriteRows(r2, 'อัปเดตสถานะ RFQ')) return;
    toast.success('บันทึกผลแล้ว'); setAwardModal(null); loadAll();
  };
  const doIssue = async () => {
    const r = await issueProductionOrder({ rfq, parts, award, actorName: fullName || null });
    if (!r.ok) return toast.error(r.reason);
    if (r.printed === false) toast.info('ออกเลขใบแล้ว แต่เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กด "พิมพ์ซ้ำ" ได้');
    loadAll();
  };
  const doReprint = async () => {
    const r = await reprintProductionOrder({ award });
    if (!r.ok) return toast.error(r.reason);
    loadAll();
  };

  const mainParts = parts.filter(p => !p.parent_part_id);
  const sub = rfq ? `${rfq.rfq_no} · ${rfq.customer || '—'} · ${rfqStatusMeta(rfq.status).label}` : `${rfqs.length} RFQ · เลือกรายการเพื่อเปิดใบงาน`;
  const statusOptions = useMemo(() => {
    const keys = [...RFQ_STATUS_PHASE1];
    if (rfq && !keys.includes(rfq.status)) keys.push(rfq.status);
    return keys.filter(k => !isClosed(k) || k === rfq?.status);
  }, [rfq]);

  return (
    <Page>
      <PageHeader title="RFQ / เสนอราคา — Marketing" icon="💼" sub={sub}
        filters={tab === 'list' && (
          <FilterBar onClear={() => { setQ(''); setFStatus(''); setFCust(''); }}>
            <SearchInput value={q} onChange={setQ} placeholder="ค้น เลข RFQ / ลูกค้า / รุ่น / CRD…" />
            <select value={fStatus} onChange={e => setFStatus(e.target.value)}>
              <option value="">{ALL.status}</option>
              {Object.keys(RFQ_STATUS).map(k => <option key={k} value={k}>{RFQ_STATUS[k].label}</option>)}
            </select>
            <select value={fCust} onChange={e => setFCust(e.target.value)}>
              <option value="">{ALL.customer}</option>
              {customers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FilterBar>
        )}
        actions={<>
          {rfq && <button style={ghost} onClick={() => setRfq('')}>← รายการ</button>}
          {canEdit && <button style={btn()} onClick={() => setRfqModal({ ...emptyRfq, rfq_no: nextRfqNo(rfqs.map(r => r.rfq_no), today), received_date: today })}>+ RFQ</button>}
        </>}
        tabs={TABS} tab={tab} onTab={setTab} />

      <WarnBar>{warn}</WarnBar>
      <ReadOnlyNote show={!canEdit} role={role} what="สร้าง/แก้ RFQ · พาร์ท · ส่ง CRD / ผูกโปรเจค NPI" permKey="rfq:edit" />
      {canEdit && !canAward && <ReadOnlyNote role={role} what="บันทึกผลได้งาน/ไม่ได้งาน · ออกใบแจ้งจัดทำ" permKey="rfq:award" compact />}
      <InfoMore id="rfq_help" lead="ต้นน้ำของสายธาร Marketing → New Model → โรงงาน (Q-neX เฟส 1)">
        รับ RFQ จากลูกค้า → บันทึกพาร์ท/volume → <b>ส่ง CRD</b> ให้ IEC = สร้างโปรเจค NPI จากหน้านี้ (ระบบเสนอชื่อ/พาร์ท คนยืนยัน) →
        ลูกค้าตัดสิน → <b>ได้งาน</b> = ออก <b>ใบแจ้งจัดทำ F-MKT-001/002</b> ให้ฝ่ายโรงงาน (ออกเลขแล้วพิมพ์ซ้ำได้ ใบเดิมเสมอ) ·
        ยอดขาย/ปี = volume × ราคาชิ้น (ขาดตัวใดตัวหนึ่ง = ไม่คิด ไม่ใช่ 0) · volume ต้องบอกที่มาเสมอ (RFQ มี 3 ชุดคนละค่า) ·
        ยังไม่ทำ (เฟส 2-3): มอบงานแผนก IEC/RDPP/Purchasing · checklist gate · คำนวณต้นทุน ①–⑤ · ใบเสนอราคา 2 ชั้นอนุมัติ
      </InfoMore>

      {loading ? <div style={{ color: 'var(--muted)', padding: 30 }}>กำลังโหลด…</div> : tab === 'report' ? (
        <ReportTab rfqs={rfqs} awards={awards} onOpen={(id) => { setRfq(id); setTab('list'); }} />
      ) : rfq ? (
        <RfqSheet rfq={rfq} award={award} parts={parts} mainParts={mainParts} npi={npiOf[rfq.npi_project_id]} canEdit={canEdit} canAward={canAward}
          statusOptions={statusOptions} onStatus={setStatus} onEdit={() => setRfqModal({ ...emptyRfq, ...rfq, customer_target_price: rfq.customer_target_price ?? '', annual_volume: rfq.annual_volume ?? '', apw: rfq.apw ?? '', mpw: rfq.mpw ?? '' })}
          onDel={() => delRfq(rfq)} onAddPart={() => setPartModal({ ...emptyPart })} onEditPart={(p) => setPartModal({ ...emptyPart, ...p, parent_part_id: p.parent_part_id || '', thickness_mm: p.thickness_mm ?? '' })}
          onDelPart={delPart} onNpi={openNpiModal} onAward={openAward} onIssue={doIssue} onReprint={doReprint} today={today} />
      ) : (
        <RfqTable rows={filtered} hidden={hidden} awardOf={awardOf} npiOf={npiOf} onPick={setRfq} today={today} />
      )}

      {rfqId && !rfq && !loading && <WarnBar color="#f59e0b">ไม่พบ RFQ ตามลิงก์นี้ (อาจถูกลบ หรือคุณไม่มีสิทธิ์เห็น) — <button style={ghost} onClick={() => setRfq('')}>กลับไปรายการ</button></WarnBar>}

      {rfqModal && (
        <Modal title={rfqModal.id ? `✏️ ${rfqModal.rfq_no}` : '+ RFQ ใหม่'} onClose={() => setRfqModal(null)} width={760}
          footer={<><button style={ghost} onClick={() => setRfqModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveRfq}>💾 บันทึก</button></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, alignItems: 'start' }}>
            <Field label="เลข RFQ" hint="ระบบออกให้ แก้ได้"><input style={inp} value={rfqModal.rfq_no} onChange={e => setRfqModal({ ...rfqModal, rfq_no: e.target.value })} /></Field>
            <Field label="ลูกค้า (OEM)" span={2}><CustomerSelect value={rfqModal.customer} onChange={({ customer }) => setRfqModal({ ...rfqModal, customer })} history={custHist} /></Field>
            <Field label="รุ่น / โปรแกรม" hint="MY2020 T6"><input style={inp} value={rfqModal.model} onChange={e => setRfqModal({ ...rfqModal, model: e.target.value })} /></Field>
            <Field label="ชื่องาน (สั้นๆ)" span={2}><input style={inp} value={rfqModal.title} onChange={e => setRfqModal({ ...rfqModal, title: e.target.value })} placeholder="ว่าง = ใช้ชื่อพาร์ทแรก" /></Field>
            <Field label="ชนิดงาน"><select style={inp} value={rfqModal.process_type} onChange={e => setRfqModal({ ...rfqModal, process_type: e.target.value })}>{Object.entries(PROCESS_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="ความเร่งด่วน"><select style={inp} value={rfqModal.priority} onChange={e => setRfqModal({ ...rfqModal, priority: e.target.value })}>{Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="ผู้รับผิดชอบ (MKT Engineer)"><PersonSelect value={rfqModal.owner_name} onChange={(v) => setRfqModal({ ...rfqModal, owner_name: typeof v === 'string' ? v : (v?.name || '') })} history={ownerHist} /></Field>
            <Field label="วันรับ RFQ"><input type="date" style={inp} value={rfqModal.received_date || ''} onChange={e => setRfqModal({ ...rfqModal, received_date: e.target.value })} /></Field>
            <Field label="กำหนดส่งใบเสนอราคา"><input type="date" style={inp} value={rfqModal.due_date || ''} onChange={e => setRfqModal({ ...rfqModal, due_date: e.target.value })} /></Field>
            <Field label="SOP ที่ลูกค้ากำหนด"><input type="date" style={inp} value={rfqModal.sop_date_customer || ''} onChange={e => setRfqModal({ ...rfqModal, sop_date_customer: e.target.value })} /></Field>
            <Field label="Volume / ปี (ชิ้น)"><input type="number" style={inp} value={rfqModal.annual_volume} onChange={e => setRfqModal({ ...rfqModal, annual_volume: e.target.value })} /></Field>
            <Field label="ที่มาของ volume" hint="บังคับเมื่อใส่ volume" span={2}>
              <select style={inp} value={rfqModal.volume_source || ''} onChange={e => setRfqModal({ ...rfqModal, volume_source: e.target.value })}>
                <option value="">— ระบุที่มา —</option>{Object.entries(VOLUME_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="APW (ชิ้น/สัปดาห์ เฉลี่ย)"><input type="number" style={inp} value={rfqModal.apw} onChange={e => setRfqModal({ ...rfqModal, apw: e.target.value })} /></Field>
            <Field label="MPW (ชิ้น/สัปดาห์ สูงสุด)"><input type="number" style={inp} value={rfqModal.mpw} onChange={e => setRfqModal({ ...rfqModal, mpw: e.target.value })} /></Field>
            <Field label="🔒 ราคาเป้าหมายลูกค้า (THB/pc)" hint="MKT เห็นคนเดียว"><input type="number" step="0.01" style={inp} value={rfqModal.customer_target_price} onChange={e => setRfqModal({ ...rfqModal, customer_target_price: e.target.value })} /></Field>
            <Field label="หมายเหตุ" span={3}><textarea style={{ ...inp, minHeight: 56 }} value={rfqModal.remark || ''} onChange={e => setRfqModal({ ...rfqModal, remark: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {partModal && rfq && (
        <Modal title={partModal.id ? `✏️ ${partModal.part_no}` : '+ พาร์ท / ชิ้นย่อย'} onClose={() => setPartModal(null)} width={720}
          footer={<><button style={ghost} onClick={() => setPartModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={savePart}>💾 บันทึก</button></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, alignItems: 'start' }}>
            <Field label="Part No. (ของลูกค้า)" hint="พาร์ทใหม่ ยังไม่มีในทะเบียน"><input style={inp} value={partModal.part_no} onChange={e => setPartModal({ ...partModal, part_no: e.target.value })} placeholder="MB3C-2B614-AA" /></Field>
            <Field label="Part Name" span={2}><input style={inp} value={partModal.part_name || ''} onChange={e => setPartModal({ ...partModal, part_name: e.target.value })} /></Field>
            <Field label="เป็นชิ้นย่อยของ" hint="ว่าง = พาร์ทแม่ (assy)">
              <select style={inp} value={partModal.parent_part_id || ''} onChange={e => setPartModal({ ...partModal, parent_part_id: e.target.value })}>
                <option value="">— พาร์ทแม่ —</option>{mainParts.filter(p => p.id !== partModal.id).map(p => <option key={p.id} value={p.id}>{p.part_no}</option>)}
              </select>
            </Field>
            <Field label="จำนวนต่อชิ้นแม่"><input type="number" min="1" style={inp} value={partModal.qty_per} onChange={e => setPartModal({ ...partModal, qty_per: e.target.value })} /></Field>
            <Field label="CAD rev"><input style={inp} value={partModal.cad_revision || ''} onChange={e => setPartModal({ ...partModal, cad_revision: e.target.value })} /></Field>
            <Field label="วัตถุดิบ (spec)"><input style={inp} value={partModal.material_spec || ''} onChange={e => setPartModal({ ...partModal, material_spec: e.target.value })} placeholder="WSS-M1A367-A46" /></Field>
            <Field label="ความหนา (mm)"><input type="number" step="0.1" style={inp} value={partModal.thickness_mm} onChange={e => setPartModal({ ...partModal, thickness_mm: e.target.value })} /></Field>
            <Field label="ผิว / เคลือบ"><input style={inp} value={partModal.coating || ''} onChange={e => setPartModal({ ...partModal, coating: e.target.value })} placeholder="EDP · E-COATED PER …" /></Field>
            <Field label="หมายเหตุ" span={3}><input style={inp} value={partModal.remark || ''} onChange={e => setPartModal({ ...partModal, remark: e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {npiModal && rfq && (
        <Modal title="📨 ส่ง CRD → โปรเจค NPI (IEC)" onClose={() => setNpiModal(null)} width={760}
          footer={<><button style={ghost} onClick={() => setNpiModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveNpi}>{npiModal.mode === 'create' ? '🚀 สร้างโปรเจค + ผูก' : '🔗 ผูกโปรเจค'}</button></>}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button style={npiModal.mode === 'create' ? btn() : ghost} onClick={() => setNpiModal({ ...npiModal, mode: 'create' })}>สร้างโปรเจคใหม่จาก RFQ นี้</button>
            <button style={npiModal.mode === 'link' ? btn() : ghost} onClick={() => setNpiModal({ ...npiModal, mode: 'link' })}>ผูกโปรเจคที่มีอยู่แล้ว</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, alignItems: 'start' }}>
            <Field label="เลขที่ CRD" hint="เช่น MKT1/136/2020"><input style={inp} value={npiModal.crd_no} onChange={e => setNpiModal({ ...npiModal, crd_no: e.target.value })} /></Field>
            <Field label="วันส่ง CRD"><input type="date" style={inp} value={npiModal.crd_sent_at || ''} onChange={e => setNpiModal({ ...npiModal, crd_sent_at: e.target.value })} /></Field>
            {npiModal.mode === 'link' ? (
              <Field label="โปรเจค NPI">
                <select style={inp} value={npiModal.existing_id} onChange={e => setNpiModal({ ...npiModal, existing_id: e.target.value })}>
                  <option value="">— เลือก —</option>{npiProjects.map(p => <option key={p.id} value={p.id}>{p.project_code} · {p.name}</option>)}
                </select>
              </Field>
            ) : (<>
              <Field label="แม่แบบเฟส (ลูกค้า)">
                <select style={inp} value={npiModal.template_id} onChange={e => setNpiModal({ ...npiModal, template_id: e.target.value })}>
                  {!templates.length && <option value="">ไม่มีแม่แบบ — ตั้งที่ /npi ⚙️</option>}
                  {templates.map(t => <option key={t.id} value={t.id}>{t.label}{t.customer ? ` (${t.customer})` : ''}</option>)}
                </select>
              </Field>
              <Field label="ชื่อโปรเจค (ระบบเสนอ แก้ได้)" span={2}><input style={inp} value={npiModal.name} onChange={e => setNpiModal({ ...npiModal, name: e.target.value })} /></Field>
              <Field label="Kickoff"><input type="date" style={inp} value={npiModal.kickoff_date || ''} onChange={e => setNpiModal({ ...npiModal, kickoff_date: e.target.value })} /></Field>
              <Field label="SOP" hint="จาก RFQ"><input type="date" style={inp} value={npiModal.sop_date || ''} onChange={e => setNpiModal({ ...npiModal, sop_date: e.target.value })} /></Field>
              <Field label="พาร์ทที่จะสร้างใน NPI" span={3}>
                {!npiModal.parts.length ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>RFQ นี้ยังไม่มีพาร์ทแม่ — สร้างโปรเจคเปล่าได้ แล้วไปเพิ่มพาร์ทที่ /npi</div>
                  : npiModal.parts.map((p, i) => (
                    <label key={p.part_no} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '3px 0' }}>
                      <input type="checkbox" checked={p.on} onChange={e => setNpiModal({ ...npiModal, parts: npiModal.parts.map((x, j) => j === i ? { ...x, on: e.target.checked } : x) })} />
                      <b>{p.part_no}</b> <span style={{ color: 'var(--muted)' }}>{p.part_name || ''}</span>
                    </label>
                  ))}
              </Field>
            </>)}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
            สร้างแล้วเฟส/รายการเอกสารมาจากแม่แบบที่เลือก (snapshot) · สถานะ RFQ จะเลื่อนเป็น "IEC กำลังประเมิน" · ระบบ<b>ไม่</b>เขียนทับสิ่งที่ IEC ทำไว้ใน NPI
          </div>
        </Modal>
      )}

      {awardModal && rfq && (
        <Modal title={`🏁 ผลของ ${rfq.rfq_no}`} onClose={() => setAwardModal(null)} width={700}
          footer={<><button style={ghost} onClick={() => setAwardModal(null)}>ยกเลิก</button><button style={btn()} disabled={saving} onClick={saveAward}>💾 บันทึกผล</button></>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10, alignItems: 'start' }}>
            <Field label="ผล">
              <select style={inp} value={awardModal.outcome} onChange={e => setAwardModal({ ...awardModal, outcome: e.target.value })}>
                {Object.entries(RFQ_OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="วันที่ตัดสิน"><input type="date" style={inp} value={awardModal.decided_at || ''} onChange={e => setAwardModal({ ...awardModal, decided_at: e.target.value })} /></Field>
            <Field label="Volume/ปี ที่ใช้คิดยอด" hint={rfq.annual_volume != null ? `RFQ: ${fmtN(rfq.annual_volume)}` : 'RFQ ไม่มี volume'}><input type="number" style={inp} value={awardModal.annual_volume} onChange={e => setAwardModal({ ...awardModal, annual_volume: e.target.value })} /></Field>
            <Field label="ราคาชิ้น (THB/pc)"><input type="number" step="0.01" style={inp} value={awardModal.unit_price} onChange={e => setAwardModal({ ...awardModal, unit_price: e.target.value })} /></Field>
            <Field label="ราคาแม่พิมพ์/JIG (THB)"><input type="number" step="0.01" style={inp} value={awardModal.tooling_price} onChange={e => setAwardModal({ ...awardModal, tooling_price: e.target.value })} /></Field>
            <Field label="ยอดขาย/ปี (คำนวณ)"><div style={{ ...inp, background: 'transparent', fontWeight: 800 }}>{(() => { const s = annualSales(awardModal.annual_volume, awardModal.unit_price); return s == null ? 'ยังคิดไม่ได้ (ขาด volume/ราคา)' : `${fmtN(s, 2)} THB`; })()}</div></Field>
            {awardModal.outcome === 'awarded' && (<>
              <Field label="PO จากลูกค้า"><input style={inp} value={awardModal.po_no} onChange={e => setAwardModal({ ...awardModal, po_no: e.target.value })} /></Field>
              <Field label="Tool Order (TO)"><input style={inp} value={awardModal.to_no} onChange={e => setAwardModal({ ...awardModal, to_no: e.target.value })} /></Field>
            </>)}
            {awardModal.outcome === 'lost' && (
              <Field label="เหตุผลที่ไม่ได้งาน (บังคับ)" span={3}><textarea style={{ ...inp, minHeight: 56 }} value={awardModal.loss_reason} onChange={e => setAwardModal({ ...awardModal, loss_reason: e.target.value })} /></Field>
            )}
          </div>
        </Modal>
      )}
    </Page>
  );
}

/* ── ตารางทะเบียน (UI §6.25 — รายการที่โตตามการใช้งาน = ตาราง) ── */
function RfqTable({ rows, hidden, awardOf, npiOf, onPick, today }) {
  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
        <table className="rec-list" style={{ width: '100%' }}>
          <thead><tr>
            <th style={thSt}>เลข RFQ</th><th style={thSt}>ลูกค้า</th><th style={thSt}>รุ่น / งาน</th><th style={thSt}>ชนิด</th>
            <th style={thSt}>สถานะ</th><th style={{ ...thSt, textAlign: 'right' }}>Volume/ปี</th><th style={thSt}>กำหนดส่ง</th><th style={thSt}>CRD / NPI</th><th style={thSt}>ผล</th>
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const st = rfqStatusMeta(r.status); const a = awardOf[r.id]; const late = r.due_date && !isClosed(r.status) && r.due_date < today;
              return (
                <tr key={r.id} className={r.priority === 'urgent' && !isClosed(r.status) ? 'rec-row-alert' : ''} onClick={() => onPick(r.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onPick(r.id)}>
                  <td style={tdSt}><b>{r.rfq_no}</b>{r.priority === 'urgent' && <span style={{ marginLeft: 6, fontSize: 11, color: statusColor('bad'), fontWeight: 800 }}>ด่วน</span>}</td>
                  <td style={tdSt}>{r.customer || '—'}</td>
                  <td style={tdSt} className="rec-note">{[r.model, r.title].filter(Boolean).join(' · ') || '—'}</td>
                  <td style={tdSt}>{r.process_type === 'plastic' ? 'ฉีด' : 'ปั๊ม'}</td>
                  <td style={tdSt}><Pill label={st.label} color={statusColor(st.tone)} small /></td>
                  <td style={{ ...tdSt, textAlign: 'right' }}>{fmtN(r.annual_volume)}{r.annual_volume != null && !r.volume_source && <span title="ไม่ได้บอกที่มา" style={{ color: statusColor('warn') }}> ?</span>}</td>
                  <td style={{ ...tdSt, color: late ? statusColor('bad') : undefined, fontWeight: late ? 800 : 400 }}>{r.due_date ? fmtDate(r.due_date) : '—'}{late && ' เลย'}</td>
                  <td style={tdSt}>{r.crd_no ? `CRD ${r.crd_no}` : (r.npi_project_id ? '' : <span style={{ color: 'var(--muted)' }}>ยังไม่ส่ง</span>)}{r.npi_project_id && <span style={{ marginLeft: 6 }}>🚀 {npiOf[r.npi_project_id]?.project_code || 'NPI'}</span>}</td>
                  <td style={tdSt}>{a ? <Pill label={RFQ_OUTCOMES[a.outcome]?.label || a.outcome} color={statusColor(RFQ_OUTCOMES[a.outcome]?.tone || 'none')} small /> : '—'}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={9} style={{ ...tdSt, textAlign: 'center', color: 'var(--muted)', padding: 24 }}>{hidden ? `ไม่มีรายการที่ตรงตัวกรอง (ซ่อนอยู่ ${hidden} รายการ)` : 'ยังไม่มี RFQ — กด + RFQ เพื่อเริ่ม'}</td></tr>}
          </tbody>
        </table>
      </div>
      {hidden > 0 && rows.length > 0 && <div style={{ padding: '6px 10px', fontSize: 11.5, color: 'var(--muted)' }}>แสดง {rows.length} · ซ่อนจากตัวกรอง {hidden}</div>}
    </div>
  );
}

/* ── ใบงาน RFQ 1 ใบ ── */
function RfqSheet({ rfq, award, parts, mainParts, npi, canEdit, canAward, statusOptions, onStatus, onEdit, onDel, onAddPart, onEditPart, onDelPart, onNpi, onAward, onIssue, onReprint, today }) {
  const st = rfqStatusMeta(rfq.status);
  const subsOf = (id) => parts.filter(p => p.parent_part_id === id);
  const drift = award?.production_order_snapshot ? snapshotDrift(award.production_order_snapshot, { rfq, parts, award }) : [];
  const sales = award ? (award.annual_sales ?? annualSales(award.annual_volume, award.unit_price)) : null;
  const row = (k, v) => <div style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '2px 0' }}><span style={{ color: 'var(--muted)', minWidth: 130 }}>{k}</span><span style={{ fontWeight: 600 }}>{v ?? '—'}</span></div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12, alignItems: 'start', alignContent: 'start' }}>
      {/* ข้อมูลงาน */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{rfq.rfq_no} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {rfq.customer || '—'}{rfq.model ? ` · ${rfq.model}` : ''}</span></div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {canEdit && !isClosed(rfq.status) ? (
              <select value={rfq.status} onChange={e => onStatus(e.target.value)} style={{ ...inp, width: 'auto', borderColor: statusColor(st.tone) }}>
                {statusOptions.map(k => <option key={k} value={k}>{rfqStatusMeta(k).label}</option>)}
              </select>
            ) : <Pill label={st.label} color={statusColor(st.tone)} />}
            {canEdit && <button style={ghost} onClick={onEdit}>✏️</button>}
            {canEdit && <DeleteButton onClick={onDel} title="ลบ RFQ" />}
          </div>
        </div>
        {row('ชื่องาน', rfq.title)}
        {row('ชนิดงาน', PROCESS_TYPES[rfq.process_type])}
        {row('ความเร่งด่วน', PRIORITIES[rfq.priority])}
        {row('รับ RFQ / กำหนดส่ง', `${rfq.received_date ? fmtDate(rfq.received_date) : '—'} → ${rfq.due_date ? fmtDate(rfq.due_date) : '—'}${rfq.due_date && !isClosed(rfq.status) && rfq.due_date < today ? ' (เลยกำหนด)' : ''}`)}
        {row('SOP ลูกค้า', rfq.sop_date_customer ? fmtDate(rfq.sop_date_customer) : '—')}
        {row('Volume/ปี', rfq.annual_volume != null ? <>{fmtN(rfq.annual_volume)} ชิ้น · ที่มา: {VOLUME_SOURCES[rfq.volume_source] || <span style={{ color: statusColor('warn') }}>ไม่ได้ระบุ</span>}</> : 'ยังไม่ระบุ')}
        {row('APW / MPW', `${fmtN(rfq.apw)} / ${fmtN(rfq.mpw)}`)}
        {row('🔒 ราคาเป้าหมายลูกค้า', rfq.customer_target_price != null ? `${fmtN(rfq.customer_target_price, 2)} THB/pc` : '—')}
        {row('ผู้รับผิดชอบ', rfq.owner_name)}
        {rfq.remark && row('หมายเหตุ', rfq.remark)}
      </div>

      {/* CRD → NPI */}
      <div style={card}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>📨 CRD → IEC / โปรเจค NPI</div>
        {rfq.npi_project_id ? (<>
          {row('เลขที่ CRD', rfq.crd_no)}
          {row('วันส่ง CRD', rfq.crd_sent_at ? fmtDate(rfq.crd_sent_at) : '—')}
          {row('โปรเจค NPI', npi ? <Link to={`/npi?project=${rfq.npi_project_id}`}>🚀 {npi.project_code} · {npi.name}</Link> : <span style={{ color: statusColor('warn') }}>ผูกไว้แต่ไม่พบโปรเจค (ถูกลบ?)</span>)}
          {npi && row('สถานะ NPI', `${npi.status || '—'} · SOP ${npi.sop_date ? fmtDate(npi.sop_date) : '—'}`)}
          {canEdit && <button style={{ ...ghost, marginTop: 6 }} onClick={onNpi}>🔗 แก้การผูก / เลข CRD</button>}
        </>) : (<>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>ยังไม่ได้ส่ง CRD — ส่งแล้วระบบจะสร้างโปรเจค NPI ให้ IEC ทำ APQP/PPAP ต่อ (ชื่อ/พาร์ทระบบเสนอ คุณยืนยัน)</div>
          {canEdit && <button style={btn()} onClick={onNpi} disabled={isClosed(rfq.status)}>📨 ส่ง CRD → สร้าง/ผูกโปรเจค NPI</button>}
        </>)}
      </div>

      {/* พาร์ท */}
      <div style={{ ...card, gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontWeight: 800 }}>📦 พาร์ทในงาน <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {mainParts.length} พาร์ท · {parts.length - mainParts.length} ชิ้นย่อย</span></div>
          {canEdit && <button style={btn()} onClick={onAddPart}>+ พาร์ท</button>}
        </div>
        <table className="rec-list" style={{ width: '100%' }}>
          <thead><tr><th style={thSt}>Part No.</th><th style={thSt}>Part Name</th><th style={thSt}>วัตถุดิบ · หนา</th><th style={thSt}>ผิว/เคลือบ</th><th style={{ ...thSt, textAlign: 'right' }}>Qty</th><th style={thSt}>CAD</th><th style={thSt}></th></tr></thead>
          <tbody>
            {mainParts.map(p => [p, ...subsOf(p.id)].map((x, i) => (
              <tr key={x.id} onClick={() => canEdit && onEditPart(x)}>
                <td style={{ ...tdSt, paddingLeft: i ? 26 : 9 }}>{i ? '└ ' : ''}<b>{x.part_no}</b></td>
                <td style={tdSt} className="rec-note">{x.part_name || '—'}</td>
                <td style={tdSt}>{x.material_spec || '—'}{x.thickness_mm != null ? ` · ${x.thickness_mm} mm` : ''}</td>
                <td style={tdSt}>{x.coating || '—'}</td>
                <td style={{ ...tdSt, textAlign: 'right' }}>{i ? x.qty_per : 1}</td>
                <td style={tdSt}>{x.cad_revision || '—'}</td>
                <td style={{ ...tdSt, textAlign: 'right' }}>{canEdit && <DeleteButton onClick={(e) => { e?.stopPropagation?.(); onDelPart(x); }} title="ลบ" />}</td>
              </tr>
            )))}
            {!parts.length && <tr><td colSpan={7} style={{ ...tdSt, textAlign: 'center', color: 'var(--muted)', padding: 18 }}>ยังไม่มีพาร์ท — ใส่พาร์ทแม่ก่อน แล้วค่อยใส่ชิ้นย่อย (PIA01-03) ชี้ไปที่แม่</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ผล + ใบแจ้งจัดทำ */}
      <div style={{ ...card, gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontWeight: 800 }}>🏁 ผลได้งาน / ไม่ได้งาน {award && <Pill label={RFQ_OUTCOMES[award.outcome]?.label || award.outcome} color={statusColor(RFQ_OUTCOMES[award.outcome]?.tone || 'none')} />}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {canAward && <button style={award ? ghost : btn()} onClick={onAward}>{award ? '✏️ แก้ผล' : '🏁 บันทึกผล'}</button>}
            {canAward && award?.outcome === 'awarded' && !award.production_order_no && <button style={btn()} onClick={onIssue}>🖨️ ออกใบแจ้งจัดทำ F-MKT-001/002</button>}
            {award?.production_order_no && <button style={ghost} onClick={onReprint}>🖨️ พิมพ์ซ้ำ {award.production_order_no}</button>}
          </div>
        </div>
        {!award ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ยังไม่มีผล — ลูกค้าตัดสินแล้วมาบันทึกที่นี่ (ได้งาน = ออกใบแจ้งจัดทำให้โรงงานได้ทันที)</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '0 16px', alignItems: 'start' }}>
            <div>
              {row('วันที่ตัดสิน', award.decided_at ? fmtDate(award.decided_at) : '—')}
              {row('ราคาชิ้น', award.unit_price != null ? `${fmtN(award.unit_price, 2)} THB/pc` : '—')}
              {row('ราคาแม่พิมพ์/JIG', award.tooling_price != null ? `${fmtN(award.tooling_price, 2)} THB` : '—')}
              {row('Volume ที่ใช้คิด', award.annual_volume != null ? `${fmtN(award.annual_volume)} ชิ้น/ปี` : '—')}
              {row('ยอดขาย/ปี', sales == null ? <span style={{ color: statusColor('warn') }}>คิดไม่ได้ — ขาด volume หรือราคา</span> : `${fmtN(sales, 2)} THB`)}
              {award.outcome === 'lost' && row('เหตุผล', award.loss_reason)}
              {award.outcome === 'awarded' && row('PO / TO', `${award.po_no || '—'} / ${award.to_no || '—'}`)}
            </div>
            <div>
              {award.production_order_no ? (<>
                {row('ใบแจ้งจัดทำ', <b>{award.production_order_no}</b>)}
                {row('ออกเมื่อ / โดย', `${award.production_order_issued_at ? fmtDate(award.production_order_issued_at) : '—'} · ${award.production_order_issued_by || '—'}${award.reprint_count ? ` · พิมพ์ซ้ำ ${award.reprint_count} ครั้ง` : ''}`)}
                {drift.length > 0 && <div style={{ fontSize: 12, color: statusColor('warn'), fontWeight: 700, marginTop: 4 }}>⚠️ ข้อมูลปัจจุบันต่างจากใบที่ออกไปแล้ว: {drift.join(' · ')} — พิมพ์ซ้ำจะได้ใบเดิม (เลขเดียวกันต้องเนื้อเดียวกัน)</div>}
              </>) : award.outcome === 'awarded'
                ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ยังไม่ออกใบแจ้งจัดทำ — ออกแล้วระบบจดเลขที่ + เนื้อใบไว้ (รอยต่อไปโรงงาน · เลข SAP Material ออกทีหลังโดยคนเปิดใน SAP)</div>
                : <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ใบแจ้งจัดทำออกได้เฉพาะงานที่ได้</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 📈 สรุปแบบ Model Report ── */
function ReportTab({ rfqs, awards, onOpen }) {
  const [year, setYear] = useState('');
  const rfqOf = useMemo(() => { const m = {}; rfqs.forEach(r => { m[r.id] = r; }); return m; }, [rfqs]);
  const years = useMemo(() => [...new Set(awards.map(a => String(a.decided_at || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [awards]);
  // เฉพาะแถวที่มีผลที่รู้จัก — ให้ตารางกับตัวเลขสรุป (awardSummary) นับชุดเดียวกัน
  const rows = useMemo(() => awards.filter(a => RFQ_OUTCOMES[a.outcome] && (!year || String(a.decided_at || '').startsWith(year)))
    .sort((a, b) => String(b.decided_at || '').localeCompare(String(a.decided_at || ''))), [awards, year]);
  const s = awardSummary(rows);
  const Kpi = ({ label, value, tone }) => (
    <div style={{ ...card, borderLeft: `4px solid ${statusColor(tone || 'none')}` }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <span className="filter-label">ปีที่ตัดสิน</span>
        <select value={year} onChange={e => setYear(e.target.value)} style={{ width: 'auto', minWidth: 120 }}><option value="">{allOf('ปี')}</option>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{awards.length - rows.length > 0 ? `ซ่อน ${awards.length - rows.length} รายการจากปีอื่น` : ''}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10, alignItems: 'start', marginBottom: 12 }}>
        <Kpi label="ตัดสินแล้ว (ใบ)" value={s.total} />
        <Kpi label="ได้งาน" value={`${s.awarded} ใบ · ${fmtN(s.sales.awarded, 0)} THB/ปี`} tone="good" />
        <Kpi label="ไม่ได้งาน" value={`${s.lost} ใบ · ${fmtN(s.sales.lost, 0)} THB/ปี`} tone="bad" />
        <Kpi label="แม่พิมพ์ (ได้ / เสีย)" value={`${fmtN(s.tooling.awarded, 0)} / ${fmtN(s.tooling.lost, 0)}`} />
      </div>
      {s.unknownSales > 0 && <WarnBar color="#f59e0b">{s.unknownSales} ใบคิดยอดขายไม่ได้ (ขาด volume หรือราคา) — ยอดรวมข้างบนไม่รวมใบเหล่านี้</WarnBar>}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <table className="rec-list" style={{ width: '100%' }}>
            <thead><tr><th style={thSt}>ผล</th><th style={thSt}>เลข RFQ</th><th style={thSt}>ลูกค้า · รุ่น</th><th style={{ ...thSt, textAlign: 'right' }}>Volume/ปี</th><th style={{ ...thSt, textAlign: 'right' }}>ราคาชิ้น</th><th style={{ ...thSt, textAlign: 'right' }}>ยอดขาย/ปี</th><th style={{ ...thSt, textAlign: 'right' }}>แม่พิมพ์</th><th style={thSt}>ตัดสิน</th><th style={thSt}>ใบแจ้งจัดทำ / เหตุผล</th></tr></thead>
            <tbody>
              {rows.map(a => { const r = rfqOf[a.rfq_id]; const sales = a.annual_sales ?? annualSales(a.annual_volume, a.unit_price); return (
                <tr key={a.id} onClick={() => onOpen(a.rfq_id)}>
                  <td style={tdSt}><Pill label={RFQ_OUTCOMES[a.outcome]?.label || a.outcome} color={statusColor(RFQ_OUTCOMES[a.outcome]?.tone || 'none')} small /></td>
                  <td style={tdSt}><b>{r?.rfq_no || '—'}</b></td>
                  <td style={tdSt} className="rec-note">{r ? [r.customer, r.model, r.title].filter(Boolean).join(' · ') : 'RFQ ถูกลบ'}</td>
                  <td style={{ ...tdSt, textAlign: 'right' }}>{fmtN(a.annual_volume)}</td>
                  <td style={{ ...tdSt, textAlign: 'right' }}>{fmtN(a.unit_price, 2)}</td>
                  <td style={{ ...tdSt, textAlign: 'right', fontWeight: 700 }}>{sales == null ? <span style={{ color: statusColor('warn') }}>คิดไม่ได้</span> : fmtN(sales, 0)}</td>
                  <td style={{ ...tdSt, textAlign: 'right' }}>{fmtN(a.tooling_price, 0)}</td>
                  <td style={tdSt}>{a.decided_at ? fmtDate(a.decided_at) : '—'}</td>
                  <td style={tdSt} className="rec-note">{a.outcome === 'lost' ? a.loss_reason : (a.production_order_no || (a.outcome === 'awarded' ? 'ยังไม่ออกใบ' : ''))}</td>
                </tr>); })}
              {!rows.length && <tr><td colSpan={9} style={{ ...tdSt, textAlign: 'center', color: 'var(--muted)', padding: 24 }}>ยังไม่มี RFQ ที่ตัดสินผล</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
