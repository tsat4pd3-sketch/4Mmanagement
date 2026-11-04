/* ══ 📺 บอร์ดใบแจ้งซ่อม MO สำหรับจอ TV ห้องช่าง (`/tv?dept=mo`) — 2026-11-03 · ประชุม 02/11 ข้อ B6 ═══════
   *"จอ TV ทีม MTN วนหน้า MO อัตโนมัติ — รอรับงาน / กำลังซ่อม / รอตรวจ"*

   ⚠️ **ไม่ใช่หน้าใหม่** — เป็นมุมมองที่ 4 ของ Andon Board (`/tv`) ซึ่งเป็นจอ "แขวนไว้อย่างเดียว" อยู่แล้ว
      (บัญชีจอมีสิทธิ์ `/tv` อยู่แล้ว · ไม่ต้อง seed สิทธิ์ใหม่) · `/mtn-repair` เป็นจอทำงาน (กด/กรอก)
      หนักเกินจอทีวี จึงไม่เอาไปแขวน
   · เลือกกองด้วย URL: `?mo=approve|accept|repair|check|close|other` (ว่าง = ทุกกอง) · `?team=<คีย์ทีม>`
     ⇒ ตั้งรอบวนที่ `/display-rotation` เป็น 3-4 รายการของ `/tv` คนละ `mo=` (มีปุ่มชุดสำเร็จรูป)
   · กฎตัดสินกอง/อายุ = `utils/moTvBoard.js` (pure · มีเทส) — **ห้ามถามเลขขั้นเองที่นี่**
   · สด: `useLiveBoard` (realtime `mtn_orders` + เพดาน coalesce + poll กันเหนียวข้ามรอบเมื่อไม่มีอะไรเปลี่ยน)
     นาฬิกา "ค้างมา X" เดินเองทุกนาทีโดยไม่ยิงฐาน
   · จอ TV: ตัวใหญ่ (`tvSizer` · พื้น 20px) · ยาวเกินจอ = แบ่งหน้าหมุนเอง (`useTvPager` + `data-tv-item`)
     ไม่มีปุ่มให้กด · ชิปกองบนจอคอมกดสลับได้ แต่บน TV เป็นป้ายเฉยๆ
   ══════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabaseDR } from '../supabaseClient';
import { useLiveBoard } from '../utils/useLiveBoard';
import { RATE } from '../utils/refreshRates';
import useTvShell, { tvSizer } from '../utils/useTvShell';
import useTvPager from '../utils/useTvPager';
import TvPagerBar from './TvPagerBar';
import { statusColor } from '../utils/statusTone';
import { deptNameOf, teamKeyOf } from '../utils/mtnTeams';
import { assignedTechsOf, joinTechs } from '../utils/mtnPurchase';
import { moStatusLabel } from '../utils/mtnStepPerm';
import {
  buildMoTvBoard, fmtWait, moTvGroupMeta, MO_TV_GROUPS, MO_TV_COLS, MO_TV_DONE_FILTER,
} from '../utils/moTvBoard';

/** เพดานแถว — ใบเปิดทั้งโรงงาน ~400 ใบ (13/10) · ชนเพดาน = จอเขียนบอกว่าอาจไม่ครบ */
const CAP = 1000;

