// A queue that runs async tasks one at a time, in arrival order, within this process.
// Single-server only: multiple instances would need a shared lock (e.g. Redis).
export function createQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.catch(() => undefined); // a failed task must not block the ones behind it
    return result;
  };
}

// Bookings go through here so two requests can't both pass the availability check before
// either is written.
export const runExclusive = createQueue();
