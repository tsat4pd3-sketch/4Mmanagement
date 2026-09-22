import { useState, useEffect, useCallback } from 'react';
import { toast } from './Toast';
import { supabase, supabaseDR } from '../supabaseClient';
import { recompressLayouts } from '../utils/recompressLayouts';

/* ══ 🗜️ ImageSqueezePanel — แผงบีบรูปที่อัปไว้แล้วทั้งระบบ ═══════════════════════════
   ย้ายมาจาก `/linesetup` (2026-09-22 · คำสั่ง user: "ฟังก์ชันปุ่มบีบอัดรูปน่าจะอยู่ที่ setting")
   เหตุผลที่ user พูดถูก: งานนี้**ไม่ผูกกับไลน์ใดไลน์หนึ่ง** — มันกวาดทั้ง 6 กลุ่ม
   (ผังไลน์ · ผังโรงงาน · ผังเครื่องจักร · รูปจุดตรวจ PM · รูปซ่อม MO · รูปพนักงาน)
   เอาไปแขวนในหน้าตั้งค่าไลน์ = หาไม่เจอ (เคยหาไม่เจอมาแล้วรอบหนึ่ง จน user ต้องถามว่าปุ่มอยู่ไหน)

   กติกาความปลอดภัยของงาน (อัปใหม่ → DB สำเร็จ → ค่อยลบของเก่า ฯลฯ)
   อยู่ที่ `src/utils/recompressLayouts.js` หัวไฟล์ — **ห้ามลัดในหน้า**

   ทำไมต้องกดจากเบราว์เซอร์: ตัวบีบใช้ `canvas` ซึ่งมีแต่ในเบราว์เซอร์
   (script/Edge Function ทำไม่ได้ · และ session ของ AI ต่อ Supabase Storage ไม่ได้เพราะ proxy)
   ════════════════════════════════════════════════════════════════════════════════════ */

const card = {
  background: 'var(--card)', border: '1px solid var(--border2)',
  borderRadius: 'var(--radius-lg)', padding: 14,
};