export default function MoTvBoard({ inScope, isMobile = false }) {
  const [sp, setSp] = useSearchParams();
  const tv = useTvShell();
  const fz = tvSizer(tv);
  const group = sp.get('mo') || '';
  const teamRaw = sp.get('team') || '';
  const team = teamRaw && teamRaw !== 'all' ? teamKeyOf(teamRaw) : '';

  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const { data, error } = await supabaseDR.from('mtn_orders').select(MO_TV_COLS)
      .not('status', 'in', MO_TV_DONE_FILTER)
      .order('report_at', { ascending: true }).limit(CAP);
    if (error) { setErr(error.message || 'โหลดใบ MO ไม่สำเร็จ'); return; }
    setErr(null);
    setRows(data || []);
    setNow(Date.now());
  }, []);
  useLiveBoard(load, { tables: ['mtn_orders'], topic: 'tv-mo-board', rate: RATE.BOARD });

  // นาฬิกา "ค้างมา X" — คำนวณใหม่จากแถวเดิม ไม่ยิงฐาน
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const board = useMemo(() => buildMoTvBoard(rows || [], {
    group, team, teamOf: (o) => teamKeyOf(o?.mtn_dept), inScope: inScope || (() => true), now,
  }), [rows, group, team, inScope, now]);

  const g = moTvGroupMeta(group);
  const title = g ? `${g.icon} ${g.label}` : '🧾 ใบแจ้งซ่อม MO ที่ยังไม่ปิด · ทุกขั้น';
  const teamLabel = team ? deptNameOf(team) : 'ทุกทีมช่าง';

  const boxRef = useRef(null);
  const pager = useTvPager(boxRef, {
    enabled: !isMobile,
    dataKey: `${group}|${team}|${board.rows.length}|${rows ? 1 : 0}`,
  });

  const setGroup = (k) => {
    if (tv) return;   // จอ TV ไม่มีใครกด — ค่ามาจาก /display-rotation (UI §6.33)
    const n = new URLSearchParams(sp);
    if (k) n.set('mo', k); else n.delete('mo');
    setSp(n, { replace: true });
  };

  const worst = board.rows.some(r => r.tone === 'bad') ? 'bad' : board.rows.some(r => r.tone === 'warn') ? 'warn' : 'none';
  const edge = worst === 'none' ? 'var(--border2)' : statusColor(worst);
  const cols = tv ? 'repeat(auto-fill, minmax(560px, 1fr))' : 'repeat(auto-fill, minmax(320px, 1fr))';

  return (
    <div data-tv-nofit={!isMobile ? '' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: tv ? 14 : 10 }}>
      {/* ── กล่องสถานะหัวจอ: ซ้าย "ตอนนี้ดูกองไหน" ตัวใหญ่ · ขวาตัวนับ (UI §6.33 หน้าตาชุดเดียวกับ Andon) ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: tv ? '14px 20px' : '10px 14px',
        borderRadius: 12, background: 'var(--card)', border: `2px solid ${edge}`, boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ fontSize: fz(18, 40), fontWeight: 900, color: 'var(--text)', lineHeight: 1.2 }}>{title}</div>
        <div style={{ fontSize: fz(13, 24), color: 'var(--text2)', fontWeight: 700 }}>{teamLabel}</div>
        <div style={{ marginLeft: 'auto', fontSize: fz(26, 60), fontWeight: 900, color: worst === 'none' ? 'var(--text)' : statusColor(worst), lineHeight: 1 }}>
          {rows ? board.rows.length : '…'} <span style={{ fontSize: fz(13, 26), fontWeight: 700, color: 'var(--text2)' }}>ใบ</span>
        </div>
      </div>

      {/* ── ภาพรวมทุกกอง (ป้าย) — จอคอมกดสลับกองได้ · จอ TV เป็นป้ายอ่านอย่างเดียว ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[{ key: '', icon: '🧾', label: 'ทุกขั้น' }, ...MO_TV_GROUPS].map(x => {
          const n = x.key ? board.counts[x.key] : board.total;
          const on = (group || '') === x.key || (board.badGroup && !x.key);
          if (x.key === 'other' && !n) return null;   // ตะกร้ารับท้ายว่าง = ไม่ต้องกินที่
          return (
            <button key={x.key || 'all'} type="button" onClick={() => setGroup(x.key)} disabled={tv}
              style={{
                fontSize: fz(12.5, 22), fontWeight: 800, padding: tv ? '6px 16px' : '5px 12px', borderRadius: 999,
                cursor: tv ? 'default' : 'pointer', opacity: 1,
                background: on ? 'var(--accent)' : 'var(--bg3)', color: on ? 'var(--accent-ink)' : 'var(--text)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
              }}>
              {x.icon} {x.label} · {rows ? n : '…'}
            </button>
          );
        })}
      </div>

      {/* 🔴 ความซื่อสัตย์ของจอ — ห้ามซ่อนบน TV (ย่อเป็นบรรทัดสั้นตัวใหญ่) */}
      {err && <Warn tv={tv} fz={fz}>⚠ โหลดใบ MO ไม่สำเร็จ — ตัวเลขบนจอยังไม่ใช่ของจริง ({err})</Warn>}
      {board.badGroup && <Warn tv={tv} fz={fz}>⚠ ค่า mo=&quot;{group}&quot; ไม่รู้จัก — แสดงทุกขั้นแทน (แก้ลิงก์ที่หน้าตั้งค่าจอวน)</Warn>}
      {rows && rows.length >= CAP && <Warn tv={tv} fz={fz}>⚠ ใบเปิดเกิน {CAP} ใบ — จออาจแสดงไม่ครบ</Warn>}

      {/* ที่ซ่อน/ประมาณ — เขียนให้เห็นเสมอ (กรองแล้วต้องบอกว่าซ่อนกี่รายการ)
          วางก่อนกล่องแบ่งหน้า: useTvPager ตั้งความสูงกล่องถึงขอบล่างจอ ⇒ ของที่อยู่ใต้กล่องตกจอ */}
      {(board.hiddenScope > 0 || board.hiddenTeam > 0 || board.approxAge > 0 || board.unknownAge > 0) && (
        <div style={{ fontSize: fz(11.5, 20), color: 'var(--text2)' }}>
          {board.hiddenTeam > 0 && `ไม่นับใบของทีมอื่น ${board.hiddenTeam} ใบ · `}
          {board.hiddenScope > 0 && `ไม่นับใบนอกส่วนงานของจอนี้ ${board.hiddenScope} ใบ · `}
          {board.approxAge > 0 && `≈ ${board.approxAge} ใบนับจากเวลาแจ้ง (ไม่มีเวลาเข้าขั้น) · `}
          {board.unknownAge > 0 && `${board.unknownAge} ใบไม่รู้ว่าค้างมานานเท่าไหร่ · `}
          ค้างมา = นับจากเวลาที่ใบเข้าขั้นปัจจุบัน
        </div>
      )}
      <div ref={boxRef}>
        {rows && board.rows.length === 0 && !err && (
          <div data-tv-item style={{ textAlign: 'center', padding: tv ? 48 : 28, color: 'var(--text2)', fontSize: fz(15, 32), fontWeight: 800 }}>
            ✅ ไม่มีใบค้างในกองนี้
          </div>
        )}
        {!rows && !err && <div style={{ textAlign: 'center', padding: 28, color: 'var(--muted)', fontSize: fz(14, 26) }}>กำลังโหลด...</div>}
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: tv ? 14 : 10, alignContent: 'start' }}>
          {board.rows.map(r => <MoCard key={r.o.id} r={r} tv={tv} fz={fz} showStage={!g} />)}
        </div>
      </div>

      <TvPagerBar pager={pager} />
    </div>
  );
}

