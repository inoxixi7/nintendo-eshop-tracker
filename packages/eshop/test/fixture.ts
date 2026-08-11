import { readFile } from 'node:fs/promises';

export async function readJsonFixture(name: string): Promise<unknown> {
  const contents = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
  return JSON.parse(contents) as unknown;
}
