import { useState } from 'react'
import SearchInput from '../SearchInput'
import { cpJumpMatches } from '../../utils/cpJump'

/* 🎯 แถบ "ไปที่จุด" — ชิปทุกจุด + ช่องค้นเลข/ชื่อ/กลุ่ม (Enter = ไปจุดแรกที่ตรง)
   ใช้ร่วม PM + QA (กติกาจับคู่ `cpJumpMatches` ที่เดียว) · ชิปจุดที่ยังไม่มีชื่อ = กรอบประแดง
   points: [{ _key, name, group_name }] เรียงตามลำดับบนจอ · labels: { _key: '1.3' }
   compact = แถวเดียวเลื่อนแนวนอน (จอแคบที่รูปตรึงอยู่บนหัว) */
const jumpBtn = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer',
  border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text2)',
}

export default function PointJumpBar({ points, labels, onJump, flashKey, compact, onTop }) {
  const [q, setQ] = useState('')
  const hits = cpJumpMatches(q, points, labels)
  return (
    <div style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', gap: 6, marginTop: 8, alignItems: compact ? 'center' : 'stretch' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: compact ? '0 0 150px' : undefined }}>
        <SearchInput value={q} onChange={setQ} placeholder={compact ? 'ไปที่จุด…' : 'ไปที่จุด — พิมพ์เลข (1.3) / ชื่อ / กลุ่ม แล้วกด Enter'}
          ariaLabel="ไปที่จุดตรวจ"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (hits[0]) onJump(hits[0]._key) } }} />
        {!compact && (
          <>
            <button type="button" onClick={onTop} title="กลับขึ้นบนสุด" style={jumpBtn}>⤒ บนสุด</button>
            <button type="button" onClick={() => { const last = points[points.length - 1]; if (last) onJump(last._key) }}
              title="ไปจุดสุดท้าย" style={jumpBtn}>⤓ ท้ายสุด</button>
          </>
        )}
      </div>
      <div style={compact
        ? { display: 'flex', gap: 4, overflowX: 'auto', flex: 1, minWidth: 0, paddingBottom: 2 }
        : { display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 74, overflowY: 'auto', alignContent: 'start' }}>
        {hits.map(c => {
          const blank = !String(c.name ?? '').trim()
          return (
            <button key={c._key} type="button" onClick={() => onJump(c._key)}
              title={`${labels[c._key]} · ${blank ? '(ยังไม่ตั้งชื่อ)' : c.name}${c.group_name ? ` — ${c.group_name}` : ''}`}
              style={{ flex: '0 0 auto', padding: '3px 8px', borderRadius: 12, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                border: `1px ${blank ? 'dashed' : 'solid'} ${blank ? 'var(--red)' : flashKey === c._key ? 'var(--accent)' : 'var(--border2)'}`,
                background: flashKey === c._key ? 'var(--accent-dim)' : 'var(--bg3)',
                color: blank ? 'var(--red)' : 'var(--text)' }}>
              {labels[c._key]}<span style={{ fontWeight: 500, color: blank ? 'var(--red)' : 'var(--muted)' }}> {blank ? 'ไม่มีชื่อ' : c.name}</span>
            </button>
          )
        })}
        {hits.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted)', padding: '3px 0' }}>ไม่พบจุดที่ตรงกับ "{q}"</span>}
      </div>
    </div>
  )
}
