import { describe, expect, it } from 'vitest';
import { loadMigrations } from '../src/index.js';

describe('database migrations', () => {
  it('loads the initial migration in lexical order with the tracker schema', async () => {
    const migrations = await loadMigrations();

    expect(migrations.map(({ name }) => name)).toEqual(['001_initial.sql', '002_search.sql', '003_genre_index.sql']);

    const sql = migrations[0]?.sql ?? '';
    expect(sql).toMatch(/CREATE TABLE regional_listings/i);
    expect(sql).toMatch(/CREATE TABLE current_prices/i);
    expect(sql).toMatch(/CREATE TABLE price_history/i);
    expect(sql).toMatch(/CREATE TABLE sync_runs/i);
    expect(sql).toMatch(/UNIQUE\s*\(country,\s*source,\s*source_id\)/i);
  });

  it('adds the search column and alias table', async () => {
    const sql = (await loadMigrations())[1]?.sql ?? '';
    expect(sql).toMatch(/ADD COLUMN title_norm text NOT NULL DEFAULT ''/);
    expect(sql).toMatch(/CREATE TABLE title_aliases/);
  });
});
