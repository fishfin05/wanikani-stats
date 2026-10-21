export function mergeCustomStudy(existing = {}, incoming = {}) {
  const srsState = { ...(existing.srsState ?? {}) };
  for (const [key, record] of Object.entries(incoming.srsState ?? {})) {
    const old = srsState[key];
    if (!old || Date.parse(record?.lastAnsweredAt ?? 0) > Date.parse(old?.lastAnsweredAt ?? 0)) srsState[key] = record;
  }
  const alternates = { ...(existing.alternates ?? {}) };
  for (const [key, values] of Object.entries(incoming.alternates ?? {})) {
    alternates[key] = [...new Set([...(alternates[key] ?? []), ...(values ?? [])])];
  }
  const logMap = new Map();
  for (const item of [...(existing.reviewLog ?? []), ...(incoming.logAppend ?? [])]) {
    logMap.set(`${item.timestamp}|${item.subjectId}|${item.mode}`, item);
  }
  const reviewLog = [...logMap.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return { srsState, alternates, reviewLog };
}
