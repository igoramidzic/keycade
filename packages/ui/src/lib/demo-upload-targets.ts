/** Prefer an open task; otherwise use the most recently registered visible upload area. */
export function preferredDemoUploadTarget<T extends { priority?: number }>(targets: readonly T[]) {
  return targets.reduce<T | null>(
    (current, target) =>
      !current || (target.priority ?? 0) >= (current.priority ?? 0) ? target : current,
    null,
  );
}
