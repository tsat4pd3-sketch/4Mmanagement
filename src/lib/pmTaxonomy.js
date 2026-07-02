import { supabaseDR } from '../supabaseClient'

// User-managed checkpoint taxonomy (categories + inspection methods).
// Stored in the PPM project with a stable `code` per row; checkpoints keep the
// code string so adding/editing types never requires a code change.

// Module-level color cache so display code (pins, badges, exports) can resolve
// a category color synchronously without prop-drilling. Primed on page load.
let _catColorCache = {}

export async function fetchCategories({ includeInactive = false } = {}) {
  let q = supabaseDR.from('pm_checkpoint_categories').select('*').order('sort_order').order('code')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data } = await q
  const rows = data ?? []
  // keep the color cache fresh whenever categories are loaded
  rows.forEach(r => { _catColorCache[r.code] = r.color })
  return rows
}

export async function fetchCheckingMethods({ includeInactive = false } = {}) {
  let q = supabaseDR.from('pm_checking_methods').select('*').order('sort_order').order('code')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data } = await q
  return data ?? []
}

// Synchronous color lookup backed by the cache primed via fetchCategories().
export function categoryColor(code) {
  return _catColorCache[code] ?? '#6b7280'
}

// { code -> row } for fast lookup in render/export code
export function indexByCode(rows) {
  const map = {}
  for (const r of rows) map[r.code] = r
  return map
}
