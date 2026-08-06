export type MemorySearchReviewPreset =
  | 'conservative_support'
  | 'fragile_candidate'

export type MemorySearchReviewFilters = {
  trustStatus: string
  supportability: string
  evidenceConflict: string
  evidenceStrength: string
  evidenceBreadth: string
}

const PRESETS: Record<MemorySearchReviewPreset, MemorySearchReviewFilters> = {
  conservative_support: {
    trustStatus: 'confirmed',
    supportability: 'supporting',
    evidenceConflict: 'without_contradiction',
    evidenceStrength: 'direct',
    evidenceBreadth: 'multi_source'
  },
  fragile_candidate: {
    trustStatus: 'candidate',
    supportability: 'review_only',
    evidenceConflict: '',
    evidenceStrength: 'indirect_only',
    evidenceBreadth: 'single_source'
  }
}

export function memorySearchReviewPreset(
  preset: MemorySearchReviewPreset
): MemorySearchReviewFilters {
  return { ...PRESETS[preset] }
}

export function isMemorySearchReviewPresetActive(
  preset: MemorySearchReviewPreset,
  filters: Partial<MemorySearchReviewFilters>
): boolean {
  const expected = PRESETS[preset]
  return (Object.keys(expected) as Array<keyof MemorySearchReviewFilters>)
    .every(key => String(filters[key] || '') === expected[key])
}