export default function ImageSqueezePanel({ canRun = false, onDone }) {
  const [busy, setBusy] = useState('');       // '' = ว่าง · ข้อความ = กำลังทำอยู่
  const [scan, setScan] = useState(null);     // ผลสำรวจ { total, byGroup }
  const [scanning, setScanning] = useState(true);
  const [result, setResult] = useState(null); // สรุปรอบล่าสุด

  /* สำรวจอัตโนมัติตอนเปิดหน้า — อ่านแค่แถวใน DB ไม่โหลดรูป (ไม่มีค่า egress ของรูป)
     ⚠️ ต้องมี guard `alive` เพราะ await แล้ว setState (กฎเหล็กข้อ 4 stale-response) */
  const doScan = useCallback(async (alive = () => true) => {
    setScanning(true);
    try {
      const r = await recompressLayouts({ supabase, supabaseDR, scanOnly: true });
      if (alive()) setScan({ total: r.total, byGroup: r.byGroup || {} });
    } catch (e) {
      if (alive()) { setScan(null); toast.error('สำรวจรูปไม่สำเร็จ: ' + (e?.message || e)); }
    } finally { if (alive()) setScanning(false); }
  }, []);

  useEffect(() => {
    let ok = true;
    doScan(() => ok);
    return () => { ok = false; };
  }, [doScan]);

  const handleRun = async () => {
    if (busy) return;
    if (!window.confirm(
      'บีบรูปที่อัปไว้แล้วให้เล็กลง?\n\n'
      + 'ครอบคลุม: ผังไลน์ · ผังโรงงาน · ผังเครื่องจักร · รูปจุดตรวจ PM · รูปซ่อม MO · รูปพนักงาน\n'
      + 'ความละเอียดเท่าเดิม (ไม่เบลอ) แต่ไฟล์เล็กลงมาก — แปลงเป็น WebP\n\n'
      + 'ระบบจะทยอยทำเองจนจบ (อาจใช้เวลาหลายนาที) · ระหว่างนี้อย่าปิดหน้านี้\n'
      + 'ถ้าหลุดกลางคัน กดซ้ำได้ ของที่ทำไปแล้วจะถูกข้ามโดยไม่เสียค่าเน็ต'
    )) return;
    setBusy('กำลังเริ่ม…');
    setResult(null);
    try {
      /* 🔴 ทำ "รอบเดียวจบ" (`limit: 0`) — ห้ามกลับไปแบ่งล็อต (2026-09-22)
         เดิมแบ่งล็อต 150 ใบ/รอบ + หยุดเมื่อ "ล็อตนี้ done = 0" เพื่อกันวนไม่รู้จบ
         **แต่คิวถูกอุดด้วยงานที่ข้ามถาวร**: รูปจุดตรวจ PM ~198 ใบที่เล็กกว่าเกณฑ์อยู่แล้ว
         ถูกใส่คิวไว้หน้าสุดทุกรอบ (มันไม่เคยกลายเป็น .webp จึงไม่เคยหลุดออกจากลิสต์)
         ⇒ ล็อตแรกเป็น skip ทั้งก้อน → done = 0 → ตัวกันวนเข้าใจผิดว่า "ติดปัญหา" → หยุด
         ⇒ **รูปซ่อม MO 85 MB ซึ่งเป็นก้อนใหญ่สุดที่เหลือ ไม่เคยถูกแตะเลย**
            (เกิดจริง: user กด 3 ครั้ง ขนาดรวมไม่ลด — วัดจาก storage.objects 22/09)
         ตอนนี้ไม่มีล็อต = ไม่มีคิวถูกอุด · และ recompressOne ถาม HEAD ก่อนโหลด
         ⇒ ใบที่เล็กอยู่แล้วเสียแค่หัว request ไม่กินแบนด์วิดท์ */
      const r = await recompressLayouts({
        supabase, supabaseDR, limit: 0,
        onProgress: (text, i, n) => setBusy(`${text} (${i}/${n})`),
      });
      const all = { done: r.done, skip: r.skip, error: r.error, savedBytes: r.savedBytes, errors: r.errors };
      const remaining = r.remaining;
      const mb = (all.savedBytes / 1048576).toFixed(1);
      setResult({ ...all, remaining, stalled: false, mb });
      const left = remaining ? ` · เหลือ ${remaining} ใบ` : '';
      if (all.error) toast.error(`บีบเสร็จ ${all.done} ใบ (ประหยัด ${mb} MB) · ไม่สำเร็จ ${all.error}: ${all.errors[0]}${left}`);
      else if (remaining) toast.info(`บีบเสร็จ ${all.done} ใบ — ประหยัด ${mb} MB · ข้าม ${all.skip}${left} — กดซ้ำได้`);
      else toast.success(`บีบรูปเสร็จครบแล้ว ${all.done} ใบ — ประหยัด ${mb} MB · ข้าม ${all.skip} ใบ (เล็กอยู่แล้ว/เป็น WebP แล้ว)`);
      await onDone?.();
    } catch (err) {
      toast.error('บีบรูปไม่สำเร็จ: ' + (err?.message || err));
    } finally {
      setBusy('');
      doScan();          // ตัวเลข "เหลือ" ต้องตรงกับของจริงหลังทำเสร็จ
    }
  };

  const groups = Object.entries(scan?.byGroup || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6, minWidth: 220, flex: 1 }}>
            <b style={{ color: 'var(--text)', fontSize: 14 }}>🗜️ บีบรูปที่อัปไว้แล้วให้เล็กลง</b><br />
            แปลงเป็น <b>WebP</b> — <b>ความละเอียดเท่าเดิม ไม่เบลอ</b> แต่ไฟล์เล็กลงราวครึ่งหนึ่ง
            <br />
            <span style={{ color: 'var(--muted)' }}>
              รูปที่อัปใหม่หลังจากนี้ถูกบีบตั้งแต่ตอนอัปอยู่แล้ว — แผงนี้มีไว้ตามเก็บ “รูปเก่า”
              · กดซ้ำได้เรื่อยๆ ใบที่ทำแล้วถูกข้ามก่อนโหลด (ไม่เสียค่าเน็ตซ้ำ)
            </span>
          </div>
          <button
            onClick={handleRun}
            disabled={!canRun || !!busy || scanning || scan?.total === 0}
            title={!canRun ? 'ต้องมีสิทธิ์จัดการข้อมูลหลัก' : ''}
            style={{
              padding: '10px 16px', borderRadius: 8, border: 'none', flexShrink: 0,
              background: (!canRun || busy || scanning || scan?.total === 0) ? 'var(--bg3)' : 'var(--accent)',
              color: (!canRun || busy || scanning || scan?.total === 0) ? 'var(--text2)' : '#fff',
              fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-body)',
              cursor: (!canRun || busy || scanning || scan?.total === 0) ? 'default' : 'pointer',
              maxWidth: '100%', whiteSpace: 'normal', textAlign: 'center',
            }}>
            {busy || (scanning ? 'กำลังสำรวจ…' : scan?.total === 0 ? '✅ ไม่มีรูปค้างแล้ว' : `🗜️ เริ่มบีบ ${scan?.total ?? ''} ใบ`)}
          </button>
        </div>
        {!canRun && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--accent2)' }}>
            คุณดูได้แต่กดไม่ได้ — ปุ่มนี้ต้องมีสิทธิ์ <code>storage_maintain:run</code> (ตั้งที่ /permissions)
          </div>
        )}
      </div>

      {/* 📋 เหลือให้ทำกี่ใบ แยกตามกลุ่ม — กฎความซื่อสัตย์ของจอ: ยังไม่รู้ ต้องเขียนว่ายังไม่รู้ ห้ามโชว์ 0 */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          📋 รูปที่ยังไม่ได้บีบ
          <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--muted)', marginLeft: 8 }}>
            (นับจากแถวในฐานข้อมูล ไม่ได้โหลดรูป — ไม่มีค่าเน็ต)
          </span>
        </div>
        {scanning ? (
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>กำลังสำรวจ…</div>
        ) : !scan ? (
          <div style={{ fontSize: 12.5, color: 'var(--accent2)' }}>
            สำรวจไม่สำเร็จ — ยังไม่รู้ว่าเหลือกี่ใบ{' '}
            <button onClick={() => doScan()} style={linkBtn}>ลองใหม่</button>
          </div>
        ) : scan.total === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>
            ✅ ไม่มีรูปค้าง — ทุกกลุ่มเป็น WebP แล้ว
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
            {groups.map(([g, n]) => (
              <div key={g} style={{
                display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5,
                padding: '5px 8px', background: 'var(--bg2)', borderRadius: 6,
              }}>
                <span style={{ color: 'var(--text2)' }}>{g}</span>
                <b style={{ color: 'var(--text)', flexShrink: 0 }}>{n.toLocaleString()} ใบ</b>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, paddingTop: 4 }}>
              <span style={{ color: 'var(--text2)' }}>รวม</span>
              <b style={{ color: 'var(--accent2)' }}>{scan.total.toLocaleString()} ใบ</b>
            </div>
            <button onClick={() => doScan()} disabled={!!busy} style={{ ...linkBtn, justifySelf: 'start', marginTop: 2 }}>
              🔄 สำรวจใหม่
            </button>
          </div>
        )}
      </div>

      {result && (
        <div style={{ ...card, borderColor: result.error ? '#ef4444' : 'var(--accent)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>ผลรอบล่าสุด</div>
          <div style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.7 }}>
            บีบสำเร็จ <b style={{ color: 'var(--accent)' }}>{result.done.toLocaleString()} ใบ</b>{' '}
            · ประหยัดพื้นที่/ค่าเน็ต <b style={{ color: 'var(--accent)' }}>{result.mb} MB</b><br />
            ข้าม {result.skip.toLocaleString()} ใบ <span style={{ color: 'var(--muted)' }}>(เล็กอยู่แล้ว / เป็น WebP แล้ว / บีบแล้วไม่เล็กลงพอ)</span>
            {result.error > 0 && (<><br /><span style={{ color: '#ef4444' }}>ไม่สำเร็จ {result.error} ใบ</span></>)}
            {result.remaining > 0 && (<><br />เหลืออีก <b>{result.remaining.toLocaleString()} ใบ</b>{result.stalled ? ' — หยุดไว้เพราะรอบล่าสุดไม่คืบหน้า (มีไฟล์เสีย)' : ' — กดซ้ำได้'}</>)}
          </div>
          {result.errors.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11.5, color: 'var(--muted)' }}>
              {result.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
              {result.errors.length > 8 && <li>… อีก {result.errors.length - 8} รายการ</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const linkBtn = {
  background: 'none', border: '1px solid var(--border2)', borderRadius: 6,
  color: 'var(--text2)', fontSize: 11.5, padding: '4px 10px', cursor: 'pointer',
  fontFamily: 'var(--font-body)',
};
