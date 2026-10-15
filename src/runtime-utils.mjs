export function compactionCutoff(history, keepCount) {
  let cutoff = Math.max(0, history.length - keepCount);
  if (history[cutoff]?.role !== "tool") return cutoff;
  while (cutoff > 0 && history[cutoff - 1]?.role === "tool") cutoff -= 1;
  if (cutoff > 0 && history[cutoff - 1]?.role === "assistant" && history[cutoff - 1]?.tool_calls?.length) cutoff -= 1;
  return cutoff;
}
