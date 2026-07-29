export function summarizeIngestionRuns(
  runs: any[],
  rates: { inputPerMillion: number; outputPerMillion: number }
): any {
  const safeRates = {
    inputPerMillion: Math.max(0, Number(rates.inputPerMillion || 0)),
    outputPerMillion: Math.max(0, Number(rates.outputPerMillion || 0))
  }
  const totals = runs.reduce((result, run) => {
    result.messages += Number(run.message_count || 0)
    result.inputTokens += Number(run.usage?.input_tokens || 0)
    result.outputTokens += Number(run.usage?.output_tokens || 0)
    result.durationMs += Number(run.usage?.duration_ms || 0)
    result.failedBatches += (run.batches || []).filter((batch: any) => batch.status === 'failed').length
    return result
  }, { messages: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, failedBatches: 0 })
  const estimatedCost = totals.inputTokens / 1_000_000 * safeRates.inputPerMillion +
    totals.outputTokens / 1_000_000 * safeRates.outputPerMillion
  return {
    runs: runs.length,
    completedRuns: runs.filter(run => run.status === 'completed').length,
    partialRuns: runs.filter(run => run.status === 'partial').length,
    failedRuns: runs.filter(run => run.status === 'failed').length,
    ...totals,
    estimatedCost,
    currency: 'CNY',
    rates: safeRates,
    costConfigured: safeRates.inputPerMillion > 0 || safeRates.outputPerMillion > 0
  }
}
