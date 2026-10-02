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
import { parseQrPayload, resolveMachine, resolveJig, QR_KINDS } from '../utils/qrCode';

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
    supabaseDR.from('jigs').select('id, name, jig_no, machine_no, machine_id, line_name, department, equipment_type')
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setJigErr(true); setJigs([]); return; }
        setJigs(data ?? []);
      });
    return () => { alive = false; };
  }, []);

  const scan = useMemo(() => parseQrPayload(raw), [raw]);
  const loading = mLoading || jigs === null;

  const hit = useMemo(() => {
    if (!scan || loading) return null;
    const machine = resolveMachine(scan, machines);
    const jig = resolveJig(scan, jigs ?? []);     // แถวทะเบียน PM (เครื่องมี "แถวเงา" ใน jigs)
    return { machine, jig };
  }, [scan, machines, jigs, loading]);

  const title = hit?.machine
    ? `${hit.machine.machine_no || '—'}`
    : hit?.jig ? (hit.jig.jig_no || hit.jig.name || '—') : null;
  const subtitle = hit?.machine
    ? [hit.machine.machine_name, hit.machine.line_name].filter(Boolean).join(' · ')
    : hit?.jig ? [hit.jig.name, hit.jig.line_name].filter(Boolean).join(' · ') : '';

  const found = !!(hit?.machine || hit?.jig);

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

      {raw && !loading && !found && (
        <div style={{ ...card, borderColor: 'var(--amber, #f59e0b)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>⚠️ ไม่พบอุปกรณ์ของป้ายนี้</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.8 }}>
            รหัสที่อ่านได้: <code style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4 }}>{scan?.raw || raw}</code><br />
            ชนิดป้าย: {scan?.typed ? `${QR_KINDS[scan.kind]?.icon ?? ''} ${QR_KINDS[scan.kind]?.label ?? scan.kind}` : 'เลขเปล่า (ไม่ใช่ป้ายของระบบ)'}
            {(mFailed || jigErr) && <><br /><b style={{ color: 'var(--red, #ef4444)' }}>⚠️ โหลดทะเบียนไม่ครบ — อาจไม่ใช่ว่าไม่มีเครื่องนี้จริง ลองใหม่อีกครั้ง</b></>}
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
              {hit.machine ? '⚙️ เครื่องจักร' : '🧩 อุปกรณ์'}
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.2 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{subtitle}</div>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hit.jig && canAccessPage('/pm-check', role) && (
              <ActionLink to={`/pm?tab=check&equip=${hit.jig.id}`} icon="✅" label="ตรวจ PM เครื่องนี้"
                sub="เปิดใบตรวจตามจุดที่ตั้งไว้" />
            )}
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
