import { describe, expect, it, vi } from 'vitest';
import type { EshopAdapter } from '@eshop-tracker/eshop';
import type { TrackerRepository } from '@eshop-tracker/database';
import type { SignalRegistrar } from '../src/scheduler.js';
import { main, runWorkerCommand, type WorkerMainDependencies } from '../src/main.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
    emit(signal: 'SIGINT' | 'SIGTERM') { for (const listener of listeners.get(signal) ?? []) listener(); },
    count(signal: 'SIGINT' | 'SIGTERM') { return listeners.get(signal)?.size ?? 0; }
  };
}

function dependencies(overrides: Partial<WorkerMainDependencies> = {}) {
  const repository: TrackerRepository = {
    migrate: vi.fn(async () => undefined), tryJobLock: vi.fn(async () => true), releaseJobLock: vi.fn(async () => undefined),
    startSyncRun: vi.fn(async () => 1), finishSyncRun: vi.fn(async () => undefined), upsertCatalog: vi.fn(async () => 0), replaceTitleAliases: vi.fn(async () => 0),
    activeSourceIds: vi.fn(async () => []), recordPrices: vi.fn(async () => 0), close: vi.fn(async () => undefined)
  };
  const adapter = { country: 'JP' } as EshopAdapter;
  const result: WorkerMainDependencies = {
    env: { DATABASE_URL: 'postgresql://tracker:secret@database/eshop' },
    createRepository: vi.fn(() => repository), createAdapter: vi.fn(() => adapter),
    runCatalogSync: vi.fn(async () => undefined), runPriceSync: vi.fn(async () => undefined),
    createScheduler: vi.fn(() => ({
      start: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      waitForShutdown: vi.fn(async () => undefined)
    })),
    writeError: vi.fn(), setExitCode: vi.fn(),
    ...overrides
  };
  return { repository, adapter, result };
}

