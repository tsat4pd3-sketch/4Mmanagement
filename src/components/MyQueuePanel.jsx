/* ═══════════════════════════════════════════════════════════════════════════
   📌 คิวงานของฉัน — แผงในเมนูบัญชี                       2026-09-25 · คำสั่ง user

   *"กดดูบัญชีตัวเองแล้วเห็นงานค้างที่รอเรา"*

   กฎ/การแบ่งชั้นอยู่ `src/utils/myQueue.js` (pure · มีเทส) — ที่นี่รับผิดชอบแค่
   **โหลดแถว** กับ **วาด** · ห้ามตัดสินว่าใบไหนของใครในไฟล์นี้

   ── 🔴 กติกาที่ห้ามพลาด ────────────────────────────────────────────────────
   1. **ไม่ยิงอะไรหาใครเลย** — ตรงข้ามกับกระดิ่ง (19,095 แถว/7 วัน อ่าน 7.3%)
      คนเปิดดูเองเมื่ออยากรู้ ⇒ ไม่มีแถวใหม่ ไม่มี invocation ของ send-push
   2. **โหลดครั้งเดียวต่อ session** แล้วรีเฟรชเฉพาะตอนเปิดแผงและข้อมูลเก่าเกิน STALE
      (บทเรียน egress: จออะไรที่ยิงคิวรีทุกครั้งที่ render = ค่าโดยสารเงียบๆ)
   3. **เลือกเฉพาะคอลัมน์ที่ใช้** — `mtn_orders` มี 116 คอลัมน์ `select('*')` = 1.59 MB/ครั้ง
   4. **ว่างต้องขึ้น "ไม่มีงานค้าง" ห้ามซ่อนแผง** · โหลดไม่ครบต้องเขียนบนจอว่าไม่ครบ
      (ผู้ใช้ต้องแยก "เคลียร์หมดแล้ว" ออกจาก "คิวรีล่ม" ให้ได้)
   ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserContext } from '../App';
import { supabase, supabaseDR } from '../supabaseClient';
import { getActor } from '../utils/actorStamp';
import { loadProductionLines } from '../utils/useProductionLines';
import {
  TIER, TIER_TITLE, EMPTY_TEXT, OLD_DAYS, buildQueue, badgeCount, capped,
} from '../utils/myQueue';

/** ข้อมูลเก่ากว่านี้ = โหลดใหม่ตอนเปิดแผง (นาที) */
const STALE_MIN = 5;
/** เพดานแถวต่อคิวรี — คิวงานไม่ใช่รายงาน ไม่ต้องครบทุกแถวในโลก */
const LIMIT = 300;

/* คอลัมน์ที่ "ใครรอใบนี้" ต้องใช้จริงเท่านั้น (myQueue.moWaitingOn + การวาดแถว) */
const MO_COLS = [
  'id', 'mo_no', 'work_date', 'current_step', 'status', 'dept_section', 'line_name',
  'machine_no', 'mtn_dept', 'item_type',
  'assigned_to', 'tech_main', 'tech_main_uid',
  'reporter_prod', 'reporter_prod_uid', 'reported_by_name', 'reported_by_uid',
].join(', ');

const DEAD = ['cancelled', 'rejected'];

export async function loadMyQueue(me) {
  /* ยิงขนานกัน — ทุกก้อนแยก error ของตัวเอง: ก้อนไหนล่มส่ง undefined ให้ buildQueue
     แล้วมันจะติด `partial` ให้เอง (ห้ามกลืนเป็น [] = จอจะบอกว่า "ไม่มีงาน" ทั้งที่ไม่รู้) */
  const ok = (r) => (r.error ? undefined : (r.data || []));

  const [moR, sesR, prR, fourR, actR, lines] = await Promise.all([
    supabaseDR.from('mtn_orders').select(MO_COLS)
      .is('approve_at', null).gt('current_step', 1)
      .order('work_date', { ascending: true }).limit(LIMIT),
    supabaseDR.from('production_sessions').select('id, line_name, section, shift, work_date')
      .eq('status', 'pending_close').order('work_date', { ascending: true }).limit(100),
    supabaseDR.from('purchase_requests').select('id', { count: 'exact', head: true })
      .is('ordered_at', null),
    supabase.from('four_m_logs').select('id, work_date, line_name, category, description, status')
      .in('status', ['pending', 'pending_qa']).order('work_date', { ascending: true }).limit(200),
    supabase.from('meeting_action_items').select('id, problem, section, line_name, assignee, due_date, meeting_date, status')
      .in('status', ['open', 'doing']).order('due_date', { ascending: true, nullsFirst: false }).limit(100),
    loadProductionLines().catch(() => []),          // มี cache ร่วมกับ picker — ปกติไม่ยิงคิวรีเพิ่ม
  ]);

  /* `four_m_logs` ไม่มีคอลัมน์ส่วนงาน — เทียบขอบเขตผ่านทะเบียนไลน์ (ไลน์ → ส่วนงาน)
     ไลน์ที่ไม่อยู่ในทะเบียน = ตอบไม่ได้ว่าส่วนงานไหน ⇒ ปล่อย undefined ให้ inMyScope ตัดออกเอง */
  const secOfLine = new Map((lines || []).map(l => [String(l.name || '').trim().toLowerCase(), l.section]));
  const fourM = ok(fourR)?.map(f => ({
    ...f, section: secOfLine.get(String(f.line_name || '').trim().toLowerCase()),
  }));

  const mo = ok(moR)?.filter(o => !DEAD.includes(String(o.status || '')));

  const summaries = [];
  if (prR.error == null && Number(prR.count) > 0) {
    summaries.push({
      key: 'pr_unordered', icon: '🧾',
      title: `ใบขอซื้อรอกดสั่งซื้อ ${Number(prR.count).toLocaleString()} รายการ`,
      detail: 'ระบบระเบิดความต้องการสร้างให้ — ยังไม่มีเจ้าภาพกดสั่ง',
      count: Number(prR.count), to: '/line-stock',
    });
  }

  return buildQueue({ mo, sessions: ok(sesR), fourM, actions: ok(actR), summaries }, me);
}

