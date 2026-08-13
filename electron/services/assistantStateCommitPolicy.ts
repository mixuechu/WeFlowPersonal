export type AssistantStateCommitSteps = {
  strict: boolean
  syncGraph: () => void
  syncTasks: () => void
  writeEncryptedState: () => void
  onGraphError?: (error: unknown) => void
  onTaskError?: (error: unknown) => void
}

export type AssistantStateCommitResult = {
  graphSynced: boolean
  tasksSynced: boolean
  stateWritten: boolean
}

export function commitAssistantState(
  steps: AssistantStateCommitSteps
): AssistantStateCommitResult {
  let graphSynced = false
  let tasksSynced = false
  let stateWritten = false
  try {
    steps.syncGraph()
    graphSynced = true
  } catch (error) {
    steps.onGraphError?.(error)
    if (steps.strict) throw error
  }
  if (steps.strict) {
    try {
      steps.syncTasks()
      tasksSynced = true
    } catch (error) {
      steps.onTaskError?.(error)
      throw error
    }
    steps.writeEncryptedState()
    stateWritten = true
    return { graphSynced, tasksSynced, stateWritten }
  }
  steps.writeEncryptedState()
  stateWritten = true
  try {
    steps.syncTasks()
    tasksSynced = true
  } catch (error) {
    steps.onTaskError?.(error)
  }
  return { graphSynced, tasksSynced, stateWritten }
}
