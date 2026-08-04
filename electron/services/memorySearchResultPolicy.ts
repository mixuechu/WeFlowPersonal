export const MEMORY_SEARCH_CARD_TEXT_LIMIT = 2_400
export const MEMORY_SEARCH_MATCH_EXCERPT_LIMIT = 1_200

export function presentMemorySearchResults(results: unknown): any[] {
  return (Array.isArray(results) ? results : []).map((raw: any) => {
    const {
      embedding_json: _embeddingJson,
      embedding_model: _embeddingModel,
      embedding_dimensions: _embeddingDimensions,
      ...item
    } = raw || {}
    const authoritativeText = String(item.search_text || '')
    return {
      ...item,
      search_text: authoritativeText.slice(0, MEMORY_SEARCH_CARD_TEXT_LIMIT),
      search_text_length: authoritativeText.length,
      search_text_truncated: authoritativeText.length > MEMORY_SEARCH_CARD_TEXT_LIMIT,
      semantic_match_excerpt: String(item.semantic_match_excerpt || '')
        .slice(0, MEMORY_SEARCH_MATCH_EXCERPT_LIMIT)
    }
  })
}
