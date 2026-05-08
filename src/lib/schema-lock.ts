let schemaQueue: Promise<void> = Promise.resolve();

export async function runSerializedSchemaMigration<T>(work: () => Promise<T>): Promise<T> {
  const previous = schemaQueue.catch(() => {});
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  schemaQueue = previous.then(() => current);

  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}
