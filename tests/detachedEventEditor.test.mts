import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRenderDetachedEventEditor } from '../src/utils/detachedEventEditor.ts'

test('empty editor state never renders or dereferences an event id', () => {
  assert.equal(shouldRenderDetachedEventEditor(null, new Set()), false)
  assert.equal(shouldRenderDetachedEventEditor(undefined, new Set()), false)
  assert.equal(shouldRenderDetachedEventEditor({}, new Set()), false)
})

test('only an off-page non-citation event uses the detached editor', () => {
  assert.equal(shouldRenderDetachedEventEditor({ id: 'event-1' }, new Set()), true)
  assert.equal(
    shouldRenderDetachedEventEditor({ id: 'event-1' }, new Set(['event-1'])),
    false
  )
  assert.equal(
    shouldRenderDetachedEventEditor({ id: 'event-1', origin: 'citation' }, new Set()),
    false
  )
})
