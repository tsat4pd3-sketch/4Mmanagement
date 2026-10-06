/* ══════════════════════════════════════════════════════════════════════════
   /scan — "ส่อง QR ที่ติดเครื่อง แล้วถึงงานเลย"  (2026-10-02 · คำสั่ง user)

   โจทย์จาก user: *"พิมพ์ QR ติดเครื่องแล้ว จะสแกนเพื่อเข้าไปตรวจสอบเลย เข้าตรงไหน
   มีชอทคัทไหนที่ง่าย"* — เดิม**ไม่มี**: ต้องเปิดแอปเอง → หาเมนู → เข้าหน้านั้น → กด 📷
   (ป้ายที่พิมพ์เป็นข้อความ `ESM:M:<uuid>` เฉยๆ กล้องมือถือส่องแล้วไปไหนไม่ได้)

   หน้านี้ = ปลายทางของ QR แบบลิงก์ `https://<host>/scan?c=ESM:M:<uuid>`
   ส่องด้วยกล้องมือถือปกติ → แตะ notification → แอปเปิดมาที่เมนู "เครื่องนี้ จะทำอะไร?"

   🔴 กติกาที่ห้ามพัง:
   1. **ตัวแปลงรหัสเป็นของเดิม** (`parseQrPayload`/`resolveMachine`/`resolveJig`) — ห้ามเขียนใหม่
      ⇒ ป้ายเก่าที่เป็นข้อความเปล่า · บาร์โค้ด 1D เดิมที่ติดเครื่องอยู่ก่อน · ป้ายแบบลิงก์ ใช้ได้หมด
   2. **ปุ่มโผล่ตามสิทธิ์จริง** (`canAccessPage`) — ไม่มีสิทธิ์ = ไม่โชว์ปุ่ม ไม่ใช่โชว์แล้วกดไปเจอหน้าเปล่า
   3. **หาไม่เจอต้องบอกว่าทำไม** (ป้ายชนิดไหน · รหัสอะไร) + ให้สแกนใหม่ได้ทันที
      ห้ามเด้งกลับหน้าแรกเงียบๆ — คนยืนอยู่หน้าเครื่อง ถือมือถือ ต้องรู้ว่าต้องทำอะไรต่อ
   4. **อ่านอย่างเดียว ไม่เขียนอะไรลง DB** — เป็นแค่ทางแยก ไม่ใช่หน้าทำงาน
   ══════════════════════════════════════════════════════════════════════════ */
import { useContext, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import ScanModal from '../components/ScanModal';
import { supabaseDR } from '../supabaseClient';
import useMachines from '../utils/useMachines';
import { canAccessPage } from '../utils/permissions';
import { DEFAULT_TEAMS } from '../utils/pmTeams';
import { parseQrPayload, resolveMachine, resolveJig, resolveDeliveryPoint, QR_KINDS } from '../utils/qrCode';

const card = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  padding: 16, boxShadow: 'var(--shadow-sm)',
};

/* ปุ่มลงมือ — เป้ากด 44px ตาม UI §6.24 (คนถือมือถือ ใส่ถุงมือ ยืนหน้าเครื่อง) */
function ActionLink({ to, icon, label, sub, tone = 'var(--accent)' }) {
  return (
    <Link to={to} style={{
      display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '10px 14px',
      borderRadius: 10, border: `1px solid ${tone}`, background: 'var(--bg2)',
      backgroundImage: `linear-gradient(${tone}14, ${tone}14)`, textDecoration: 'none', color: 'var(--text)',
    }}>
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: tone }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sub}</div>}
      </span>
    </Link>
  );
}

