import { describe, expect, it } from 'vitest';
import { parseWorkerConfig } from '../src/config.js';

const databaseUrl = 'postgresql://tracker:secret@database:5432/eshop';

describe('parseWorkerConfig', () => {
  it('uses durable scheduling defaults', () => {
    expect(parseWorkerConfig({ DATABASE_URL: databaseUrl })).toEqual({
      databaseUrl,
      catalogCron: '0 3 * * *',
      priceCron: '0 */6 * * *',
      timeZone: 'UTC',
      runOnStartup: true
    });
    expect(Object.isFrozen(parseWorkerConfig({ DATABASE_URL: databaseUrl }))).toBe(true);
  });

  it.each([
    undefined,
    '',
    'mysql://database/eshop',
    'https://database/eshop',
    'postgresql://database/eshop\npassword=leaked',
    'postgresql://'
  ])('rejects an invalid database URL without including it in the error', (value) => {
    const attempt = () => parseWorkerConfig({ DATABASE_URL: value });
    expect(attempt).toThrow('Worker configuration is invalid');
    if (value !== undefined) expect(attempt).not.toThrow(value);
  });

  it.each([
    { CATALOG_CRON: 'every day' },
    { PRICE_CRON: '* *' },
    { TZ: 'Not/A_Real_Zone' }
  ])('rejects schedules that Croner cannot parse', (overrides) => {
    expect(() => parseWorkerConfig({ DATABASE_URL: databaseUrl, ...overrides }))
      .toThrow('Worker configuration is invalid');
  });

  it('accepts only lower-case explicit startup booleans', () => {
    expect(parseWorkerConfig({ DATABASE_URL: databaseUrl, RUN_ON_STARTUP: 'false' }).runOnStartup).toBe(false);
    expect(parseWorkerConfig({ DATABASE_URL: databaseUrl, RUN_ON_STARTUP: 'true' }).runOnStartup).toBe(true);
    expect(() => parseWorkerConfig({ DATABASE_URL: databaseUrl, RUN_ON_STARTUP: 'TRUE' }))
      .toThrow('Worker configuration is invalid');
    expect(() => parseWorkerConfig({ DATABASE_URL: databaseUrl, RUN_ON_STARTUP: 'yes' }))
      .toThrow('Worker configuration is invalid');
  });
});
