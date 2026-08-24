import { Cron } from 'croner';
import type { EshopAdapter } from '@eshop-tracker/eshop';
import type { TrackerRepository } from '@eshop-tracker/database';
import type { WorkerConfig } from './config.js';
import { runCatalogSync, runPriceSync, type SyncOptions } from './sync.js';

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
  readonly adapter: EshopAdapter;
  readonly listingSource: string;
  readonly priceSource: string;
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
}

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
  private accepting = true;
  private started = false;
  private startPromise: Promise<void> | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private signalsInstalled = false;
  private readonly signalListener = (): void => {
    void this.shutdown().catch(() => {
      this.options.reportFailure('Worker shutdown failed');
    });
  };

  public constructor(private readonly options: Required<Pick<WorkerSchedulerOptions,
    'config' | 'repository' | 'adapter' | 'listingSource' | 'priceSource' | 'now' | 'cronFactory' | 'signals' | 'reportFailure' | 'runCatalogSync' | 'runPriceSync'
    | 'reportInfo'
  >>) {}

  public start(): Promise<void> {
    if (this.startPromise !== undefined) return this.startPromise;
    this.startPromise = this.initialize();
    return this.startPromise;
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.shutdownPromise = this.stop();
    return this.shutdownPromise;
  }

  private async initialize(): Promise<void> {
    try {
      this.installSchedules();
      if (!this.options.config.runOnStartup) return;

      await this.run('catalog');
      if (!this.accepting) return;
      await this.run('prices');
    } catch (error) {
      await this.shutdown();
      throw error;
    }
  }

  private installSchedules(): void {
    if (this.started) return;
    this.started = true;
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
      this.signalsInstalled = true;
      this.options.signals.on('SIGINT', this.signalListener);
      this.options.signals.on('SIGTERM', this.signalListener);
    } catch (error) {
      for (const handle of this.handles) handle.stop();
      this.handles.length = 0;
      if (this.signalsInstalled) {
        this.options.signals.off('SIGINT', this.signalListener);
        this.options.signals.off('SIGTERM', this.signalListener);
        this.signalsInstalled = false;
      }
      this.started = false;
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
    const promise = Promise.resolve().then(() => sync({
      adapter: this.options.adapter,
      repository: this.options.repository,
      listingSource: this.options.listingSource,
      priceSource: this.options.priceSource,
      now: this.options.now,
      signal: this.controller.signal
    })).then(noop);
    this.active.add(promise);
    void promise.then(noop, noop).then(() => {
      this.running.delete(job);
      this.active.delete(promise);
    });
    return promise;
  }

  private async stop(): Promise<void> {
    this.accepting = false;
    for (const handle of this.handles) handle.stop();
    this.handles.length = 0;
    if (this.signalsInstalled) {
      this.options.signals.off('SIGINT', this.signalListener);
      this.options.signals.off('SIGTERM', this.signalListener);
      this.signalsInstalled = false;
    }
    this.controller.abort();
    await Promise.allSettled([...this.active]);
    await this.options.repository.close();
  }
}

export function createWorkerScheduler(options: WorkerSchedulerOptions): WorkerScheduler {
  return new DurableWorkerScheduler({
    ...options,
    cronFactory: options.cronFactory ?? defaultCronFactory,
    signals: options.signals ?? defaultSignals,
    reportFailure: options.reportFailure ?? (() => console.error('Worker scheduled job failed')),
    reportInfo: options.reportInfo ?? (() => console.info('Worker scheduled job skipped')),
    runCatalogSync: options.runCatalogSync ?? runCatalogSync,
    runPriceSync: options.runPriceSync ?? runPriceSync
  });
}
