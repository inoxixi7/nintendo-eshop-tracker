import { rename, rm, writeFile } from 'node:fs/promises';

export const WORKER_READY_PATH = '/tmp/nintendo-eshop-worker-ready';

export interface WorkerReadinessMarker {
  clear(): Promise<void>;
  markReady(): Promise<void>;
}

export function createWorkerReadinessMarker(path = WORKER_READY_PATH): WorkerReadinessMarker {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  return {
    async clear(): Promise<void> {
      await rm(path, { force: true });
      await rm(temporaryPath, { force: true });
    },
    async markReady(): Promise<void> {
      try {
        await writeFile(temporaryPath, 'ready\n', { mode: 0o600 });
        await rename(temporaryPath, path);
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    }
  };
}
