/* ══ PushCoveragePanel — "ใครยังไม่มีเครื่องรับแจ้งเตือนเข้ามือถือ" (2026-10-20) ═══════════
   ที่มา: feedback 20/10 *"มือถือ ไม่มีการแจ้งเตือนใบแจ้งซ่อมมา 2-3 วัน เกิดจากเรื่องสิทธิ์รึป่าว"*
   ไล่แล้วไม่ใช่เรื่องสิทธิ์ — แถวแจ้งเตือนเกิดครบ · edge ส่งสำเร็จ · แต่ **คนส่วนใหญ่ไม่มีเครื่องผูกไว้เลย**
   (วัด 20/10: ผู้รับแจ้งเตือน 7 วัน 102 คน · มีเครื่อง 28 · ไม่มี 74 — ในนั้นได้แจ้งเตือน MO ด้วย 55 คน)
   แผงเปิด push ซ่อนอยู่ในกระดิ่ง ⇒ คนไม่รู้ว่าตัวเองยังไม่ได้เปิด **และแอดมินไม่มีจอไหนเห็นว่าใครหลุด**

   🔴 ข้อมูลมาจาก RPC `push_coverage()` เท่านั้น — `push_subscriptions`/`notifications` RLS
      เปิดให้เห็นเฉพาะแถวของตัวเอง ⇒ ฝั่งจอนับของคนอื่นเองไม่ได้
   🔴 **ลิสต์ว่าง 2 ความหมาย** (CLAUDE.md ข้อ 12) — RPC โยน `42501` เมื่อไม่มีสิทธิ์
      ⇒ "ว่าง" ที่นี่แปลว่า "ไม่มีใครได้รับแจ้งเตือนในช่วงนี้" เท่านั้น · อ่านไม่ได้ = เขียนบนจอ ห้ามโชว์ 0
   ⚠️ ตัวเลขนับจาก **คนที่ได้รับแจ้งเตือนในแอปจริงในช่วงนั้น** ไม่ใช่พนักงานทั้งหมด — ข้อความบนจอต้องตรงกัน */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { naturalCompare } from '../utils/listOrder';
import { pushCoverageFailText } from '../utils/pushPrompt';

const DAYS = 7;
const card = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
  padding: 14, marginBottom: 26, boxShadow: 'var(--shadow-sm)',
};

