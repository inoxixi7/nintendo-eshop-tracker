import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Migration = {
  name: string;
  sql: string;
};

export async function loadMigrations(): Promise<Migration[]> {
  const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
  const entries = await readdir(migrationDirectory, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(migrationNames.map(async (name) => ({
    name,
    sql: await readFile(join(migrationDirectory, name), 'utf8')
  })));
}