describe('worker CLI', () => {
  it.each(['migrate', 'catalog', 'prices', 'all', 'schedule'])('migrates before %s mode', async (command) => {
    const fixture = dependencies();
    await runWorkerCommand([command], fixture.result);
    expect(fixture.repository.migrate).toHaveBeenCalledOnce();
    const migrationOrder = vi.mocked(fixture.repository.migrate).mock.invocationCallOrder[0] ?? 0;
    if (command === 'catalog' || command === 'all') {
      expect(migrationOrder).toBeLessThan(vi.mocked(fixture.result.runCatalogSync!).mock.invocationCallOrder[0] ?? 0);
    }
    if (command === 'prices') {
      expect(migrationOrder).toBeLessThan(vi.mocked(fixture.result.runPriceSync!).mock.invocationCallOrder[0] ?? 0);
    }
    if (command === 'schedule') {
      expect(migrationOrder).toBeLessThan(vi.mocked(fixture.result.createScheduler!).mock.invocationCallOrder[0] ?? 0);
    }
  });

  it('runs catalog then prices for all', async () => {
    const calls: string[] = [];
    const fixture = dependencies({
      runCatalogSync: vi.fn(async () => { calls.push('catalog'); }),
      runPriceSync: vi.fn(async () => { calls.push('prices'); })
    });
    await runWorkerCommand(['all'], fixture.result);
    expect(calls).toEqual(['catalog', 'prices']);
    expect(fixture.repository.close).toHaveBeenCalledOnce();
  });

  it('does not construct an adapter for migrate', async () => {
    const marker = { clear: vi.fn(async () => undefined), markReady: vi.fn(async () => undefined) };
    const fixture = dependencies({ readiness: marker } as Partial<WorkerMainDependencies>);

    await runWorkerCommand(['migrate'], fixture.result);

    expect(fixture.result.createAdapter).not.toHaveBeenCalled();
    expect(fixture.repository.close).toHaveBeenCalledOnce();
    expect(marker.clear).not.toHaveBeenCalled();
    expect(marker.markReady).not.toHaveBeenCalled();
  });

  it('clears before schedule initialization, marks after start, and clears on shutdown', async () => {
    const done = deferred();
    const marker = { clear: vi.fn(async () => undefined), markReady: vi.fn(async () => undefined) };
    const scheduler = {
      start: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      waitForShutdown: vi.fn(() => done.promise)
    };
    const fixture = dependencies({
      readiness: marker,
      createScheduler: vi.fn(() => scheduler)
    } as Partial<WorkerMainDependencies>);
    const running = runWorkerCommand(['schedule'], fixture.result);

    await vi.waitFor(() => expect(marker.markReady).toHaveBeenCalledOnce());
    expect(vi.mocked(marker.clear).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(fixture.repository.migrate).mock.invocationCallOrder[0] ?? 0);
    expect(vi.mocked(marker.markReady).mock.invocationCallOrder[0])
      .toBeGreaterThan(vi.mocked(scheduler.start).mock.invocationCallOrder[0] ?? 0);

    done.resolve();
    await running;
    expect(marker.clear).toHaveBeenCalledTimes(2);
  });

  it('never marks readiness and clears it when schedule startup fails', async () => {
    const marker = { clear: vi.fn(async () => undefined), markReady: vi.fn(async () => undefined) };
    const fixture = dependencies({
      readiness: marker,
      createScheduler: vi.fn(() => ({
        start: vi.fn(async () => { throw new Error('startup failed'); }),
        shutdown: vi.fn(async () => undefined),
        waitForShutdown: vi.fn(async () => undefined)
      }))
    } as Partial<WorkerMainDependencies>);

    await expect(runWorkerCommand(['schedule'], fixture.result)).rejects.toThrow('startup failed');

    expect(marker.markReady).not.toHaveBeenCalled();
    expect(marker.clear).toHaveBeenCalledTimes(2);
  });

  it('clears readiness and shuts down when atomically marking readiness fails', async () => {
    const failure = new Error('marker write failed');
    const marker = { clear: vi.fn(async () => undefined), markReady: vi.fn(async () => { throw failure; }) };
    const scheduler = {
      start: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      waitForShutdown: vi.fn(async () => undefined)
    };
    const fixture = dependencies({
      readiness: marker,
      createScheduler: vi.fn(() => scheduler)
    } as Partial<WorkerMainDependencies>);

    await expect(runWorkerCommand(['schedule'], fixture.result)).rejects.toBe(failure);

    expect(marker.markReady).toHaveBeenCalledOnce();
    expect(marker.clear).toHaveBeenCalledTimes(2);
    expect(scheduler.shutdown).toHaveBeenCalledOnce();
  });

  it('keeps schedule mode pending until shutdown has completed', async () => {
    const done = deferred();
    const scheduler = {
      start: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      waitForShutdown: vi.fn(() => done.promise)
    };
    const fixture = dependencies({ createScheduler: vi.fn(() => scheduler) });
    let settled = false;
    const running = runWorkerCommand(['schedule'], fixture.result).finally(() => { settled = true; });

    await vi.waitFor(() => expect(scheduler.waitForShutdown).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    done.resolve();
    await running;
  });

  it('closes once and skips adapter, scheduler, and sync when signalled during migration', async () => {
    const migration = deferred();
    const closing = deferred();
    const signals = createSignals();
    const fixture = dependencies({ signals: signals.registrar });
    fixture.repository.migrate = vi.fn(() => migration.promise);
    fixture.repository.close = vi.fn(() => closing.promise);
    let settled = false;
    const running = runWorkerCommand(['schedule'], fixture.result).finally(() => { settled = true; });

    await vi.waitFor(() => expect(signals.registrar.on).toHaveBeenCalledTimes(2));
    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    await vi.waitFor(() => expect(fixture.repository.close).toHaveBeenCalledOnce());
    expect(fixture.result.createAdapter).not.toHaveBeenCalled();
    expect(fixture.result.createScheduler).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    migration.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    closing.resolve();
    await running;
    expect(signals.registrar.off).toHaveBeenCalledTimes(2);
  });

  it('has no signal-listener gap when ownership transfers to scheduler', async () => {
    const signals = createSignals();
    const schedulerListeners = { int: vi.fn(), term: vi.fn() };
    let schedulerOptions!: Parameters<NonNullable<WorkerMainDependencies['createScheduler']>>[0];
    const scheduler = {
      start: vi.fn(() => {
        schedulerOptions.signals!.on('SIGINT', schedulerListeners.int);
        schedulerOptions.signals!.on('SIGTERM', schedulerListeners.term);
        return Promise.resolve();
      }),
      shutdown: vi.fn(async () => undefined),
      waitForShutdown: vi.fn(async () => undefined)
    };
    const fixture = dependencies({
      signals: signals.registrar,
      createScheduler: vi.fn((options) => {
        schedulerOptions = options;
        return scheduler;
      })
    });

    await runWorkerCommand(['schedule'], fixture.result);

    expect(schedulerOptions.signals).toBe(signals.registrar);
    expect(vi.mocked(signals.registrar.off).mock.invocationCallOrder[0])
      .toBeGreaterThan(vi.mocked(scheduler.start).mock.invocationCallOrder[0] ?? 0);
    expect(signals.count('SIGINT')).toBe(1);
    expect(signals.count('SIGTERM')).toBe(1);
  });

  it('closes the repository when a one-shot mode fails', async () => {
    const fixture = dependencies({ runCatalogSync: vi.fn(async () => { throw new Error('secret failure'); }) });
    await expect(runWorkerCommand(['catalog'], fixture.result)).rejects.toThrow('secret failure');
    expect(fixture.repository.close).toHaveBeenCalledOnce();
  });

  it('rejects invalid commands before reading config or constructing dependencies', async () => {
    const fixture = dependencies();
    await expect(runWorkerCommand(['unexpected'], fixture.result)).rejects.toThrow('Invalid worker command');
    expect(fixture.result.createRepository).not.toHaveBeenCalled();
    expect(fixture.result.createAdapter).not.toHaveBeenCalled();
  });

  it('writes only a fixed safe failure line at the top level', async () => {
    const fixture = dependencies({ runCatalogSync: vi.fn(async () => { throw new Error('postgresql://secret'); }) });
    await main(['catalog'], fixture.result);
    expect(fixture.result.writeError).toHaveBeenCalledWith('Worker failed.\n');
    expect(fixture.result.setExitCode).toHaveBeenCalledWith(1);
  });

  it('surfaces a signal-triggered shutdown failure through the safe top-level failure path', async () => {
    const scheduler = {
      start: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
      waitForShutdown: vi.fn(async () => { throw new Error('postgresql://secret'); })
    };
    const fixture = dependencies({ createScheduler: vi.fn(() => scheduler) });

    await main(['schedule'], fixture.result);

    expect(fixture.result.writeError).toHaveBeenCalledWith('Worker failed.\n');
    expect(fixture.result.setExitCode).toHaveBeenCalledWith(1);
  });

  it('surfaces a provisional shutdown failure through the safe top-level failure path', async () => {
    const migration = deferred();
    const signals = createSignals();
    const fixture = dependencies({ signals: signals.registrar });
    fixture.repository.migrate = vi.fn(() => migration.promise);
    fixture.repository.close = vi.fn(async () => { throw new Error('postgresql://secret'); });
    const running = main(['schedule'], fixture.result);

    await vi.waitFor(() => expect(signals.registrar.on).toHaveBeenCalledTimes(2));
    signals.emit('SIGTERM');
    migration.resolve();
    await running;

    expect(fixture.result.writeError).toHaveBeenCalledWith('Worker failed.\n');
    expect(fixture.result.setExitCode).toHaveBeenCalledWith(1);
    expect(fixture.result.createAdapter).not.toHaveBeenCalled();
  });

  it('closes a constructed repository if adapter construction fails without masking the primary error', async () => {
    const primary = new Error('adapter construction failed');
    const fixture = dependencies({ createAdapter: vi.fn(() => { throw primary; }) });
    fixture.repository.close = vi.fn(async () => { throw new Error('close failed'); });

    await expect(runWorkerCommand(['catalog'], fixture.result)).rejects.toBe(primary);
    expect(fixture.repository.close).toHaveBeenCalledOnce();
  });

  it('closes a constructed repository if scheduler construction fails', async () => {
    const fixture = dependencies({ createScheduler: vi.fn(() => { throw new Error('scheduler construction failed'); }) });

    await expect(runWorkerCommand(['schedule'], fixture.result)).rejects.toThrow('scheduler construction failed');
    expect(fixture.repository.close).toHaveBeenCalledOnce();
  });

  it('closes a constructed repository if migration fails', async () => {
    const fixture = dependencies();
    fixture.repository.migrate = vi.fn(async () => { throw new Error('migration failed'); });

    await expect(runWorkerCommand(['prices'], fixture.result)).rejects.toThrow('migration failed');
    expect(fixture.repository.close).toHaveBeenCalledOnce();
  });

  it('uses scheduler shutdown once when scheduler start fails', async () => {
    const primary = new Error('scheduler start failed');
    let fixture!: ReturnType<typeof dependencies>;
    const scheduler = {
      start: vi.fn(async () => { throw primary; }),
      shutdown: vi.fn(async () => fixture.repository.close()),
      waitForShutdown: vi.fn(async () => undefined)
    };
    fixture = dependencies({ createScheduler: vi.fn(() => scheduler) });

    await expect(runWorkerCommand(['schedule'], fixture.result)).rejects.toBe(primary);
    expect(scheduler.shutdown).toHaveBeenCalledOnce();
    expect(fixture.repository.close).toHaveBeenCalledOnce();
  });

  it('writes fixed usage for missing commands', async () => {
    const fixture = dependencies();
    await main([], fixture.result);
    expect(fixture.result.writeError).toHaveBeenCalledWith('Usage: node dist/main.js <migrate|catalog|prices|all|schedule>\n');
    expect(fixture.result.createRepository).not.toHaveBeenCalled();
  });
});
