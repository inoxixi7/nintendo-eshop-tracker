import { describe, expect, it, vi } from 'vitest';
import type { EshopAdapter } from '@eshop-tracker/eshop';
import type { TrackerRepository } from '@eshop-tracker/database';
import { createWorkerScheduler, type CronCallback, type CronFactory, type SignalRegistrar } from '../src/scheduler.js';

const config = {
  databaseUrl: 'postgresql://tracker:secret@database/eshop',
  catalogCron: '0 3 * * *',
  priceCron: '0 */6 * * *',
  timeZone: 'Asia/Tokyo',
  runOnStartup: false
} as const;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRepository(): TrackerRepository {
  return {
    migrate: vi.fn(async () => undefined),
    tryJobLock: vi.fn(async () => true), releaseJobLock: vi.fn(async () => undefined),
    startSyncRun: vi.fn(async () => 1), finishSyncRun: vi.fn(async () => undefined),
    upsertCatalog: vi.fn(async () => 0), activeSourceIds: vi.fn(async () => []),
    recordPrices: vi.fn(async () => 0), close: vi.fn(async () => undefined)
  };
}

function createFactory() {
  const callbacks = new Map<string, CronCallback>();
  const handles = new Map<string, { stop: ReturnType<typeof vi.fn> }>();
  const factory: CronFactory = vi.fn((expression, options, callback) => {
    callbacks.set(expression, callback);
    const handle = { stop: vi.fn() };
    handles.set(expression, handle);
    expect(options).toEqual({ timezone: config.timeZone });
    return handle;
  });
  return { factory, callbacks, handles };
}

function createSignals() {
  const listeners = new Map<string, Set<() => void>>();
  const registrar: SignalRegistrar = {
    on: vi.fn((signal, listener) => {
      const values = listeners.get(signal) ?? new Set<() => void>();
      values.add(listener);
      listeners.set(signal, values);
    }),
    off: vi.fn((signal, listener) => listeners.get(signal)?.delete(listener))
  };
  return {
    registrar,
    emit(signal: 'SIGINT' | 'SIGTERM') { for (const listener of listeners.get(signal) ?? []) listener(); }
  };
}

function schedulerOptions(overrides: Partial<Parameters<typeof createWorkerScheduler>[0]> = {}) {
  const repository = createRepository();
  const cron = createFactory();
  const signals = createSignals();
  return {
    repository,
    cron,
    signals,
    options: {
      config,
      repository,
      adapter: { country: 'JP' } as EshopAdapter,
      listingSource: 'nintendo-jp-search',
      priceSource: 'nintendo-price-api',
      now: () => new Date('2026-08-24T00:00:00.000Z'),
      cronFactory: cron.factory,
      signals: signals.registrar,
      reportFailure: vi.fn(),
      reportInfo: vi.fn(),
      runCatalogSync: vi.fn(async () => undefined),
      runPriceSync: vi.fn(async () => undefined),
      ...overrides
    }
  };
}

