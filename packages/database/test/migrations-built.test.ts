import { access, cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('built database package', () => {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

  it('loads migrations from an isolated built package layout', async () => {
    const isolatedRoot = await mkdtemp(join(tmpdir(), 'eshop-tracker-database-'));

    try {
      await cp(join(packageRoot, 'dist'), join(isolatedRoot, 'dist'), { recursive: true });
      const moduleUrl = pathToFileURL(join(isolatedRoot, 'dist/index.js')).href;
      const script = [
        `import { loadMigrations } from ${JSON.stringify(moduleUrl)};`,
        'console.log(JSON.stringify((await loadMigrations()).map(({ name }) => name)));'
      ].join('\n');
      const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script]);

      expect(result.stdout.trim()).toBe('["001_initial.sql","002_search.sql","003_genre_index.sql"]');
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  it('removes stale migrations during a clean build', async () => {
    const stalePath = join(packageRoot, 'dist/migrations/999_stale.sql');
    await mkdir(dirname(stalePath), { recursive: true });
    await writeFile(stalePath, '-- stale migration\n', 'utf8');

    await execFileAsync('npm', ['run', 'build'], { cwd: packageRoot });

    await expect(access(stalePath)).rejects.toThrow();
  });
});
