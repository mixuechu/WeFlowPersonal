export type ScheduledTaskBoundaryOptions = {
  task: () => void | Promise<void>
  onError: (error: unknown) => void
  onSuccess?: () => void | Promise<void>
  onFinally?: () => void | Promise<void>
}

const reportWithoutThrowing = (
  reporter: (error: unknown) => void,
  error: unknown
): void => {
  try {
    reporter(error)
  } catch {
    // A diagnostic sink must never become a second timer failure.
  }
}

/** Final boundary for fire-and-forget timer and event work. */
export const runScheduledTaskSafely = async (
  options: ScheduledTaskBoundaryOptions
): Promise<void> => {
  try {
    await options.task()
    if (options.onSuccess) await options.onSuccess()
  } catch (error) {
    reportWithoutThrowing(options.onError, error)
  } finally {
    if (options.onFinally) {
      try {
        await options.onFinally()
      } catch (error) {
        reportWithoutThrowing(options.onError, error)
      }
    }
  }
}
