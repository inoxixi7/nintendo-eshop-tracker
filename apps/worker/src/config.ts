import { Cron } from 'croner';

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly catalogCron: string;
  readonly priceCron: string;
  readonly timeZone: string;
  readonly runOnStartup: boolean;
}

const DEFAULT_CATALOG_CRON = '0 3 * * *';
const DEFAULT_PRICE_CRON = '0 */6 * * *';
const DEFAULT_TIME_ZONE = 'UTC';
const CONFIGURATION_ERROR = 'Worker configuration is invalid';

function invalidConfiguration(): never {
  throw new Error(CONFIGURATION_ERROR);
}

function readDatabaseUrl(value: string | undefined): string {
  if (typeof value !== 'string' || value.length === 0 || /[\p{Cc}]/u.test(value)) {
    return invalidConfiguration();
  }

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:')
      || parsed.hostname.length === 0
    ) {
      return invalidConfiguration();
    }
  } catch {
    return invalidConfiguration();
  }
  return value;
}

function readBoolean(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return invalidConfiguration();
}

function validateSchedule(expression: string, timeZone: string): void {
  try {
    // ICU is the platform authority for IANA timezone names. Croner receives
    // the same value below when it parses the expression.
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    invalidConfiguration();
  }

  let cron: Cron | undefined;
  try {
    // `paused` makes this parser-only validation: no callback/timer is ever started.
    cron = new Cron(expression, { paused: true, timezone: timeZone });
  } catch {
    invalidConfiguration();
  } finally {
    cron?.stop();
  }
}

export function parseWorkerConfig(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  const databaseUrl = readDatabaseUrl(env.DATABASE_URL);
  const catalogCron = env.CATALOG_CRON ?? DEFAULT_CATALOG_CRON;
  const priceCron = env.PRICE_CRON ?? DEFAULT_PRICE_CRON;
  const timeZone = env.TZ ?? DEFAULT_TIME_ZONE;

  if (
    typeof catalogCron !== 'string'
    || typeof priceCron !== 'string'
    || typeof timeZone !== 'string'
    || /[\p{Cc}]/u.test(catalogCron)
    || /[\p{Cc}]/u.test(priceCron)
    || /[\p{Cc}]/u.test(timeZone)
  ) {
    return invalidConfiguration();
  }

  validateSchedule(catalogCron, timeZone);
  validateSchedule(priceCron, timeZone);
  return Object.freeze({
    databaseUrl,
    catalogCron,
    priceCron,
    timeZone,
    runOnStartup: readBoolean(env.RUN_ON_STARTUP)
  });
}
