// Runs async tasks one at a time, in arrival order, within this process. Bookings go through
// here so two requests can't both pass the availability check before either is written.
// Single-server only: multiple instances would need a shared lock (e.g. Redis).
let queue: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.catch(() => undefined); // a failed task must not block the ones behind it
  return result;
}
