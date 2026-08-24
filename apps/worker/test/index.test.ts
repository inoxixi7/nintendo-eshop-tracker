import { describe, expect, it } from 'vitest';
import { runCatalogSync, runPriceSync } from '../src/index.js';

describe('worker public API', () => {
  it('exports synchronization functions from one package entry point', () => {
    expect(runCatalogSync).toBeTypeOf('function');
    expect(runPriceSync).toBeTypeOf('function');
  });
});