function Warn({ tv, fz, children }) {
  return (
    <div role="alert" style={{ background: 'var(--card)', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 10, padding: tv ? '10px 16px' : 10, fontSize: fz(13, 24), fontWeight: 700 }}>
      {children}
    </div>
  );
}

function MoCard({ r, tv, fz, showStage }) {
  const o = r.o;
  const ink = r.tone === 'none' ? 'var(--text)' : statusColor(r.tone);
  const techs = joinTechs(assignedTechsOf(o));
  const reporter = o.reported_by_name || o.reporter_prod || '';
  return (
    <div data-tv-item style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderLeft: `6px solid ${r.tone === 'none' ? 'var(--border2)' : ink}`,
      borderRadius: 12, padding: tv ? '14px 18px' : '10px 12px', boxShadow: 'var(--shadow-sm)',
      display: 'flex', flexDirection: 'column', gap: tv ? 6 : 4, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: fz(14, 28), color: 'var(--text)' }}>{o.mo_no || '(ยังไม่ออกเลข)'}</span>
        <span style={{ marginLeft: 'auto', fontWeight: 900, fontSize: fz(18, 40), color: ink, whiteSpace: 'nowrap' }}>
          {r.exact || r.ageMin == null ? '' : '≈'}{fmtWait(r.ageMin)}
        </span>
      </div>
      <div style={{ fontSize: fz(14, 28), fontWeight: 800, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        🏭 {o.machine_no || '–'}{o.line_name ? ` · ${o.line_name}` : ''}
      </div>
      <div style={{ fontSize: fz(13, 24), color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {o.problem_characteristic || o.problem_group || o.item_type || '–'}
      </div>
      <div style={{ fontSize: fz(12, 22), color: 'var(--text2)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>🔧 {deptNameOf(o.mtn_dept) || '–'}</span>
        {showStage && <span style={{ fontWeight: 800, color: 'var(--text)' }}>{r.waitIcon} {r.waitTitle}</span>}
        {!showStage && r.waitWho && <span>รอ: {r.waitWho}</span>}
        {techs ? <span>👷 {techs}</span> : (reporter && <span>ผู้แจ้ง: {reporter}</span>)}
        {r.group === 'other' && <span>{moStatusLabel(o)}</span>}
      </div>
    </div>
  );
}
