import { Cron } from 'croner';
import type { TrackerRepository } from '@eshop-tracker/database';
import type { WorkerConfig } from './config.js';
import { runCatalogSync, runPriceSync, type RegionSync, type SyncOptions } from './sync.js';

export type WorkerSignal = 'SIGINT' | 'SIGTERM';
export type CronCallback = () => void;

export interface CronHandle {
  stop(): void;
}

export interface CronFactory {
  (expression: string, options: { readonly timezone: string }, callback: CronCallback): CronHandle;
}

export interface SignalRegistrar {
  on(signal: WorkerSignal, listener: () => void): void;
  off(signal: WorkerSignal, listener: () => void): void;
}

type SyncFunction = (options: SyncOptions) => Promise<unknown>;
type JobName = 'catalog' | 'prices';

export interface WorkerSchedulerOptions {
  readonly config: Pick<WorkerConfig, 'catalogCron' | 'priceCron' | 'timeZone' | 'runOnStartup'>;
  readonly repository: TrackerRepository;
  readonly regions: readonly RegionSync[];
  readonly now: () => Date;
  readonly cronFactory?: CronFactory;
  readonly signals?: SignalRegistrar;
  readonly reportFailure?: (message: string) => void;
  readonly reportInfo?: (message: string) => void;
  readonly runCatalogSync?: SyncFunction;
  readonly runPriceSync?: SyncFunction;
}

export interface WorkerScheduler {
  start(): Promise<void>;
  shutdown(): Promise<void>;
  waitForShutdown(): Promise<void>;
}

type ResolvedSchedulerOptions = Omit<WorkerSchedulerOptions,
  'cronFactory' | 'signals' | 'reportFailure' | 'reportInfo' | 'runCatalogSync' | 'runPriceSync'
> & Required<Pick<WorkerSchedulerOptions,
  'cronFactory' | 'signals' | 'reportFailure' | 'reportInfo' | 'runCatalogSync' | 'runPriceSync'
>>;

const defaultCronFactory: CronFactory = (expression, options, callback) => new Cron(expression, options, callback);
const defaultSignals: SignalRegistrar = {
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener)
};
const noop = (): void => undefined;

class DurableWorkerScheduler implements WorkerScheduler {
  private readonly controller = new AbortController();
  private readonly active = new Set<Promise<void>>();
  private readonly running = new Set<JobName>();
  private readonly handles: CronHandle[] = [];
  private readonly done: Promise<void>;
  private resolveDone!: () => void;
  private rejectDone!: (error: unknown) => void;
  private accepting = true;
  private schedulesInstalled = false;
  private signalsInstalled = false;
  private startPromise: Promise<void> | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private readonly signalListener = (): void => {
    void this.shutdown().catch(() => {
      this.options.reportFailure('Worker shutdown failed');
    });
  };

  public constructor(private readonly options: ResolvedSchedulerOptions) {
    this.done = new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    // A signal can arrive before the CLI begins waiting. Keep that failure
    // observable to later waiters without an unhandled rejection.
    void this.done.catch(noop);
  }

  public start(): Promise<void> {
    if (this.startPromise !== undefined) return this.startPromise;
    this.startPromise = this.initialize();
    return this.startPromise;
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.shutdownPromise = this.stop();
    void this.shutdownPromise.then(this.resolveDone, this.rejectDone);
    return this.shutdownPromise;
  }

  public waitForShutdown(): Promise<void> {
    return this.done;
  }

  private async initialize(): Promise<void> {
    if (!this.accepting) return;
    try {
      this.installSignals();
      if (this.options.config.runOnStartup) {
        await this.run('catalog');
        if (!this.accepting) return;
        await this.run('prices');
        if (!this.accepting) return;
      }
      this.installSchedules();
    } catch (error) {
      await this.shutdown().catch(noop);
      throw error;
    }
  }

  private installSignals(): void {
    if (this.signalsInstalled) return;
    this.signalsInstalled = true;
    try {
      this.options.signals.on('SIGINT', this.signalListener);
      this.options.signals.on('SIGTERM', this.signalListener);
    } catch (error) {
      this.removeSignals();
      throw error;
    }
  }

  private installSchedules(): void {
    if (!this.accepting || this.schedulesInstalled) return;
    this.schedulesInstalled = true;
    try {
      this.handles.push(this.options.cronFactory(
        this.options.config.catalogCron,
        { timezone: this.options.config.timeZone },
        () => { this.runScheduled('catalog'); }
      ));
      this.handles.push(this.options.cronFactory(
        this.options.config.priceCron,
        { timezone: this.options.config.timeZone },
        () => { this.runScheduled('prices'); }
      ));
    } catch (error) {
      this.stopSchedules();
      throw error;
    }
  }

  private runScheduled(job: JobName): void {
    if (!this.accepting) return;
    if (this.running.has(job)) {
      this.options.reportInfo(`Scheduled ${job} synchronization skipped`);
      return;
    }
    void this.run(job).catch(() => {
      this.options.reportFailure(`Scheduled ${job} synchronization failed`);
    });
  }

  private run(job: JobName): Promise<void> {
    if (!this.accepting || this.running.has(job)) return Promise.resolve();
    this.running.add(job);
    const sync = job === 'catalog' ? this.options.runCatalogSync : this.options.runPriceSync;
    const promise = runEachRegion(this.options.regions, (region) => sync({
      ...region,
      repository: this.options.repository,
      now: this.options.now,
      signal: this.controller.signal
    }));
    this.active.add(promise);
    void promise.then(noop, noop).then(() => {
      this.running.delete(job);
      this.active.delete(promise);
    });
    return promise;
  }

  private stopSchedules(): void {
    for (const handle of this.handles) handle.stop();
    this.handles.length = 0;
    this.schedulesInstalled = false;
  }

  private removeSignals(): void {
    if (!this.signalsInstalled) return;
    this.options.signals.off('SIGINT', this.signalListener);
    this.options.signals.off('SIGTERM', this.signalListener);
    this.signalsInstalled = false;
  }

  private async stop(): Promise<void> {
    this.accepting = false;
    this.stopSchedules();
    this.controller.abort();
    try {
      await Promise.allSettled([...this.active]);
      await this.options.repository.close();
    } finally {
      this.removeSignals();
    }
  }
}

/** Runs every region even when an earlier one fails, then rethrows the first failure. */
export async function runEachRegion(regions: readonly RegionSync[], sync: (region: RegionSync) => Promise<unknown>): Promise<void> {
  const failures: unknown[] = [];
  for (const region of regions) {
    try {
      await sync(region);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
}

export function createWorkerScheduler(options: WorkerSchedulerOptions): WorkerScheduler {
  return new DurableWorkerScheduler({
    ...options,
    cronFactory: options.cronFactory ?? defaultCronFactory,
    signals: options.signals ?? defaultSignals,
    reportFailure: options.reportFailure ?? ((message) => console.error(message)),
    reportInfo: options.reportInfo ?? ((message) => console.info(message)),
    runCatalogSync: options.runCatalogSync ?? runCatalogSync,
    runPriceSync: options.runPriceSync ?? runPriceSync
  });
}
