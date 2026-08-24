import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Migration = {
  name: string;
  sql: string;
};

async function readMigrationEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function loadMigrations(): Promise<Migration[]> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const migrationDirectories = [join(moduleDirectory, 'migrations'), join(moduleDirectory, '../migrations')];
  let migrationDirectory: string | undefined;
  let entries: Awaited<ReturnType<typeof readMigrationEntries>>;

  for (const directory of migrationDirectories) {
    const candidateEntries = await readMigrationEntries(directory);
    if (candidateEntries?.some((entry) => entry.isFile() && entry.name.endsWith('.sql'))) {
      migrationDirectory = directory;
      entries = candidateEntries;
      break;
    }
  }

  if (!migrationDirectory || !entries) {
    throw new Error(`No SQL migrations found relative to ${moduleDirectory}`);
  }

  const migrationNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(migrationNames.map(async (name) => ({
    name,
    sql: await readFile(join(migrationDirectory, name), 'utf8')
  })));
}
