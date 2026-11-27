/* 📈 มาตรฐานอนิเมชันกราฟ (utils/motion.js chartAnim · 20/11)
   1) เล่นเฉพาะในหน้าต่างหลังเปลี่ยนสิ่งที่ดู · รีเฟรชข้อมูลทีหลัง = ไม่เล่น
   2) ทุก series ของ Recharts ในรีโปต้องใส่ {...chartAnim()} — ลืมใส่ = Recharts ค่าเริ่มต้นเล่นซ้ำทุกรอบรีเฟรช (จอกระตุก) */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chartAnim, markView, CHART_ANIM_WINDOW_MS } from '../motion.js';

test('chartAnim: เปลี่ยนสิ่งที่ดู = เล่น · พ้นหน้าต่าง = นิ่ง', () => {
  markView(1_000_000);
  assert.equal(chartAnim(1_000_500).isAnimationActive, true);
  assert.equal(chartAnim(1_000_000 + CHART_ANIM_WINDOW_MS + 1).isAnimationActive, false);
});

test('ทุก series ของ Recharts ผ่าน chartAnim() (ด่านกันลืม)', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const bad = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
      if (!p.endsWith('.jsx')) continue;
      const s = fs.readFileSync(p, 'utf8');
      if (!s.includes("from 'recharts'")) continue;
      const re = /<(Bar|Line|Area|Pie|Radar|Scatter)(?=[\s/>])/g;
      let m;
      while ((m = re.exec(s))) {
        let j = re.lastIndex, depth = 0;
        for (; j < s.length; j++) { const c = s[j]; if (c === '{') depth++; else if (c === '}') depth--; else if (c === '>' && depth === 0) break; }
        if (!s.slice(m.index, j).includes('chartAnim()')) bad.push(`${path.relative(root, p)}:${s.slice(0, m.index).split('\n').length} <${m[1]}>`);
      }
    }
  };
  walk(root);
  assert.deepEqual(bad, [], `series ที่ยังไม่ใส่ {...chartAnim()}:\n${bad.join('\n')}`);
});
