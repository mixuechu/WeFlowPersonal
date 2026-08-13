import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MEMORY_SEARCH_CARD_TEXT_LIMIT,
  MEMORY_SEARCH_MATCH_EXCERPT_LIMIT,
  presentMemorySearchResults
} from '../electron/services/memorySearchResultPolicy.ts'

test('renderer search cards receive bounded text and no internal embedding vectors', () => {
  const [result] = presentMemorySearchResults([{
    id: 'resource:long',
    search_text: '全'.repeat(MEMORY_SEARCH_CARD_TEXT_LIMIT + 500),
    semantic_match_excerpt: '命'.repeat(MEMORY_SEARCH_MATCH_EXCERPT_LIMIT + 200),
    embedding_json: JSON.stringify(Array.from({ length: 512 }, () => 0.1)),
    embedding_model: 'private-model-version',
    embedding_dimensions: 512,
    semantic_score: 0.91
  }])
  assert.equal(result.search_text.length, MEMORY_SEARCH_CARD_TEXT_LIMIT)
  assert.equal(result.search_text_length, MEMORY_SEARCH_CARD_TEXT_LIMIT + 500)
  assert.equal(result.search_text_truncated, true)
  assert.equal(result.semantic_match_excerpt.length, MEMORY_SEARCH_MATCH_EXCERPT_LIMIT)
  assert.equal(result.semantic_score, 0.91)
  assert.equal('embedding_json' in result, false)
  assert.equal('embedding_model' in result, false)
  assert.equal('embedding_dimensions' in result, false)
})

test('short renderer search cards remain complete and explicitly untruncated', () => {
  const [result] = presentMemorySearchResults([{ id: 'claim:short', search_text: '短事实' }])
  assert.equal(result.search_text, '短事实')
  assert.equal(result.search_text_length, 3)
  assert.equal(result.search_text_truncated, false)
  assert.equal(result.semantic_match_excerpt, '')
})
