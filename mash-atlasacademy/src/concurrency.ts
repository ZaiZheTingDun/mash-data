export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  delayMs: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index] as T;
      await worker(item, index);
      if (delayMs > 0 && cursor < items.length) {
        await sleep(delayMs);
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