describe('worker scheduler', () => {
  it('creates exactly two Croner jobs in the configured timezone', async () => {
    const fixture = schedulerOptions();
    const scheduler = createWorkerScheduler(fixture.options);

    await scheduler.start();

    expect(fixture.cron.factory).toHaveBeenCalledTimes(2);
    expect(fixture.cron.factory).toHaveBeenNthCalledWith(1, config.catalogCron, { timezone: config.timeZone }, expect.any(Function));
    expect(fixture.cron.factory).toHaveBeenNthCalledWith(2, config.priceCron, { timezone: config.timeZone }, expect.any(Function));
    await scheduler.shutdown();
  });

  it('runs catalog before prices at startup', async () => {
    const calls: string[] = [];
    const fixture = schedulerOptions({
      config: { ...config, runOnStartup: true },
      runCatalogSync: vi.fn(async () => { calls.push('catalog'); }),
      runPriceSync: vi.fn(async () => { calls.push('prices'); })
    });

    await createWorkerScheduler(fixture.options).start();

    expect(calls).toEqual(['catalog', 'prices']);
  });

  it('does not create cron callbacks until the startup sequence has finished', async () => {
    const catalog = deferred();
    const fixture = schedulerOptions({
      config: { ...config, runOnStartup: true },
      runCatalogSync: vi.fn(() => catalog.promise)
    });
    const scheduler = createWorkerScheduler(fixture.options);
    const starting = scheduler.start();

    await vi.waitFor(() => expect(fixture.options.runCatalogSync).toHaveBeenCalledOnce());
    expect(fixture.cron.factory).not.toHaveBeenCalled();
    expect(fixture.cron.callbacks.get(config.priceCron)).toBeUndefined();
    expect(fixture.options.runPriceSync).not.toHaveBeenCalled();

    catalog.resolve();
    await starting;

    expect(fixture.options.runPriceSync).toHaveBeenCalledOnce();
    expect(fixture.cron.factory).toHaveBeenCalledTimes(2);
    expect(fixture.cron.callbacks.get(config.priceCron)).toBeTypeOf('function');
    await scheduler.shutdown();
  });

  it('skips an overlapping scheduled invocation of the same job', async () => {
    const pending = deferred();
    const fixture = schedulerOptions({ runCatalogSync: vi.fn(() => pending.promise) });
    const scheduler = createWorkerScheduler(fixture.options);
    await scheduler.start();
    const callback = fixture.cron.callbacks.get(config.catalogCron)!;

    callback();
    callback();
    await Promise.resolve();
    expect(fixture.options.runCatalogSync).toHaveBeenCalledOnce();
    expect(fixture.options.reportInfo).toHaveBeenCalledWith('Scheduled catalog synchronization skipped');

    pending.resolve();
    await scheduler.shutdown();
  });

  it('contains scheduled failures and reports only fixed context', async () => {
    const fixture = schedulerOptions({ runCatalogSync: vi.fn(async () => { throw new Error('postgresql://secret'); }) });
    const scheduler = createWorkerScheduler(fixture.options);
    await scheduler.start();

    fixture.cron.callbacks.get(config.catalogCron)!();
    await vi.waitFor(() => {
      expect(fixture.options.reportFailure).toHaveBeenCalledWith('Scheduled catalog synchronization failed');
    });
    fixture.cron.callbacks.get(config.catalogCron)!();
    await vi.waitFor(() => {
      expect(fixture.options.runCatalogSync).toHaveBeenCalledTimes(2);
    });
    await scheduler.shutdown();
  });

  it('aborts active work, waits, closes once, and removes signal listeners on shutdown', async () => {
    const pending = deferred();
    const fixture = schedulerOptions({ runCatalogSync: vi.fn((_options) => pending.promise) });
    const scheduler = createWorkerScheduler(fixture.options);
    await scheduler.start();
    fixture.cron.callbacks.get(config.catalogCron)!();
    await Promise.resolve();

    fixture.signals.emit('SIGTERM');
    expect(fixture.cron.handles.get(config.catalogCron)?.stop).toHaveBeenCalledOnce();
    expect(fixture.cron.handles.get(config.priceCron)?.stop).toHaveBeenCalledOnce();
    expect(fixture.options.runCatalogSync).toHaveBeenCalledWith(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const passedSignal = vi.mocked(fixture.options.runCatalogSync).mock.calls[0]?.[0]?.signal;
    expect(passedSignal?.aborted).toBe(true);

    pending.resolve();
    await scheduler.shutdown();
    expect(fixture.repository.close).toHaveBeenCalledOnce();
    expect(fixture.signals.registrar.off).toHaveBeenCalledTimes(2);
    expect(fixture.signals.registrar.on).toHaveBeenCalledTimes(2);
  });

  it('keeps listeners through repeated signals until a gated close settles', async () => {
    const closing = deferred();
    const fixture = schedulerOptions({ repository: createRepository() });
    fixture.repository.close = vi.fn(() => closing.promise);
    fixture.options.repository = fixture.repository;
    const scheduler = createWorkerScheduler(fixture.options);
    await scheduler.start();

    fixture.signals.emit('SIGTERM');
    await vi.waitFor(() => expect(fixture.repository.close).toHaveBeenCalledOnce());
    expect(fixture.signals.registrar.off).not.toHaveBeenCalled();
    fixture.signals.emit('SIGINT');
    expect(fixture.repository.close).toHaveBeenCalledOnce();

    closing.resolve();
    await scheduler.waitForShutdown();
    expect(fixture.signals.registrar.off).toHaveBeenCalledTimes(2);
  });

  it('makes a signal-triggered shutdown failure observable to its waiter', async () => {
    const failure = new Error('close failed');
    const fixture = schedulerOptions();
    fixture.repository.close = vi.fn(async () => { throw failure; });
    fixture.options.repository = fixture.repository;
    const scheduler = createWorkerScheduler(fixture.options);
    await scheduler.start();

    fixture.signals.emit('SIGTERM');

    await expect(scheduler.waitForShutdown()).rejects.toBe(failure);
    expect(fixture.options.reportFailure).toHaveBeenCalledWith('Worker shutdown failed');
  });

  it('does not start prices when shutdown occurs during startup catalog work', async () => {
    const pending = deferred();
    const fixture = schedulerOptions({
      config: { ...config, runOnStartup: true },
      runCatalogSync: vi.fn(() => pending.promise)
    });
    const scheduler = createWorkerScheduler(fixture.options);
    const starting = scheduler.start();
    await Promise.resolve();

    fixture.signals.emit('SIGINT');
    pending.resolve();
    await starting;

    expect(fixture.options.runPriceSync).not.toHaveBeenCalled();
    await scheduler.shutdown();
  });

  it('stops schedules and closes the repository when startup synchronization fails', async () => {
    const fixture = schedulerOptions({
      config: { ...config, runOnStartup: true },
      runCatalogSync: vi.fn(async () => { throw new Error('secret upstream failure'); })
    });
    const scheduler = createWorkerScheduler(fixture.options);

    await expect(scheduler.start()).rejects.toThrow('secret upstream failure');

    expect(fixture.cron.factory).not.toHaveBeenCalled();
    expect(fixture.repository.close).toHaveBeenCalledOnce();
  });

  it('preserves the startup failure when shutdown cleanup also fails', async () => {
    const primary = new Error('startup failure');
    const cleanup = new Error('close failure');
    const fixture = schedulerOptions({
      config: { ...config, runOnStartup: true },
      runCatalogSync: vi.fn(async () => { throw primary; })
    });
    fixture.repository.close = vi.fn(async () => { throw cleanup; });
    fixture.options.repository = fixture.repository;

    await expect(createWorkerScheduler(fixture.options).start()).rejects.toBe(primary);
    expect(fixture.repository.close).toHaveBeenCalledOnce();
  });
});
