import { createJapanEshopAdapter, type EshopAdapter } from '@eshop-tracker/eshop';
import { createTrackerRepository, type TrackerRepository } from '@eshop-tracker/database';
import { pathToFileURL } from 'node:url';
import { parseWorkerConfig } from './config.js';
import { createWorkerScheduler, type WorkerScheduler, type WorkerSchedulerOptions } from './scheduler.js';
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
    createScheduler: dependencies.createScheduler ?? createWorkerScheduler
  };
}

function syncOptions(adapter: EshopAdapter, repository: TrackerRepository): Omit<SyncOptions, 'signal'> {
  return {
    adapter,
    repository,
    listingSource: LISTING_SOURCE,
    priceSource: PRICE_SOURCE,
    now: () => new Date()
  };
}

const noop = (): void => undefined;

export async function runWorkerCommand(args: readonly string[], dependencies: WorkerMainDependencies = {}): Promise<void> {
  const command = commandFrom(args);
  const services = runtime(dependencies);
  const config = parseWorkerConfig(services.env);
  const repository = services.createRepository(config.databaseUrl);
  let repositoryCloseAttempted = false;
  let scheduler: WorkerScheduler | undefined;
  const closeRepository = async (): Promise<void> => {
    if (repositoryCloseAttempted) return;
    repositoryCloseAttempted = true;
    await repository.close();
  };

  try {
    const adapter = services.createAdapter();
    const options = syncOptions(adapter, repository);
    await repository.migrate();
    if (command === 'schedule') {
      scheduler = services.createScheduler({
        config,
        ...options,
        runCatalogSync: services.runCatalogSync,
        runPriceSync: services.runPriceSync
      });
      await scheduler.start();
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
