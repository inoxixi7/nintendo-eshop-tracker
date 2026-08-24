import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/index.js';

describe('database migrations', () => {
  it('loads the initial migration in lexical order with the tracker schema', async () => {
    const migrations = await loadMigrations();

    expect(migrations.map(({ name }) => name)).toEqual(['001_initial.sql']);

    const sql = migrations[0]?.sql ?? '';
    expect(sql).toMatch(/CREATE TABLE regional_listings/i);
    expect(sql).toMatch(/CREATE TABLE current_prices/i);
    expect(sql).toMatch(/CREATE TABLE price_history/i);
    expect(sql).toMatch(/CREATE TABLE sync_runs/i);
    expect(sql).toMatch(/UNIQUE\s*\(country,\s*source,\s*source_id\)/i);
  });

  it('loads migrations from an isolated built package layout', async () => {
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const isolatedRoot = await mkdtemp(join(tmpdir(), 'eshop-tracker-database-'));

    try {
      await cp(join(packageRoot, 'dist'), join(isolatedRoot, 'dist'), { recursive: true });
      await cp(join(packageRoot, 'src'), join(isolatedRoot, 'src'), { recursive: true });
      const isolatedModule = await import(
        `${pathToFileURL(join(isolatedRoot, 'dist/index.js')).href}?isolated=${Date.now()}`
      );

      await expect(isolatedModule.loadMigrations()).resolves.toEqual([
        expect.objectContaining({ name: '001_initial.sql' })
      ]);
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });
});
