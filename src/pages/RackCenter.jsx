import { useState, useEffect, useCallback, useMemo, useContext, useRef } from 'react';
import ReadOnlyNote from '../components/ReadOnlyNote';
import { useSearchParams } from 'react-router-dom';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { toast } from '../components/Toast';
import InternalTimeBoard from '../components/InternalTimeBoard';
import { frameMin, frameMinFromIso, breaksToFrame } from '../utils/timeFrame';
import { withDocFoot } from '../utils/docForms';

/* ─── RACK CENTER — เรียกภาชนะ/แร็คเปล่าคืนกลับมาใช้ ──────────────────────
   ไลน์ผลิตส่งกล่อง/ถาด/แร็คเปล่ากลับ rack center → ขอภาชนะชุดใหม่กลับมาใช้
   วงจร: requested → preparing → delivered → received (หรือ cancelled)
   แพทเทินเดียวกับ Heijunka Kanban (ฝั่งพาร์ท) แต่ไม่มีรอบจัดส่งตามเวลา
   เพราะเป็นการเรียกแบบ ad-hoc ตามรอบที่ภาชนะในไลน์ใกล้หมด
   ─────────────────────────────────────────────────────────────────────────── */

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 };
const inputSt = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box', fontFamily: 'var(--font-body)' };
const btn = (bg, color = '#fff') => ({ padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: bg, color, fontFamily: 'var(--font-body)' });

const STATUS_COLS = [
  { key: 'requested', label: '🔔 เรียกแล้ว',     color: '#f59e0b' },
  { key: 'preparing', label: '🔧 กำลังเตรียม',   color: '#0ea5e9' },
  { key: 'delivered', label: '🚚 จัดส่งแล้ว',     color: '#a855f7' },
  { key: 'received',  label: '✅ รับแล้ว',        color: '#22c55e' },
];

function timeAgo(iso) {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
  return new Date(iso).toLocaleDateString('th-TH');
}

const EMPTY_FORM = { line_name: '', container_type_id: '', qty: '1', note: '' };

// QR เรียกภาชนะ = deep-link URL: /rack-center?line=<ไลน์>&ctype=<code ภาชนะ>&qty=1
// สแกนด้วยกล้องมือถือ (เปิดลิงก์ตรง) / ปุ่ม 📷 ในแอป / ปืนยิง keyboard-wedge — parse ตัวเดียวกัน
const parseCallQr = (text) => {
  try {
    const u = new URL(String(text).trim(), window.location.origin);
    const line = u.searchParams.get('line'), ctype = u.searchParams.get('ctype');
    if (line && ctype) return { line, ctype, qty: u.searchParams.get('qty') || '1' };
  } catch { /* ไม่ใช่ URL */ }
  return null;
};

