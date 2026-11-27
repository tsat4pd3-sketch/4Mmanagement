import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* ══ 🎨 ด่าน gradient-delta-cap — ไล่เฉด "สีเดียว" ต้องจางจนแทบไม่ต่าง (20/11 · คำสั่ง user) ═══════════
   user: "อย่าให้ดูไล่เฉดเกินไป … ให้แทบจะเหมือนสีไม่ต่างกัน แต่ดูผ่านๆ แล้วรู้สึกมีมิติ"
   กฎ: ทุกคู่ token `--<ชื่อ>-top/-bot` และ `--<ชื่อ>-from/-to` ใน src/index.css (ทั้ง 2 ธีม)
     · hex  → ต่างกันได้ไม่เกิน 5 หน่วย lightness (HSL L 0–100) · ต้อง hue เดียวกัน (Δhue ≤ 12° · เทาเกือบล้วนไม่เช็ค hue)
     · rgba → สี rgb เท่ากัน · alpha ต่างกันไม่เกิน 0.06
   เพดานมาจากการวัดจริง 20/11: การ์ด Δ2.2% "แทบไม่เห็น" · ปุ่มหลัก Δ10.8% "เห็นว่าไล่" ⇒ ตั้งกลางที่ 5
   ห้ามแก้เพดานโดยไม่ถาม user — เพิ่มคู่ใหม่ได้ ต้องผ่านเพดานเดิม
   ═══════════════════════════════════════════════════════════════════════════════════════════════════ */
const CAP_L = 5, CAP_HUE = 12, CAP_A = 0.06;
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../index.css'), 'utf8');

function hsl(hex) {
  const n = hex.replace('#', ''); const r = parseInt(n.slice(0, 2), 16) / 255, g = parseInt(n.slice(2, 4), 16) / 255, b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2; let h = 0, s = 0;
  if (max !== min) { const d = max - min; s = d / (1 - Math.abs(2 * l - 1)); h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return { h, s, l: l * 100 };
}
const parseVal = (v) => {
  v = v.trim();
  let m = v.match(/^#([0-9a-f]{6})$/i); if (m) return { kind: 'hex', hex: '#' + m[1] };
  m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/i);
  if (m) return { kind: 'rgba', rgb: `${m[1]},${m[2]},${m[3]}`, a: m[4] == null ? 1 : Number(m[4]) };
  return null;
};

test('🎨 gradient-delta-cap — คู่ --x-top/--x-bot ใน index.css จางไม่เกินเพดาน (ธีมมืด+สว่าง)', () => {
  const blocks = [...css.matchAll(/(:root|\[data-theme="light"\][^{]*)\s*\{([^}]*)\}/g)];
  assert.ok(blocks.length >= 2, 'ต้องเจอทั้ง :root และบล็อกธีมสว่าง');
  let pairs = 0;
  for (const [, scope, body] of blocks) {
    const vars = {}; for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2];
    for (const name of Object.keys(vars)) {
      const suf = name.endsWith('-top') ? ['-top', '-bot'] : name.endsWith('-from') ? ['-from', '-to'] : null;
      if (!suf) continue;
      const base = name.slice(0, -suf[0].length); const bot = vars[base + suf[1]];
      assert.ok(bot, `${scope}: --${name} ไม่มีคู่ --${base}${suf[1]}`);
      const a = parseVal(vars[name]), b = parseVal(bot);
      assert.ok(a && b && a.kind === b.kind, `${scope}: --${base}-top/bot ต้องเป็น hex หรือ rgba ชนิดเดียวกัน`);
      pairs++;
      if (a.kind === 'hex') {
        const A = hsl(a.hex), B = hsl(b.hex); const dh = Math.min(Math.abs(A.h - B.h), 360 - Math.abs(A.h - B.h));
        assert.ok(Math.abs(A.l - B.l) <= CAP_L, `${scope}: --${base} ไล่เฉดแรงไป ΔL=${(A.l - B.l).toFixed(1)}% (เพดาน ${CAP_L}%)`);
        // เทาเกือบล้วน (s < 0.15) hue ไม่มีความหมาย — เช็คแค่ L
        if (A.s >= 0.15 && B.s >= 0.15) assert.ok(dh <= CAP_HUE, `${scope}: --${base} ไล่ข้ามสี Δhue=${dh.toFixed(0)}° (เพดาน ${CAP_HUE}°)`);
      } else {
        assert.equal(a.rgb, b.rgb, `${scope}: --${base} rgba ต้องสีเดียวกัน ต่างได้แค่ alpha`);
        assert.ok(Math.abs(a.a - b.a) <= CAP_A + 1e-9, `${scope}: --${base} Δalpha=${Math.abs(a.a - b.a).toFixed(2)} (เพดาน ${CAP_A})`);
      }
    }
  }
  assert.ok(pairs >= 14, `เจอคู่ top/bot แค่ ${pairs} — token หาย?`);
});
