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
});