export default function RackCenter() {
  const { fullName, role } = useContext(UserContext);
  const canOperate = can('rack_center', 'operate', role);

  const [lines,          setLines]          = useState([]);
  const [containerTypes, setContainerTypes] = useState([]);
  const [requests,       setRequests]       = useState([]);
  const [lineFilter,     setLineFilter]     = useState('');
  const [showForm,       setShowForm]       = useState(false);
  const [form,           setForm]           = useState(EMPTY_FORM);
  const [saving,         setSaving]         = useState(false);
  const [busyId,         setBusyId]         = useState(null);
  const [showDone,       setShowDone]       = useState(false);
  const [pkgReqs,        setPkgReqs]        = useState([]);   // packaging_withdrawal_requests
  const [pkgBusy,        setPkgBusy]        = useState(null);
  const [view,           setView]           = useState('board');   // 'board' | 'time' | 'sla'
  const [sla,            setSla]            = useState({ prepare_within_min: 15, deliver_within_min: 45 });
  const [slaDraft,       setSlaDraft]       = useState(null);
  const [popup,          setPopup]          = useState(null);      // { r, x, y } — คลิกบล็อกบนบอร์ดเวลา
  const [nowMs,          setNowMs]          = useState(() => Date.now());   // นาฬิกาบอร์ดเวลา/SLA
  const [breakPolicies,  setBreakPolicies]  = useState([]);        // เงาเวลาพักบนบอร์ดเวลา
  const [scanOpen,       setScanOpen]       = useState(false);     // 📷 สแกน QR เรียกภาชนะ
  const [qrOpen,         setQrOpen]         = useState(false);     // 🏷️ พิมพ์ป้าย QR
  const [searchParams,   setSearchParams]   = useSearchParams();

  const load = useCallback(async () => {
    const [{ data: ln }, { data: ct }, { data: req }, { data: pkg }, { data: slaRow }] = await Promise.all([
      supabase.from('production_lines').select('name').order('name'),
      supabaseDR.from('container_types').select('*').eq('is_active', true).order('name'),
      supabaseDR.from('rack_requests').select('*').order('requested_at', { ascending: false }).limit(200),
      supabaseDR.from('packaging_withdrawal_requests').select('*').order('created_at', { ascending: false }).limit(200),
      supabaseDR.from('internal_delivery_sla').select('*').eq('kind', 'rack').maybeSingle(),
    ]);
    setLines(ln || []);
    setContainerTypes(ct || []);
    setRequests(req || []);
    setPkgReqs(pkg || []);
    if (slaRow) setSla(slaRow);
  }, []);

  const issuePkg = async (p) => {
    setPkgBusy(p.id);
    try {
      const { error } = await supabaseDR.from('packaging_withdrawal_requests').update({ status: 'issued' }).eq('id', p.id);
      if (error) throw error;
      toast.success(`จ่าย packaging ${p.packaging_code} แล้ว`);
      await load();
    } catch (err) { toast.error(err.message); }
    setPkgBusy(null);
  };

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    supabaseDR.from('break_policies').select('*').eq('is_active', true)
      .then(({ data }) => setBreakPolicies(data || []));
  }, []);

  // live refresh เมื่อมีไลน์/rack center อื่นกดเปลี่ยนสถานะ
  useEffect(() => {
    const ch = supabaseDR.channel('rack-requests-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rack_requests' }, load)
      .subscribe();
    return () => { supabaseDR.removeChannel(ch); };
  }, [load]);

  const filtered = useMemo(() => {
    return lineFilter ? requests.filter(r => r.line_name === lineFilter) : requests;
  }, [requests, lineFilter]);

  const byStatus = useMemo(() => {
    const m = { requested: [], preparing: [], delivered: [], received: [] };
    filtered.forEach(r => {
      if (r.status === 'cancelled') return;
      if (r.status === 'received' && !showDone) return;
      (m[r.status] = m[r.status] || []).push(r);
    });
    return m;
  }, [filtered, showDone]);

  // เอาผลสแกน/deep-link มาเปิดฟอร์มพร้อมกรอกให้ครบ — เหลือกดยืนยันทีเดียว
  const applyScan = useCallback((p) => {
    if (!p) { toast.error('QR นี้ไม่ใช่ QR เรียกภาชนะ'); return false; }
    const ln = lines.find(l => l.name.trim().toLowerCase() === p.line.trim().toLowerCase());
    const ct = containerTypes.find(c =>
      String(c.code || '').trim().toLowerCase() === p.ctype.trim().toLowerCase() || c.id === p.ctype);
    if (!ln || !ct) { toast.error(`QR ไม่ตรงข้อมูลในระบบ (${!ln ? 'ไลน์ ' + p.line : 'ภาชนะ ' + p.ctype})`); return false; }
    setForm({ line_name: ln.name, container_type_id: ct.id, qty: String(parseInt(p.qty) || 1), note: '' });
    setScanOpen(false);
    setShowForm(true);
    return true;
  }, [lines, containerTypes]);

  // deep-link จาก QR ที่สแกนด้วยกล้องมือถือ: /rack-center?line=..&ctype=.. → เปิดฟอร์มให้เลย
  useEffect(() => {
    const line = searchParams.get('line'), ctype = searchParams.get('ctype');
    if (!line || !ctype || !lines.length || !containerTypes.length) return;
    applyScan({ line, ctype, qty: searchParams.get('qty') || '1' });
    setSearchParams({}, { replace: true });   // ล้าง param กันเปิดซ้ำตอน refresh
  }, [lines, containerTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  // 🏷️ พิมพ์แผ่นป้าย QR (ไลน์ × ชนิดภาชนะ) — แปะหน้างานให้สแกนแทนพิมพ์
  const printQrLabels = async (lineNames, typeIds) => {
    const combos = [];
    lineNames.forEach(lnName => typeIds.forEach(tid => {
      const ct = containerTypes.find(c => c.id === tid);
      if (ct) combos.push({ line: lnName, ct });
    }));
    if (!combos.length) { toast.error('เลือกไลน์และชนิดภาชนะก่อน'); return; }
    const QRCode = (await import('qrcode')).default;   // lazy chunk — ไม่บวม bundle หลัก
    const cells = [];
    for (const c of combos) {
      const url = `${window.location.origin}/rack-center?line=${encodeURIComponent(c.line)}&ctype=${encodeURIComponent(c.ct.code || c.ct.id)}&qty=1`;
      const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 1 });
      cells.push(`<div class="lb">
        <img src="${dataUrl}" />
        <div class="ln">${c.line}</div>
        <div class="ct">${c.ct.code ? c.ct.code + ' · ' : ''}${c.ct.name}</div>
        <div class="hint">📱 สแกนเพื่อเรียกภาชนะ</div>
      </div>`);
    }
    const html = `<style>
      body{font-family:'Sarabun',Tahoma,sans-serif;margin:8mm}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}
      .lb{border:1.5px solid #000;border-radius:8px;padding:5mm;text-align:center;page-break-inside:avoid}
      .lb img{width:38mm;height:38mm}
      .ln{font-size:15px;font-weight:800;margin-top:2mm}
      .ct{font-size:12px;margin-top:1mm}
      .hint{font-size:10px;color:#555;margin-top:1.5mm}
    </style><div class="grid">${cells.join('')}</div>`;
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>ป้าย QR เรียกภาชนะ</title></head><body>${withDocFoot(html, 'rack_qr_labels')}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const handleRequest = async () => {
    if (!form.line_name) { toast.error('เลือกไลน์ก่อน'); return; }
    if (!form.container_type_id) { toast.error('เลือกชนิดภาชนะ'); return; }
    const qty = parseInt(form.qty) || 0;
    if (qty <= 0) { toast.error('จำนวนต้องมากกว่า 0'); return; }
    const ctype = containerTypes.find(c => c.id === form.container_type_id);
    setSaving(true);
    const { error } = await supabaseDR.from('rack_requests').insert({
      line_name: form.line_name,
      container_type_id: form.container_type_id,
      container_name: ctype?.name || '—',
      qty,
      note: form.note.trim() || null,
      requested_by: fullName,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('🔔 เรียกภาชนะแล้ว — รอ Rack Center เตรียม');
    setShowForm(false);
    setForm(EMPTY_FORM);
    load();
  };

  const advance = async (r) => {
    const next = { requested: 'preparing', preparing: 'delivered', delivered: 'received' }[r.status];
    if (!next) return;
    setBusyId(r.id);
    const payload = { status: next };
    if (next === 'preparing') { payload.prepared_by = fullName; payload.prepared_at = new Date().toISOString(); }
    if (next === 'delivered') { payload.delivered_by = fullName; payload.delivered_at = new Date().toISOString(); }
    if (next === 'received')  { payload.received_by  = fullName; payload.received_at  = new Date().toISOString(); }
    const { error } = await supabaseDR.from('rack_requests').update(payload).eq('id', r.id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const cancel = async (r) => {
    if (!window.confirm('ยืนยันยกเลิกการเรียกภาชนะนี้?')) return;
    setBusyId(r.id);
    const { error } = await supabaseDR.from('rack_requests').update({
      status: 'cancelled', cancelled_by: fullName, cancelled_at: new Date().toISOString(),
    }).eq('id', r.id);
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const ACTION_LABEL = { requested: '🔧 เริ่มเตรียม', preparing: '🚚 จัดส่งแล้ว', delivered: '✅ รับแล้ว' };

  return (
    <div style={{ padding: 'clamp(12px,2vw,24px)', maxWidth: 'min(96vw, 2000px)', margin: '0 auto' }}>
      {/* ⚠️ rack_center:operate seed ไว้ตั้งแต่ 2026-07-08 (ก่อนมี role mtn/engineer/planner_store/dept_admin)
          → role ที่เพิ่มทีหลังเปิดหน้านี้ได้แต่เรียกภาชนะไม่ได้ ต้องบอกให้ชัด */}
      <ReadOnlyNote show={!canOperate} role={role} what="เรียกภาชนะ/รับงาน"
        permKey="rack_center:operate" />
      <div style={{ display: 'flex', paddingRight: 52, justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 'clamp(18px,2.5vw,24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
            🗃️ Rack Center — เรียกภาชนะ
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            ไลน์ผลิตเรียกภาชนะ/แร็คเปล่าคืน · Rack Center เตรียม-จัดส่ง · ไลน์ยืนยันรับ
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {[{ id: 'board', label: '📋 บอร์ดสถานะ' }, { id: 'time', label: '🕐 บอร์ดเวลา' }, { id: 'sla', label: '⚙️ SLA' }].map(v => (
            <button key={v.id} onClick={() => setView(v.id)}
              style={{ padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
                background: view === v.id ? 'var(--accent)' : 'var(--bg2)', color: view === v.id ? '#08130a' : 'var(--text2)',
                border: `1px solid ${view === v.id ? 'var(--accent)' : 'var(--border)'}` }}>{v.label}</button>
          ))}
          <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
          <select value={lineFilter} onChange={e => setLineFilter(e.target.value)} style={{ ...inputSt, width: 160 }}>
            <option value="">ทุกไลน์</option>
            {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />
            แสดงที่รับแล้ว
          </label>
          {canOperate && (
            <>
              <button onClick={() => setScanOpen(true)} style={btn('var(--bg2)', 'var(--text2)')} title="สแกน QR ที่แปะหน้างาน — กล้องในแอป หรือปืนยิงสแกน">
                📷 สแกน
              </button>
              <button onClick={() => setQrOpen(true)} style={btn('var(--bg2)', 'var(--text2)')} title="พิมพ์แผ่นป้าย QR ไปแปะหน้างาน">
                🏷️ ป้าย QR
              </button>
              <button onClick={() => { setForm({ ...EMPTY_FORM, line_name: lineFilter }); setShowForm(true); }} style={btn('#16a34a')}>
                🔔 เรียกภาชนะ
              </button>
            </>
          )}
        </div>
      </div>

      {scanOpen && <QrScanModal onClose={() => setScanOpen(false)} onResult={(text) => applyScan(parseCallQr(text))} />}
      {qrOpen && <QrLabelModal lines={lines} containerTypes={containerTypes} onClose={() => setQrOpen(false)} onPrint={printQrLabels} />}

      {/* Packaging withdrawal requests (auto จากการผลิต FG) */}
      {(() => {
        const pending = pkgReqs.filter(p => p.status !== 'issued');
        if (pending.length === 0) return null;
        return (
          <div style={{ ...card, marginBottom: 16, borderColor: 'rgba(245,158,11,0.4)' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#f59e0b', marginBottom: 10, fontFamily: 'var(--font-display)' }}>
              📦 ใบเบิก Packaging จากการผลิต <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>({pending.length} รายการ)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(260px, 100%), 1fr))', gap: 10 }}>
              {pending.map(p => (
                <div key={p.id} style={{ background: 'var(--bg2)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#f59e0b' }}>{p.packaging_code}</span>
                    <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)' }}>{p.qty}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{p.packaging_name || ''}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    {p.source_line ? `🏭 ${p.source_line}` : ''}{p.product_name ? ` · ${p.product_name}` : ''}
                    {p.source_prod_no ? ` · FG ${p.source_prod_no}` : ''}
                  </div>
                  {canOperate && <button onClick={() => issuePkg(p)} disabled={pkgBusy === p.id}
                    style={{ marginTop: 8, width: '100%', padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font-body)' }}>
                    {pkgBusy === p.id ? '...' : '✔ จ่าย Packaging'}
                  </button>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 🕐 บอร์ดเวลา — สไตล์ Shipping Chart ปลายทางเป็นไลน์ภายใน + SLA walkforward จากเวลาเรียก */}
      {view === 'time' && (() => {
        const fs = new Date(nowMs);
        if (fs.getHours() < 8) fs.setDate(fs.getDate() - 1);
        fs.setHours(8, 0, 0, 0);
        const fe = fs.getTime() + 24 * 3600000;
        const inFrame = filtered.filter(r => r.status !== 'cancelled' && r.requested_at
          && new Date(r.requested_at).getTime() >= fs.getTime() && new Date(r.requested_at).getTime() < fe);
        const slaState = (r) => {
          if (r.status === 'received' || r.status === 'delivered') return null;
          const req = new Date(r.requested_at).getTime();
          if (nowMs > req + (sla.deliver_within_min || 45) * 60000) return 'deliver';   // เลย SLA ส่งถึงไลน์
          if (r.status === 'requested' && nowMs > req + (sla.prepare_within_min || 15) * 60000) return 'prepare';
          return null;
        };
        const colorOf = (r) => {
          const b = slaState(r);
          if (b === 'deliver') return '#ef4444';
          if (b === 'prepare') return '#f97316';
          return (STATUS_COLS.find(c => c.key === r.status) || STATUS_COLS[0]).color;
        };
        const byLine = {};
        inFrame.forEach(r => { (byLine[r.line_name] = byLine[r.line_name] || []).push(r); });
        const groups = Object.keys(byLine).sort().map(lnName => ({
          key: lnName, label: lnName,
          sub: `${byLine[lnName].length} รายการ · ✅ ${byLine[lnName].filter(x => x.status === 'received').length}`,
          items: byLine[lnName].map(r => {
            const tm = frameMinFromIso(r.requested_at);
            const hhmm = new Date(r.requested_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            return { id: r.id, timeMin: tm ?? 480, color: colorOf(r), text: `${hhmm}${r.status === 'received' ? ' ✅' : ''}`,
              title: `${hhmm} · ${r.container_name} ×${r.qty} · ${r.line_name}`, data: r };
          }),
        }));
        const nowD = new Date(nowMs);
        const nm = frameMin(`${String(nowD.getHours()).padStart(2, '0')}:${String(nowD.getMinutes()).padStart(2, '0')}`);
        return (
          <InternalTimeBoard
            title={`🕐 บอร์ดเวลาเรียกภาชนะ — วันงานปัจจุบัน`}
            hint={`SLA: เริ่มเตรียมใน ${sla.prepare_within_min} นาที · ส่งถึงไลน์ใน ${sla.deliver_within_min} นาที (🟠 เลยเตรียม · 🔴 เลยส่ง)`}
            groups={groups} nowMin={nm} breaks={breaksToFrame(breakPolicies)}
            onItemClick={(r, x, y) => setPopup({ r, x, y })}
          />
        );
      })()}

      {/* ⚙️ SLA config — ปรับได้เหมือน ship-to config */}
      {view === 'sla' && (
        <div style={{ ...card, maxWidth: 560 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 4, fontFamily: 'var(--font-display)' }}>⚙️ SLA การส่งภาชนะภายในโรงงาน</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            นับจากเวลาที่ไลน์กดเรียก — เกินกำหนดแล้วยังไม่ถึงสถานะ บล็อกบนบอร์ดเวลาจะเปลี่ยนเป็น 🟠/🔴 ให้เห็นทันที
          </div>
          {[
            { k: 'prepare_within_min', label: '🔧 ต้องเริ่มเตรียมภายใน (นาที)' },
            { k: 'deliver_within_min', label: '🚚 ต้องส่งถึงไลน์ภายใน (นาที)' },
          ].map(f => (
            <div key={f.k} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--text2)', flex: 1 }}>{f.label}</span>
              <input type="number" min="1" value={(slaDraft ?? sla)[f.k]} disabled={!canOperate}
                onChange={e => setSlaDraft(d => ({ ...(d ?? sla), [f.k]: e.target.value }))}
                style={{ ...inputSt, width: 110, textAlign: 'center', fontWeight: 800 }} />
            </div>
          ))}
          {canOperate && slaDraft && (
            <button onClick={async () => {
              const payload = { prepare_within_min: Math.max(1, parseInt(slaDraft.prepare_within_min) || 15), deliver_within_min: Math.max(1, parseInt(slaDraft.deliver_within_min) || 45), updated_at: new Date().toISOString() };
              // pkey ของตารางคือ kind (ไม่มีคอลัมน์ id) — upsert ตรงๆ
              // (เดิม select('id') → 42703 ถูกกลืนเงียบ → นึกว่าไม่มีแถว → insert ซ้ำชน pkey)
              const { error } = await supabaseDR.from('internal_delivery_sla')
                .upsert({ ...payload, kind: 'rack' }, { onConflict: 'kind' });
              if (error) toast.error(error.message);
              else { setSla(x => ({ ...x, ...payload })); setSlaDraft(null); toast.success('บันทึก SLA แล้ว'); }
            }} style={btn('#16a34a')}>💾 บันทึก SLA</button>
          )}
        </div>
      )}

      {/* Kanban board: 4 status columns */}
      {view === 'board' && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(260px, 100%), 1fr))', gap: 14 }}>
        {STATUS_COLS.map(col => (
          <div key={col.key} style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: 'var(--bg2)', borderBottom: `2px solid ${col.color}40`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: col.color, fontFamily: 'var(--font-display)' }}>{col.label}</div>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{(byStatus[col.key] || []).length}</span>
            </div>
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80, maxHeight: 560, overflowY: 'auto' }}>
              {(byStatus[col.key] || []).length === 0 ? (
                <div style={{ padding: '16px 8px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>—</div>
              ) : (
                (byStatus[col.key] || []).map(r => (
                  <div key={r.id} style={{ background: 'var(--bg2)', border: `1px solid ${col.color}30`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>📍 {r.line_name}</div>
                      <span style={{ fontSize: 11, fontWeight: 800, color: col.color }}>×{r.qty}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{r.container_name}</div>
                    {r.note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>📝 {r.note}</div>}
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                      {r.requested_by ? `โดย ${r.requested_by} · ` : ''}{timeAgo(r.requested_at)}
                    </div>
                    {canOperate && col.key !== 'received' && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button onClick={() => advance(r)} disabled={busyId === r.id}
                          style={{ ...btn(col.color), flex: 1, padding: '6px 10px', fontSize: 12, opacity: busyId === r.id ? 0.6 : 1 }}>
                          {ACTION_LABEL[r.status]}
                        </button>
                        {col.key !== 'delivered' && (
                          <button className="tbtn" onClick={() => cancel(r)} disabled={busyId === r.id}
                            style={{ ...btn('rgba(239,68,68,0.1)', '#ef4444'), border: '1px solid rgba(239,68,68,0.3)', padding: '6px 10px', fontSize: 12 }}>
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
      )}

      {/* popup รายละเอียดจากบอร์ดเวลา */}
      {popup && (() => {
        const r = popup.r;
        const col = STATUS_COLS.find(c => c.key === r.status) || STATUS_COLS[0];
        const W = 260;
        const left = Math.max(8, Math.min(popup.x - W / 2, window.innerWidth - W - 12));
        const top = Math.min(popup.y + 12, window.innerHeight - 240);
        return (
          <>
            <div onClick={() => setPopup(null)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
            <div style={{ position: 'fixed', left, top, width: W, zIndex: 1300, background: 'var(--bg3)', border: `1px solid ${col.color}66`, borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
              <div style={{ height: 4, background: col.color }} />
              <div style={{ padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)' }}>📍 {r.line_name}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.15)', color: col.color }}>{col.label}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>{r.container_name} <b>×{r.qty}</b></div>
                {r.note && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>📝 {r.note}</div>}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                  🔔 {r.requested_by || '-'} · {timeAgo(r.requested_at)}
                  {r.delivered_by ? ` · 🚚 ${r.delivered_by}` : ''}{r.received_by ? ` · ✅ ${r.received_by}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {canOperate && r.status !== 'received' && (
                    <button onClick={() => { advance(r); setPopup(null); }} disabled={busyId === r.id}
                      style={{ ...btn(col.color), flex: 1, padding: '7px 8px', fontSize: 11 }}>
                      {ACTION_LABEL[r.status] || '...'}
                    </button>
                  )}
                  {canOperate && ['requested', 'preparing'].includes(r.status) && (
                    <button onClick={() => { cancel(r); setPopup(null); }}
                      className="tbtn" style={{ ...btn('rgba(239,68,68,0.1)', '#ef4444'), border: '1px solid rgba(239,68,68,0.3)', padding: '7px 10px', fontSize: 11 }}>✕</button>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}

      {/* Request modal */}
      {showForm && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 24, width: 'min(420px,100%)' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 16, fontFamily: 'var(--font-display)' }}>
              🔔 เรียกภาชนะ
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ไลน์การผลิต *</label>
                <select value={form.line_name} onChange={e => setForm(f => ({ ...f, line_name: e.target.value }))} style={inputSt}>
                  <option value="">เลือกไลน์...</option>
                  {lines.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ชนิดภาชนะ *</label>
                <select value={form.container_type_id} onChange={e => setForm(f => ({ ...f, container_type_id: e.target.value }))} style={inputSt}>
                  <option value="">เลือกภาชนะ...</option>
                  {containerTypes.map(c => <option key={c.id} value={c.id}>{c.name}{c.capacity ? ` (จุ ${c.capacity})` : ''}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>จำนวน (ใบ/ใบ) *</label>
                <input type="number" min="1" step="1" style={{ ...inputSt, fontSize: 20, fontWeight: 900, textAlign: 'center' }}
                  value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>หมายเหตุ</label>
                <input style={inputSt} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="เช่น ด่วน, จุดส่ง..." />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowForm(false)} style={{ ...btn('var(--bg2)', 'var(--text)'), border: '1px solid var(--border)' }}>ยกเลิก</button>
              <button onClick={handleRequest} disabled={saving} style={{ ...btn('#16a34a'), opacity: saving ? 0.6 : 1 }}>
                {saving ? '...' : '🔔 เรียกภาชนะ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── 📷 สแกน QR เรียกภาชนะ — กล้องในแอป (BarcodeDetector) + ช่องปืนยิง keyboard-wedge ── */
function QrScanModal({ onClose, onResult }) {
  const videoRef = useRef(null);
  const [camErr, setCamErr] = useState(null);
  const [manual, setManual] = useState('');
  useEffect(() => {
    let stream = null, raf = null, stop = false;
    if (!('BarcodeDetector' in window)) {
      setCamErr('เบราว์เซอร์นี้ไม่รองรับสแกนกล้องในแอป — ใช้กล้องมือถือสแกน QR ตรงๆ (เปิดลิงก์เอง) หรือยิงปืนสแกนลงช่องด้านล่าง');
      return undefined;
    }
    (async () => {
      try {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stop) { stream.getTracks().forEach(t => t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stop) return;
          try {
            const codes = await det.detect(videoRef.current);
            if (codes.length) { onResult(codes[0].rawValue); return; }
          } catch { /* เฟรมยังไม่พร้อม — ข้าม */ }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { setCamErr('เปิดกล้องไม่ได้: ' + e.message); }
    })();
    return () => { stop = true; if (raf) cancelAnimationFrame(raf); stream?.getTracks().forEach(t => t.stop()); };
  }, [onResult]);
  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ ...card, width: 'min(94vw, 420px)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>📷 สแกน QR เรียกภาชนะ</span>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 9px', fontSize: 13, cursor: 'pointer' }}>✕</button>
        </div>
        {camErr
          ? <div style={{ fontSize: 12.5, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '8px 11px', marginBottom: 10 }}>{camErr}</div>
          : <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 10, background: '#000', marginBottom: 10 }} />}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>🔫 ปืนยิงสแกน / วางข้อความ QR แล้วกด Enter</div>
        <input autoFocus value={manual} onChange={e => setManual(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && manual.trim()) onResult(manual); }}
          placeholder="ยิงสแกนลงช่องนี้ได้เลย…" style={inputSt} />
      </div>
    </div>
  );
}

/* ─── 🏷️ เลือกไลน์ × ชนิดภาชนะ → พิมพ์แผ่นป้าย QR แปะหน้างาน ── */
function QrLabelModal({ lines, containerTypes, onClose, onPrint }) {
  const [selLines, setSelLines] = useState(() => new Set());
  const [selTypes, setSelTypes] = useState(() => new Set());
  const [printing, setPrinting] = useState(false);
  const toggle = (setter) => (v) => setter(prev => { const s = new Set(prev); if (s.has(v)) s.delete(v); else s.add(v); return s; });
  const tgLine = toggle(setSelLines), tgType = toggle(setSelTypes);
  const chip = (on) => ({ padding: '4px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 12, fontWeight: 700,
    background: on ? 'var(--accent-dim, rgba(74,222,128,.15))' : 'var(--bg2)', color: on ? 'var(--accent)' : 'var(--text2)',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}` });
  return (
    <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ ...card, width: 'min(94vw, 560px)', maxHeight: '86vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>🏷️ พิมพ์ป้าย QR เรียกภาชนะ</span>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 6, padding: '2px 9px', fontSize: 13, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          เลือกไลน์ × ชนิดภาชนะ → ได้แผ่น A4 ป้ายละ 1 คู่ (QR = ลิงก์เปิดฟอร์มกรอกให้ครบ) เอาไปแปะจุดวางภาชนะหน้างาน
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)', marginBottom: 5 }}>🏭 ไลน์ ({selLines.size})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
          {lines.map(l => <button key={l.name} onClick={() => tgLine(l.name)} style={chip(selLines.has(l.name))}>{l.name}</button>)}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)', marginBottom: 5 }}>📦 ชนิดภาชนะ ({selTypes.size})</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
          {containerTypes.map(c => <button key={c.id} onClick={() => tgType(c.id)} style={chip(selTypes.has(c.id))}>{c.code ? `${c.code} · ` : ''}{c.name}</button>)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>รวม {selLines.size * selTypes.size} ป้าย</span>
          <button disabled={printing || !selLines.size || !selTypes.size}
            onClick={async () => { setPrinting(true); try { await onPrint([...selLines], [...selTypes]); } finally { setPrinting(false); } }}
            style={{ ...btn(selLines.size && selTypes.size ? '#16a34a' : 'var(--bg2)', selLines.size && selTypes.size ? '#fff' : 'var(--muted)'), cursor: selLines.size && selTypes.size ? 'pointer' : 'not-allowed' }}>
            {printing ? '...' : '🖨️ พิมพ์ป้าย'}
          </button>
        </div>
      </div>
    </div>
  );
}