/* ── UI ชิ้นเล็ก ────────────────────────────────────────────────────────── */

function Row({ it, onGo }) {
  const old = it.age != null && it.age >= OLD_DAYS;
  const body = (
    <>
      <span style={{ fontSize: 14, flexShrink: 0 }}>{it.icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {it.title}
        </span>
        {(it.detail || it.tag) && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[it.detail, it.tag].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      {it.age != null && (
        <span title={`ค้างมา ${it.age} วัน`} style={{
          flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
          color: old ? '#ef4444' : 'var(--muted)',
          background: old ? '#ef444418' : 'transparent',
        }}>{it.age}ว</span>
      )}
      {it.count != null && (
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>
          {it.count.toLocaleString()}
        </span>
      )}
    </>
  );
  const style = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
    padding: '6px 8px', borderRadius: 7, background: 'transparent',
    border: '1px solid transparent', color: 'var(--text2)', textDecoration: 'none',
  };
  return it.to
    ? <Link to={it.to} onClick={onGo} className="nav-link" style={style}>{body}</Link>
    : <div style={style}>{body}</div>;
}

function Group({ tier, items, onGo }) {
  const { shown, hidden } = capped(items, tier);
  const empty = EMPTY_TEXT[tier];
  if (!shown.length && !empty) return null;        // ชั้นโรงงานไม่มีของ = ไม่ต้องมีหัวข้อเปล่า
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', padding: '4px 8px 2px', letterSpacing: 0.2 }}>
        {TIER_TITLE[tier]}{shown.length ? ` · ${items.length}` : ''}
      </div>
      {shown.length === 0
        ? <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '2px 8px 6px' }}>{empty}</div>
        : shown.map(it => <Row key={it.key} it={it} onGo={onGo} />)}
      {hidden > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', padding: '2px 8px 0' }}>
          …อีก {hidden} รายการ
        </div>
      )}
    </div>
  );
}

/* ── hook: โหลด + ถือสถานะคิว ─────────────────────────────────────────────
   แยกจากตัววาดเพราะ **badge ต้องมีเลขแม้แผงปิดอยู่** — ถ้าโหลดอยู่ในตัววาด
   พอผู้ใช้ปิดแผง component จะ unmount แล้วเลขหาย (แล้วโหลดใหม่ทุกครั้งที่เปิด = เปลืองฟรี)
   @param {boolean} open  แผงเปิดอยู่ไหม — ใช้ตัดสินว่าถึงเวลารีเฟรชของเก่าหรือยัง */
export function useMyQueue(open = false) {
  const { sections, fullName } = useContext(UserContext);
  const [q, setQ] = useState(null);
  const [busy, setBusy] = useState(false);
  const atRef = useRef(0);
  const secKey = (sections || []).join('|');        // 🔴 array ใน deps = ยิงซ้ำฟรีๆ → แปลงเป็น string

  const load = useCallback(async () => {
    const actor = getActor();
    setBusy(true);
    try {
      const r = await loadMyQueue({
        uid: actor.uid, name: actor.name || fullName || null,
        sections: secKey ? secKey.split('|') : [],
      });
      setQ(r); atRef.current = Date.now();
    } catch {
      /* supabase-js คืน error ไม่ throw — มาถึงนี่ได้เฉพาะกรณีผิดปกติ ⇒ ถือว่าไม่ครบ ห้ามขึ้นว่าไม่มีงาน */
      setQ({ mine: [], unit: [], floor: [], counts: { mine: 0, unit: 0, floor: 0 }, missing: ['all'], partial: true });
    } finally { setBusy(false); }
  }, [secKey, fullName]);

  useEffect(() => { load(); }, [load]);             // รอบแรกตอน mount (1 ครั้ง/session)
  useEffect(() => {
    if (open && Date.now() - atRef.current > STALE_MIN * 60000) load();
  }, [open, load]);

  return { q, busy, reload: load, badge: badgeCount(q) };
}

/** ตัววาดล้วน — รับผลจาก `useMyQueue()` มาโชว์ (host เป็นคนถือ state) */
export default function MyQueuePanel({ q, busy, onGo }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 6 }}>
      {q?.partial && (
        <div style={{ fontSize: 11, color: '#f59e0b', padding: '4px 8px', lineHeight: 1.4 }}>
          ⚠️ โหลดข้อมูลไม่ครบ — รายการด้านล่าง<b>ไม่ใช่ทั้งหมด</b> อย่าเพิ่งสรุปว่าไม่มีงานค้าง
        </div>
      )}
      {!q && busy && <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '6px 8px' }}>กำลังดูคิวงาน…</div>}
      {q && (<>
        <Group tier={TIER.MINE} items={q.mine} onGo={onGo} />
        <Group tier={TIER.UNIT} items={q.unit} onGo={onGo} />
        <Group tier={TIER.FLOOR} items={q.floor} onGo={onGo} />
      </>)}
    </div>
  );
}
