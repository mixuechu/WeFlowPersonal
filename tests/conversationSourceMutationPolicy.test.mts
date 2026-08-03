import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildConversationSourceCursorToken,
  classifyConversationSourceMutationRecovery,
  readConversationSourceCursorState
} from '../electron/services/conversationSourceMutationPolicy.ts'

const beforeState = {
  sessionCursors: { first: 100, second: 200 },
  sessionOffsets: { first: 300, second: 400 }
}
const afterState = {
  sessionCursors: { first: 900, second: 900 },
  sessionOffsets: {}
}
const tokenMap = (state: any) => Object.fromEntries(['first', 'second'].map(id => [
  id,
  buildConversationSourceCursorToken(id, readConversationSourceCursorState(state, id))
]))

test('source mutation recovery finalizes only an exact committed cursor state', () => {
  assert.equal(
    classifyConversationSourceMutationRecovery(afterState, tokenMap(beforeState), tokenMap(afterState)),
    'apply'
  )
})

test('source mutation recovery abandons an exact pre-write cursor state', () => {
  assert.equal(
    classifyConversationSourceMutationRecovery(beforeState, tokenMap(beforeState), tokenMap(afterState)),
    'abandon'
  )
})

test('source mutation recovery retains mixed, changed and empty identities as conflicts', () => {
  assert.equal(classifyConversationSourceMutationRecovery({
    sessionCursors: { first: 900, second: 200 },
    sessionOffsets: { second: 400 }
  }, tokenMap(beforeState), tokenMap(afterState)), 'conflict')
  assert.equal(classifyConversationSourceMutationRecovery({
    sessionCursors: { first: 901, second: 900 },
    sessionOffsets: {}
  }, tokenMap(beforeState), tokenMap(afterState)), 'conflict')
  assert.equal(classifyConversationSourceMutationRecovery({}, {}, {}), 'conflict')
})
