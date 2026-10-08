/* ══════════════════════════════════════════════════════════════════════
   หลักฐานสะสมของทักษะ (EXP v2) — "ทำไมถึงได้คะแนนนี้" ต้องตอบได้บนจอ
   2026-09-24 · ISO 9001:2015 §7.2 / IATF 16949 §7.2.1 ต้องประเมินประสิทธิผล
   ไม่ใช่แค่บอกว่าผ่าน ⇒ คนอนุมัติต้องเห็นของจริงก่อนกดปุ่ม

   ใช้ที่ไหน: การ์ดคำขอเลื่อนขั้นใน /operator ⬆️ · (เผื่อ) SkillRadarPanel
   props: ev = แถวจาก employee_skill_evidence · cfg = แถวจาก skill_exp_config
   🔴 ห้ามคำนวณคะแนนในนี้ — อ่านค่าที่ DB คำนวณมาแล้วเท่านั้น (ดู utils/skillExp.js)
   ══════════════════════════════════════════════════════════════════════ */
import { bandProgress, cyclesToNextBand, evidenceState, shadowDelta } from '../utils/skillExp';

const box = {
  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 7,
  padding: '8px 10px', minWidth: 104, flex: '1 1 104px',
};
const capLabel = { fontSize: 11, color: 'var(--muted)', marginBottom: 2 };
const capValue = { fontSize: 14, fontWeight: 800, lineHeight: 1.2 };

const nf = (n) => (n == null ? '–' : Number(n).toLocaleString('th-TH'));

export default function SkillEvidencePanel({ ev, cfg, currentScore = null, compact = false }) {
  const st = evidenceState(ev);

  if (!ev) {
    return (
      <div style={{ ...box, flex: 1, borderStyle: 'dashed', color: 'var(--muted)', fontSize: 12 }}>
        ยังไม่มีข้อมูลหลักฐานสำหรับทักษะนี้ — คนนี้ยังไม่เคยลงเวลาที่สถานีที่ต้องใช้ทักษะนี้
      </div>
    );
  }

  const parts   = ev.parts_seen?.length ?? 0;
  const prog    = bandProgress(ev.cum_cycles, cfg?.n_ref_default, ev.cur_band, cfg);
  const left    = cyclesToNextBand(ev.cum_cycles, cfg?.n_ref_default, ev.cur_band, cfg);
  const delta   = shadowDelta(currentScore, ev.shadow_score);
  const missing = ev.gate_missing || [];

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>● {st.label}</span>
        {/* 🔴 ประเมินไม่ได้ ≠ คะแนน 0 — ต้องเขียนบนจอตรงๆ ห้ามโชว์ 0 (กฎความซื่อสัตย์ของจอ) */}
        {ev.shadow_score == null ? (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            ไลน์นี้ยังไม่มีข้อมูลยอดผลิตในระบบ — ระบบยังตัดสินขา "ปริมาณ" ไม่ได้
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
            คะแนนตามสูตรใหม่ <strong style={{ color: 'var(--text)' }}>{ev.shadow_score}</strong>
            {delta != null && delta !== 0 && (
              <span style={{ color: delta > 0 ? '#22c55e' : '#f59e0b', fontWeight: 700 }}>
                {' '}({delta > 0 ? '+' : ''}{delta} จากคะแนนปัจจุบัน)
              </span>
            )}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={box}>
          <div style={capLabel}>📈 รอบสะสม</div>
          <div style={capValue}>{nf(ev.cum_cycles)}</div>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--border2)', marginTop: 5, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.round(prog * 100)}%`, background: 'var(--accent)' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            {left == null ? 'ขั้นสูงสุด' : `อีก ${nf(left)} รอบถึงเพดานขั้น`}
          </div>
        </div>

        <div style={box}>
          <div style={capLabel}>🎯 ของเสียเทียบไลน์</div>
          <div style={{ ...capValue, color: ev.quality_ok === false ? '#ef4444' : 'var(--text)' }}>
            {ev.ng_ratio == null ? '–' : `${Number(ev.ng_ratio).toFixed(2)}x`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            {ev.ng_ratio == null ? 'ข้อมูลไม่พอตัดสิน' : `เพดาน ${cfg?.quality_max_ratio ?? '–'}x`}
          </div>
        </div>

        <div style={box}>
          <div style={capLabel}>🔀 ความหลากหลาย</div>
          <div style={capValue}>{parts} รุ่น</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            เปลี่ยนรุ่น {nf(ev.n_changeover)} · เจอเหตุ {nf(ev.n_abnormal)} วัน
          </div>
        </div>

        <div style={box}>
          <div style={capLabel}>📜 การรับรอง</div>
          <div style={capValue}>
            {ev.has_ojt ? '✅' : '—'} OJT {ev.is_trainer ? ' · 👨‍🏫' : ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
            {ev.ojt_post_score != null ? `คะแนนสอบ ${ev.ojt_post_score}` : 'ไม่มีคะแนนสอบ'}
            {ev.is_trainer ? ' · เคยเป็นผู้สอน' : ''}
          </div>
        </div>

        {!compact && (
          <div style={box}>
            <div style={capLabel}>🗓️ มาทำงาน</div>
            <div style={capValue}>{nf(ev.days_worked)} วัน</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
              ล่าสุด {ev.last_worked_date || '–'}
            </div>
          </div>
        )}
      </div>

      {missing.length > 0 && (
        <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 7, fontSize: 12,
                      background: 'var(--bg2)', border: '1px solid rgba(245,158,11,0.35)' }}>
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>ยังขาด:</span>{' '}
          <span style={{ color: 'var(--text2)' }}>{missing.join(' · ')}</span>
        </div>
      )}
    </div>
  );
}