export default function ScanLanding() {
  const { role } = useContext(UserContext);
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const raw = sp.get('c') || sp.get('code') || '';
  const { machines, loading: mLoading, failed: mFailed } = useMachines();
  const [jigs, setJigs] = useState(null);      // null = ยังไม่โหลด · [] = โหลดแล้วไม่มี
  const [jigErr, setJigErr] = useState(false);
  const [rescan, setRescan] = useState(false);

  useEffect(() => {
    let alive = true;   // stale-response guard (กฎเขียน DB ข้อ 4)
    /* ⚠️ `jigs` ไม่มีคอลัมน์ department (วัด 05/10) — เดิม select ไปด้วย ⇒ 42703 ทั้งคิวรี
       ⇒ จิ๊กไม่เคยถูกพบ + ปุ่ม "ตรวจ PM" ไม่เคยโผล่ · แผนกของใบตรวจอ่านจาก checklists แทน (ด้านล่าง) */
    supabaseDR.from('jigs').select('id, name, jig_no, machine_no, machine_id, line_name, equipment_type')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setJigErr(true); setJigs([]); return; }
        setJigs(data ?? []);
      });
    return () => { alive = false; };
  }, []);

  const scan = useMemo(() => parseQrPayload(raw), [raw]);
  const isDelivery = scan?.kind === 'delivery';

  /* 🎯 ป้ายจุดส่งงาน (ESM:D:<uuid>) — QrLabels พิมพ์เป็นลิงก์ /scan เหมือนป้ายเครื่อง
     เดิมหน้านี้หาแค่เครื่อง/จิ๊ก ⇒ ส่องป้ายจุดส่งด้วยกล้องมือถือแล้วขึ้น "ไม่พบอุปกรณ์" ทุกครั้ง (QC 05/10)
     โหลดเฉพาะเมื่อเป็นป้ายจุดส่ง (ไม่ดึงทะเบียนทุกครั้งที่สแกนเครื่อง) */
  const [points, setPoints] = useState(null);
  const [pointErr, setPointErr] = useState(false);
  useEffect(() => {
    if (!isDelivery) { setPoints([]); return undefined; }
    let alive = true;
    setPoints(null);
    supabaseDR.from('line_delivery_points').select('id, code, name, line_names, is_active')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setPointErr(true); setPoints([]); return; }
        setPoints(data ?? []);
      });
    return () => { alive = false; };
  }, [isDelivery]);

  const loading = mLoading || jigs === null || points === null;

  const hit = useMemo(() => {
    if (!scan || loading) return null;
    const machine = resolveMachine(scan, machines);
    const jig = resolveJig(scan, jigs ?? []);     // แถวทะเบียน PM (เครื่องมี "แถวเงา" ใน jigs)
    const point = isDelivery ? resolveDeliveryPoint(scan, points ?? []) : null;
    return { machine, jig, point };
  }, [scan, machines, jigs, points, isDelivery, loading]);

  const title = hit?.machine
    ? `${hit.machine.machine_no || '—'}`
    : hit?.jig ? (hit.jig.jig_no || hit.jig.name || '—') : null;
  const subtitle = hit?.machine
    ? [hit.machine.machine_name, hit.machine.line_name].filter(Boolean).join(' · ')
    : hit?.jig ? [hit.jig.name, hit.jig.line_name].filter(Boolean).join(' · ') : '';

  const found = !!(hit?.machine || hit?.jig);
  // 🔨 แม่พิมพ์ใช้ตัวตนเดียวกับเครื่องจักร (machines · equipment_kind='die') — ป้าย ESM:M ชุดเดียวกัน (2026-10-06)
  const isDie = hit?.machine?.equipment_kind === 'die';

  /* แผนกที่มีใบตรวจของอุปกรณ์นี้ (checklists.department = key ทีมช่าง) — ส่ง `dept=` ไปหน้า PM
     ไม่ส่ง = PMCheckData เปิดแผนก maintenance เสมอ ⇒ จิ๊กของ JIG MTN/AM หาใบตรวจไม่เจอ (QC 05/10)
     null = ยังโหลด · [] = ไม่มีใบตรวจ / โหลดไม่ได้ (ปุ่มยังพาไปได้ แบบไม่ระบุแผนก) */
  const jigId = hit?.jig?.id || null;
  const [pmDepts, setPmDepts] = useState(null);
  useEffect(() => {
    if (!jigId) { setPmDepts(null); return undefined; }
    let alive = true;
    supabaseDR.from('checklists').select('department').eq('equipment_id', jigId).eq('module', 'mtn')
      .then(({ data, error }) => {
        if (!alive) return;
        setPmDepts(error ? [] : [...new Set((data || []).map(r => r.department).filter(Boolean))]);
      });
    return () => { alive = false; };
  }, [jigId]);
  const teamLabel = (k) => DEFAULT_TEAMS.find(t => t.key === k)?.label || k;
  const pointHit = !found ? hit?.point : null;

  return (
    <Page>
      <PageHeader icon="📷" title="สแกนป้ายอุปกรณ์"
        subtitle="ส่อง QR ที่ติดเครื่อง แล้วเลือกได้เลยว่าจะทำอะไรกับเครื่องตัวนั้น" />

      {!raw && (
        <div style={{ ...card, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 6 }}>📷</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>ยังไม่มีรหัสจากป้าย</div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>
            ส่อง QR ที่ติดเครื่องด้วยกล้องมือถือ หรือกดสแกนจากในแอป
          </p>
          <button onClick={() => setRescan(true)} style={{ minHeight: 44, padding: '0 20px', fontSize: 14, fontWeight: 800 }}>
            📷 สแกนเลย
          </button>
        </div>
      )}

      {raw && loading && <div style={{ ...card, color: 'var(--muted)', fontSize: 13 }}>กำลังค้นหาอุปกรณ์…</div>}

      {raw && !loading && pointHit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 2 }}>🎯 จุดส่งงาน</div>
            <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>{pointHit.name || pointHit.code || '—'}</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
              {[pointHit.code && `รหัส ${pointHit.code}`, (pointHit.line_names || []).join(', ')].filter(Boolean).join(' · ')}
              {pointHit.is_active === false && <b style={{ color: 'var(--red, #ef4444)' }}> · ปิดใช้งานแล้ว</b>}
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '10px 0 0', lineHeight: 1.7 }}>
              ป้ายนี้ใช้ยืนยันตอน <b>สโตร์ส่งของถึงไลน์</b> — สแกนจากปุ่ม 📍 ในใบเติม WIP (หน้า Heijunka) ไม่ใช่ป้ายเครื่องจักร
            </p>
          </div>
          {canAccessPage('/heijunka', role) && (
            <ActionLink to="/heijunka" icon="🔄" label="ไปหน้าส่งของ (Heijunka)" sub="เลือกใบที่จะส่ง แล้วสแกนป้ายนี้ยืนยัน" />
          )}
          <button onClick={() => setRescan(true)}
            style={{ minHeight: 44, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 13 }}>
            📷 สแกนป้ายอื่น
          </button>
        </div>
      )}

      {raw && !loading && !found && !pointHit && (
        <div style={{ ...card, borderColor: 'var(--amber, #f59e0b)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>⚠️ ไม่พบอุปกรณ์ของป้ายนี้</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.8 }}>
            รหัสที่อ่านได้: <code style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4 }}>{scan?.raw || raw}</code><br />
            ชนิดป้าย: {scan?.typed ? `${QR_KINDS[scan.kind]?.icon ?? ''} ${QR_KINDS[scan.kind]?.label ?? scan.kind}` : 'เลขเปล่า (ไม่ใช่ป้ายของระบบ)'}
            {(mFailed || jigErr || pointErr) && <><br /><b style={{ color: 'var(--red, #ef4444)' }}>⚠️ โหลดทะเบียนไม่ครบ — อาจไม่ใช่ว่าไม่มีเครื่องนี้จริง ลองใหม่อีกครั้ง</b></>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setRescan(true)} style={{ minHeight: 44, padding: '0 16px', fontWeight: 700 }}>📷 สแกนใหม่</button>
            <button onClick={() => navigate('/')} style={{ minHeight: 44, padding: '0 16px', background: 'var(--bg3)' }}>หน้าแรก</button>
          </div>
        </div>
      )}

      {raw && !loading && found && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>
              {isDie ? '🔨 แม่พิมพ์' : hit.machine ? '⚙️ เครื่องจักร' : '🧩 อุปกรณ์'}
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{subtitle}</div>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 🔨 แม่พิมพ์ → เด้งเข้าหมุดบนผังจัดเก็บ (แผงหมุดมีเปลี่ยนสถานะ + ใบซ่อมค้าง) · ตัวตัดสิน = findDieByScan ใน DieRegistry */}
            {isDie && canAccessPage('/die-registry', role) && (
              <ActionLink to={`/equipment?tab=die&die=layout&focus=${encodeURIComponent(hit.machine.id)}`} icon="🗺️"
                label="ดูตำแหน่งบนผังจัดเก็บ / เปลี่ยนสถานะ" sub="เด้งไปหมุดของแม่พิมพ์ตัวนี้" tone="#a78bfa" />
            )}
            {hit.jig && canAccessPage('/pm-check', role) && (pmDepts?.length
              ? pmDepts.map(d => (
                  <ActionLink key={d} to={`/pm?tab=check&equip=${hit.jig.id}&dept=${encodeURIComponent(d)}`} icon="✅"
                    label={pmDepts.length > 1 ? `ตรวจ PM เครื่องนี้ — ${teamLabel(d)}` : 'ตรวจ PM เครื่องนี้'}
                    sub="เปิดใบตรวจตามจุดที่ตั้งไว้" />
                ))
              : (
                <ActionLink to={`/pm?tab=check&equip=${hit.jig.id}`} icon="✅" label="ตรวจ PM เครื่องนี้"
                  sub={pmDepts === null ? 'กำลังหาใบตรวจ…' : 'ยังไม่พบใบตรวจของอุปกรณ์นี้ — เลือกแผนกในหน้าตรวจ'} />
              ))}
            {canAccessPage('/mtn-repair', role) && (
              <ActionLink to={`/mtn-repair?tab=list&q=${encodeURIComponent(hit.machine?.machine_no || hit.jig?.machine_no || hit.jig?.jig_no || '')}`}
                icon="🔧" label="แจ้งซ่อม / ดูใบซ่อมของเครื่องนี้" sub="ใบ MO ที่ค้างอยู่ + เปิดใบใหม่" tone="#f59e0b" />
            )}
            {!hit.jig && canAccessPage('/pm-setup', role) && (
              <ActionLink to={`/pm?tab=setup`} icon="⚙️" label="ยังไม่มีแผน PM — ไปตั้งจุดตรวจ"
                sub="เครื่องนี้ยังไม่มีทะเบียนตรวจ PM" tone="var(--muted)" />
            )}
            {hit.machine && canAccessPage('/order-trace', role) && (
              <ActionLink to={`/order-trace?tab=symptom`} icon="📋" label="สอบกลับ / ดูประวัติเหตุการณ์" tone="#60a5fa" />
            )}
          </div>

          <button onClick={() => setRescan(true)}
            style={{ minHeight: 44, background: 'var(--bg3)', border: '1px solid var(--border2)', fontSize: 13 }}>
            📷 สแกนป้ายอื่น
          </button>
        </div>
      )}

      {rescan && (
        <ScanModal title="สแกนป้ายอุปกรณ์"
          onScan={(parsed) => { if (!parsed?.raw) return 'อ่านรหัสไม่ได้'; setSp({ c: parsed.raw }); setRescan(false); }}
          onClose={() => setRescan(false)} />
      )}
    </Page>
  );
}