export default function PushCoveragePanel() {
  const [rows, setRows]   = useState(null);   // null = ยังไม่รู้ (โหลด/ล้ม) · [] = รู้แล้วว่าไม่มีใคร
  const [fail, setFail]   = useState(null);
  const [busy, setBusy]   = useState(true);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => {
    let alive = true;                      // กัน stale-response (กฎเหล็กข้อ 4)
    setBusy(true);
    supabase.rpc('push_coverage', { p_days: DAYS }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setFail(pushCoverageFailText(error)); setRows(null); }
      else { setFail(null); setRows(data || []); }
      setBusy(false);
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => load(), [load]);

  const stat = useMemo(() => {
    if (!rows) return null;
    const noDev = rows.filter(r => (r.devices || 0) === 0);
    return {
      total: rows.length,
      hasDev: rows.length - noDev.length,
      noDev,
      noDevMtn: noDev.filter(r => Number(r.n_mtn) > 0).length,
      pct: rows.length ? Math.round(100 * (rows.length - noDev.length) / rows.length) : null,
    };
  }, [rows]);

  /* เรียงคนที่ต้องตามก่อน: ได้แจ้งเตือน MO เยอะสุดขึ้นก่อน แล้วค่อยยอดรวม
     ส่วนงานเรียงชื่อธรรมชาติ (utils/listOrder — ห้าม .sort() ดิบ · UI §5.3) */
  const bySection = useMemo(() => {
    if (!stat) return [];
    const m = new Map();
    for (const r of stat.noDev) {
      const k = r.section || '— ไม่ระบุส่วนงาน';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    for (const list of m.values()) {
      list.sort((a, b) => Number(b.n_mtn) - Number(a.n_mtn)
        || Number(b.n_notif) - Number(a.n_notif)
        || naturalCompare(a.full_name || '', b.full_name || ''));
    }
    return [...m.entries()].sort((a, b) => naturalCompare(a[0], b[0]));
  }, [stat]);

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800 }}>📲 เครื่องที่รับแจ้งเตือนเข้ามือถือ</span>
        <button onClick={load} disabled={busy}
          style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)', background: 'none',
                   border: 'none', cursor: busy ? 'default' : 'pointer', padding: 0, textDecoration: 'underline' }}>
          {busy ? 'กำลังโหลด…' : 'โหลดใหม่'}
        </button>
      </div>

      {/* อ่านไม่ได้ = เขียนบนจอ ห้ามโชว์ 0 แล้วให้คนเข้าใจว่า "ครบแล้ว" */}
      {fail && (
        <div style={{ fontSize: 12, color: 'var(--accent2)', lineHeight: 1.6 }}>
          ⚠️ {fail}<br />
          <span style={{ color: 'var(--muted)' }}>ยังไม่ทราบว่ามีใครไม่ได้รับแจ้งเตือนบนมือถือ — ตัวเลขด้านล่างจึงไม่แสดง</span>
        </div>
      )}

      {busy && !fail && <div style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังอ่านข้อมูล…</div>}

      {!busy && !fail && stat && (
        <>
          <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            {stat.total === 0 ? (
              <span style={{ color: 'var(--muted)' }}>
                ช่วง {DAYS} วันที่ผ่านมา ยังไม่มีใครได้รับแจ้งเตือนในแอปเลย — จึงยังไม่มีอะไรให้เทียบ
              </span>
            ) : (
              <>
                <b style={{ color: stat.pct >= 80 ? 'var(--accent)' : 'var(--accent2)' }}>
                  มีเครื่องรับแจ้งเตือน {stat.hasDev} จาก {stat.total} คน ({stat.pct}%)
                </b>
                {stat.noDev.length > 0 && (
                  <>
                    {' · '}<b style={{ color: 'var(--accent2)' }}>{stat.noDev.length} คนมือถือไม่เคยเด้ง</b>
                    {stat.noDevMtn > 0 && <> (ในนั้นได้แจ้งเตือนใบซ่อม {stat.noDevMtn} คน)</>}
                  </>
                )}
                <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 3 }}>
                  นับจาก <b>คนที่ได้รับแจ้งเตือนในแอปจริงใน {DAYS} วันล่าสุด</b> ไม่ใช่พนักงานทั้งหมด ·
                  คนที่ไม่มีเครื่องยัง<b>เห็นกระดิ่งในแอปครบ</b> แต่มือถือไม่เด้ง
                </div>
              </>
            )}
          </div>

          {stat.noDev.length > 0 && (
            <>
              <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg2)',
                            border: '1px solid var(--border)', fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.6 }}>
                วิธีให้เขาเปิดเอง: เปิดเว็บ ESM <b>บนมือถือเครื่องนั้น</b> → กดกระดิ่ง 🔔 ที่หัวจอ → กดปุ่ม <b>"เปิด"</b> ในแถบ
                "📲 เด้งแจ้งเตือนเข้ามือถือ" → กด <b>"ทดสอบส่ง"</b> เพื่อพิสูจน์ว่าเด้งถึงจริง<br />
                <b>iPhone</b> ต้องกด "แชร์ → เพิ่มไปยังหน้าจอโฮม" แล้วเปิดจากไอคอนนั้นก่อน (iOS บังคับ)
              </div>

              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(showAll ? bySection : bySection.slice(0, 4)).map(([sec, list]) => (
                  <div key={sec}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--text2)', marginBottom: 3 }}>
                      {sec} · {list.length} คน
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {list.map(r => (
                        <span key={r.user_id}
                          title={`แจ้งเตือนใน ${DAYS} วัน ${r.n_notif} รายการ (ใบซ่อม ${r.n_mtn}) · ยังไม่มีเครื่องผูกไว้`}
                          style={{ fontSize: 11, padding: '2px 7px', borderRadius: 999,
                                   border: '1px solid var(--border)', background: 'var(--card)', whiteSpace: 'nowrap' }}>
                          {r.full_name || '(ไม่มีชื่อ)'}
                          <b style={{ color: 'var(--muted)', fontWeight: 600 }}> · {r.n_notif}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {bySection.length > 4 && (
                  <button onClick={() => setShowAll(v => !v)}
                    style={{ alignSelf: 'flex-start', fontSize: 11, color: 'var(--accent)', background: 'none',
                             border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                    {showAll ? 'ย่อ' : `ดูอีก ${bySection.length - 4} ส่วนงาน`}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
