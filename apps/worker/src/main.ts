import { createJapanEshopAdapter, fetchTitleAliases, type EshopAdapter } from '@eshop-tracker/eshop';
import { createTrackerRepository, type TrackerRepository } from '@eshop-tracker/database';
import { pathToFileURL } from 'node:url';
import { parseWorkerConfig } from './config.js';
import { createWorkerReadinessMarker, type WorkerReadinessMarker } from './readiness.js';
import {
  createWorkerScheduler,
  type SignalRegistrar,
  type WorkerScheduler,
  type WorkerSchedulerOptions
} from './scheduler.js';
import { runCatalogSync, runPriceSync, type SyncOptions } from './sync.js';

export const WORKER_USAGE = 'Usage: node dist/main.js <migrate|catalog|prices|all|schedule>\n';
const FAILURE_LINE = 'Worker failed.\n';
const LISTING_SOURCE = 'nintendo-jp-search';
const PRICE_SOURCE = 'nintendo-price-api';

type WorkerCommand = 'migrate' | 'catalog' | 'prices' | 'all' | 'schedule';
type SyncFunction = (options: SyncOptions) => Promise<unknown>;

export interface WorkerMainDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createRepository?: (databaseUrl: string) => TrackerRepository;
  readonly createAdapter?: () => EshopAdapter;
  readonly runCatalogSync?: SyncFunction;
  readonly runPriceSync?: SyncFunction;
  readonly createScheduler?: (options: WorkerSchedulerOptions) => WorkerScheduler;
  readonly readiness?: WorkerReadinessMarker;
  readonly signals?: SignalRegistrar;
  readonly writeError?: (message: string) => void;
  readonly setExitCode?: (code: number) => void;
}

class UsageError extends Error {
  public constructor() {
    super('Invalid worker command');
  }
}

function commandFrom(args: readonly string[]): WorkerCommand {
  if (args.length !== 1) throw new UsageError();
  const command = args[0];
  if (command === 'migrate' || command === 'catalog' || command === 'prices' || command === 'all' || command === 'schedule') {
    return command;
  }
  throw new UsageError();
}

function runtime(dependencies: WorkerMainDependencies) {
  return {
    env: dependencies.env ?? process.env,
    createRepository: dependencies.createRepository ?? createTrackerRepository,
    createAdapter: dependencies.createAdapter ?? createJapanEshopAdapter,
    runCatalogSync: dependencies.runCatalogSync ?? runCatalogSync,
    runPriceSync: dependencies.runPriceSync ?? runPriceSync,
    createScheduler: dependencies.createScheduler ?? createWorkerScheduler,
    readiness: dependencies.readiness ?? createWorkerReadinessMarker(),
    signals: dependencies.signals ?? defaultSignals
  };
}

function syncOptions(adapter: EshopAdapter, repository: TrackerRepository): Omit<SyncOptions, 'signal'> {
  return {
    adapter,
    repository,
    listingSource: LISTING_SOURCE,
    priceSource: PRICE_SOURCE,
    now: () => new Date(),
    fetchTitleAliases: (signal) => fetchTitleAliases(globalThis.fetch, signal)
  };
}

const noop = (): void => undefined;
const defaultSignals: SignalRegistrar = {
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener)
};

export async function runWorkerCommand(args: readonly string[], dependencies: WorkerMainDependencies = {}): Promise<void> {
  const command = commandFrom(args);
  const services = runtime(dependencies);
  const readiness = command === 'schedule' ? services.readiness : undefined;
  let config;
  try {
    if (readiness !== undefined) await readiness.clear();
    config = parseWorkerConfig(services.env);
  } catch (error) {
    if (readiness !== undefined) await readiness.clear().catch(noop);
    throw error;
  }
  const repository = services.createRepository(config.databaseUrl);
  let repositoryClosePromise: Promise<void> | undefined;
  let scheduler: WorkerScheduler | undefined;
  let provisionalInstalled = false;
  let provisionalShutdown: Promise<void> | undefined;
  const closeRepository = (): Promise<void> => {
    repositoryClosePromise ??= repository.close();
    return repositoryClosePromise;
  };
  const provisionalListener = (): void => {
    provisionalShutdown ??= closeRepository();
    void provisionalShutdown.catch(noop);
  };
  const installProvisionalSignals = (): void => {
    provisionalInstalled = true;
    try {
      services.signals.on('SIGINT', provisionalListener);
      services.signals.on('SIGTERM', provisionalListener);
    } catch (error) {
      removeProvisionalSignals();
      throw error;
    }
  };
  const removeProvisionalSignals = (): void => {
    if (!provisionalInstalled) return;
    provisionalInstalled = false;
    try {
      services.signals.off('SIGINT', provisionalListener);
    } catch {
      // Listener removal must not expose implementation errors or mask a primary failure.
    }
    try {
      services.signals.off('SIGTERM', provisionalListener);
    } catch {
      // Listener removal must not expose implementation errors or mask a primary failure.
    }
  };

  try {
    if (command === 'schedule') installProvisionalSignals();
    await repository.migrate();
    if (command === 'migrate') {
      await closeRepository();
      return;
    }
    if (provisionalShutdown !== undefined) {
      await provisionalShutdown;
      return;
    }

    const adapter = services.createAdapter();
    const options = syncOptions(adapter, repository);
    if (provisionalShutdown !== undefined) {
      await provisionalShutdown;
      return;
    }
    if (command === 'schedule') {
      scheduler = services.createScheduler({
        config,
        ...options,
        signals: services.signals,
        runCatalogSync: services.runCatalogSync,
        runPriceSync: services.runPriceSync
      });
      if (provisionalShutdown !== undefined) {
        await provisionalShutdown;
        return;
      }
      const starting = scheduler.start();
      // `start()` installs scheduler signal listeners synchronously before its
      // first await, so this removal transfers ownership without a gap.
      removeProvisionalSignals();
      await starting;
      await readiness!.markReady();
      await scheduler.waitForShutdown();
      return;
    }
    if (command === 'catalog' || command === 'all') await services.runCatalogSync(options);
    if (command === 'prices' || command === 'all') await services.runPriceSync(options);
    await closeRepository();
  } catch (error) {
    if (scheduler !== undefined) {
      await scheduler.shutdown().catch(noop);
    } else {
      await closeRepository().catch(noop);
    }
    throw error;
  } finally {
    removeProvisionalSignals();
    if (readiness !== undefined) await readiness.clear().catch(noop);
  }
}

export async function main(args: readonly string[] = process.argv.slice(2), dependencies: WorkerMainDependencies = {}): Promise<void> {
  try {
    await runWorkerCommand(args, dependencies);
  } catch (error) {
    const writeError = dependencies.writeError ?? ((message: string) => process.stderr.write(message));
    const setExitCode = dependencies.setExitCode ?? ((code: number) => { process.exitCode = code; });
    writeError(error instanceof UsageError ? WORKER_USAGE : FAILURE_LINE);
    setExitCode(1);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
