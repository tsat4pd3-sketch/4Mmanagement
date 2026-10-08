import React from 'react'
import { createRoot } from 'react-dom/client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts'
import '../src/index.css'
const data = [{ l: '21/9', v: 100 }, { l: '22/9', v: 100 }, { l: '23/9', v: 100 }, { l: '24/9', v: 100 }]
const big = [{ l: '1', v: 120000 }, { l: '2', v: 870000 }, { l: '3', v: 1250000 }]
const tick = fs => ({ fontSize: fs, fill: '#8aba8e' })
const Card = ({ title, children }) => <div style={{ width: 260, height: 220, border: '1px solid #2a4530', margin: 8, display: 'inline-block', color: '#dff0e1', fontSize: 12 }}>{title}<div style={{ height: 190 }}>{children}</div></div>
const chart = ({ fs, width, left, d = data, domain = [0, 100] }) => (
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={d} margin={{ top: 4, right: 6, left, bottom: 0 }}>
      <CartesianGrid stroke="#1e3421" vertical={false} />
      <XAxis dataKey="l" tick={tick(fs)} />
      <YAxis domain={domain} tick={tick(fs)} width={width} />
      <Bar dataKey="v" fill="#22c55e" />
    </BarChart>
  </ResponsiveContainer>)
createRoot(document.getElementById('root')).render(<div>
  <Card title="OLD fs13 w34 left-22">{chart({ fs: 13, width: 34, left: -22 })}</Card>
  <Card title="NEW fs13 auto left4">{chart({ fs: 13, width: 'auto', left: 4 })}</Card>
  <Card title="NEW fs16 auto left4 (TV)">{chart({ fs: 16, width: 'auto', left: 4 })}</Card>
  <Card title="NEW big numbers auto">{chart({ fs: 13, width: 'auto', left: 4, d: big, domain: undefined })}</Card>
</div>)
