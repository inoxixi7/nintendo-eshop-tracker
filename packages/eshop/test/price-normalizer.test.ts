import { ZodError } from 'zod';
import { describe, expect, it } from 'vitest';
import { normalizeNintendoPriceResponse } from '../src/nintendo-price/normalize-price.js';
import { NintendoPriceResponseSchema } from '../src/nintendo-price/price-schema.js';
import { readJsonFixture } from './fixture.js';

const OBSERVED_AT = '2026-08-11T01:02:03.456Z';

function money(overrides: Record<string, unknown> = {}) {
  return {
    amount: 'localized display text that must not be parsed',
    currency: 'JPY',
    raw_value: '7980',
    ...overrides
  };
}

function discountMoney(overrides: Record<string, unknown> = {}) {
  return {
    ...money({ raw_value: '4200' }),
    start_datetime: '2026-08-01T00:00:00Z',
    end_datetime: '2026-08-31T23:59:59.123Z',
    ...overrides
  };
}

function availablePrice(overrides: Record<string, unknown> = {}) {
  return {
    title_id: 70010000009999,
    sales_status: 'onsale',
    regular_price: money(),
    ...overrides
  };
}

function response(prices: unknown[] = [availablePrice()]) {
  return {
    personalized: false,
    country: 'JP',
    prices
  };
}

function normalizeRaw(raw: unknown, observedAt = OBSERVED_AT) {
  return normalizeNintendoPriceResponse(
    NintendoPriceResponseSchema.parse(raw),
    observedAt
  );
}

describe('Nintendo JP price response normalization', () => {
  it('exactly normalizes the representative response without mutating it', async () => {
    const input = await readJsonFixture('jp-price-response.json');
    const inputBefore = structuredClone(input);
    const parsed = NintendoPriceResponseSchema.parse(input);
    const parsedBefore = structuredClone(parsed);

    const result = normalizeNintendoPriceResponse(parsed, OBSERVED_AT);

    expect(result).toEqual({
      observations: [
        {
          country: 'JP',
          source: 'nintendo-price-api',
          sourceId: '70010000000001',
          currency: 'JPY',
          regularAmountMinor: 7980,
          discountAmountMinor: null,
          discountStartAt: null,
          discountEndAt: null,
          salesStatus: 'onsale',
          observedAt: OBSERVED_AT
        },
        {
          country: 'JP',
          source: 'nintendo-price-api',
          sourceId: '70010000000002',
          currency: 'JPY',
          regularAmountMinor: 6500,
          discountAmountMinor: 4200,
          discountStartAt: '2026-08-01T00:00:00Z',
          discountEndAt: '2026-08-31T23:59:59.123Z',
          salesStatus: 'onsale',
          observedAt: OBSERVED_AT
        },
        {
          country: 'JP',
          source: 'nintendo-price-api',
          sourceId: '70010000000003',
          currency: 'JPY',
          regularAmountMinor: 1200,
          discountAmountMinor: null,
          discountStartAt: null,
          discountEndAt: null,
          salesStatus: 'unreleased',
          observedAt: OBSERVED_AT
        }
      ],
      unavailableSourceIds: ['70010000000004']
    });
    expect(parsed).toEqual(expect.objectContaining({
      personalized: false,
      envelope_marker: 'fixture-extra'
    }));
    expect(parsed.prices[0]).toEqual(expect.objectContaining({
      entry_marker: 'normal-extra',
      regular_price: expect.objectContaining({ money_marker: 'regular-extra' })
    }));
    expect(parsed).toEqual(parsedBefore);
    expect(input).toEqual(inputBefore);
  });

  it('ignores localized display text and only parses raw_value', () => {
    const result = normalizeRaw(response([
      availablePrice({
        regular_price: money({
          amount: 'not a number: JPY ???',
          raw_value: '2468'
        })
      })
    ]));

    expect(result.observations[0]?.regularAmountMinor).toBe(2468);
  });

  it('keeps all discount fields null when discount_price is absent', () => {
    const result = normalizeRaw(response());

    expect(result.observations[0]).toEqual(expect.objectContaining({
      discountAmountMinor: null,
      discountStartAt: null,
      discountEndAt: null
    }));
  });

  it('preserves exact discount raw values and UTC boundaries', () => {
    const result = normalizeRaw(response([
      availablePrice({ discount_price: discountMoney() })
    ]));

    expect(result.observations[0]).toEqual(expect.objectContaining({
      regularAmountMinor: 7980,
      discountAmountMinor: 4200,
      discountStartAt: '2026-08-01T00:00:00Z',
      discountEndAt: '2026-08-31T23:59:59.123Z'
    }));
  });

  it('emits an unreleased regular price as an observation', () => {
    const result = normalizeRaw(response([
      availablePrice({ sales_status: 'unreleased' })
    ]));

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toEqual(expect.objectContaining({
      salesStatus: 'unreleased',
      regularAmountMinor: 7980
    }));
    expect(result.unavailableSourceIds).toEqual([]);
  });

  it('emits not_found only as an unavailable source ID', () => {
    const result = normalizeRaw(response([{
      title_id: 70010000009999,
      sales_status: 'not_found'
    }]));

    expect(result).toEqual({
      observations: [],
      unavailableSourceIds: ['70010000009999']
    });
  });
});

describe('Nintendo JP raw price schema', () => {
  it.each([
    ['mismatched country', { ...response(), country: 'US' }],
    ['missing country', { prices: [] }],
    ['missing prices', { country: 'JP' }],
    ['non-array prices', { country: 'JP', prices: {} }],
    ['null envelope', null]
  ])('rejects a malformed envelope with %s', (_name, raw) => {
    expect(NintendoPriceResponseSchema.safeParse(raw).success).toBe(false);
  });

  it.each([
    ['regular USD', availablePrice({ regular_price: money({ currency: 'USD' }) })],
    ['discount USD', availablePrice({ discount_price: discountMoney({ currency: 'USD' }) })]
  ])('rejects %s currency', (_name, price) => {
    expect(NintendoPriceResponseSchema.safeParse(response([price])).success).toBe(false);
  });

  it('requires regular_price for every status except not_found', () => {
    expect(NintendoPriceResponseSchema.safeParse(response([{
      title_id: 70010000009999,
      sales_status: 'unreleased'
    }])).success).toBe(false);
  });

  it.each([
    ['null', null],
    ['missing raw value', {
      amount: 'synthetic',
      currency: 'JPY',
      start_datetime: '2026-08-01T00:00:00Z',
      end_datetime: '2026-08-31T00:00:00Z'
    }],
    ['missing start', {
      amount: 'synthetic',
      currency: 'JPY',
      raw_value: '4200',
      end_datetime: '2026-08-31T00:00:00Z'
    }],
    ['missing end', {
      amount: 'synthetic',
      currency: 'JPY',
      raw_value: '4200',
      start_datetime: '2026-08-01T00:00:00Z'
    }]
  ])('rejects a %s discount_price', (_name, discount_price) => {
    const raw = response([availablePrice({ discount_price })]);

    expect(NintendoPriceResponseSchema.safeParse(raw).success).toBe(false);
  });

  it.each([
    ['start with an offset', { start_datetime: '2026-08-01T09:00:00+09:00' }],
    ['end with an offset', { end_datetime: '2026-09-01T08:59:59+09:00' }],
    ['start without Z', { start_datetime: '2026-08-01T00:00:00' }],
    ['invalid end', { end_datetime: 'not-a-datetime' }]
  ])('rejects discount datetime %s', (_name, overrides) => {
    const raw = response([availablePrice({
      discount_price: discountMoney(overrides)
    })]);

    expect(NintendoPriceResponseSchema.safeParse(raw).success).toBe(false);
  });

  it.each([
    ['negative', -1],
    ['fractional', 70010000000001.5],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
    ['string', '70010000000001']
  ])('rejects a %s title_id', (_name, title_id) => {
    expect(NintendoPriceResponseSchema.safeParse(response([
      availablePrice({ title_id })
    ])).success).toBe(false);
  });

  it('accepts additive fields at every raw response level', () => {
    const result = NintendoPriceResponseSchema.parse({
      ...response([availablePrice({
        entry_extra: true,
        regular_price: money({ money_extra: ['synthetic'] }),
        discount_price: discountMoney({ discount_extra: { retained: true } })
      })]),
      envelope_extra: 123
    });

    expect(result).toEqual(expect.objectContaining({ envelope_extra: 123 }));
    expect(result.prices[0]).toEqual(expect.objectContaining({ entry_extra: true }));
  });
});

describe('Nintendo JP normalized price validation', () => {
  it.each([
    ['fractional JPY', '7980.0'],
    ['localized raw value', 'JPY 7,980'],
    ['unsafe raw value', '9007199254740992']
  ])('rejects %s during normalization', (_name, raw_value) => {
    const parsed = NintendoPriceResponseSchema.parse(response([
      availablePrice({ regular_price: money({ raw_value }) })
    ]));

    expect(() => normalizeNintendoPriceResponse(parsed, OBSERVED_AT)).toThrow();
  });

  it('rejects a discount amount greater than the regular amount', () => {
    const parsed = NintendoPriceResponseSchema.parse(response([
      availablePrice({
        regular_price: money({ raw_value: '4000' }),
        discount_price: discountMoney({ raw_value: '4200' })
      })
    ]));

    expect(() => normalizeNintendoPriceResponse(parsed, OBSERVED_AT)).toThrow(ZodError);
  });

  it.each([
    ['equal', '2026-08-01T00:00:00Z'],
    ['earlier', '2026-07-31T23:59:59Z']
  ])('rejects a discount end that is %s to its start', (_name, end_datetime) => {
    const parsed = NintendoPriceResponseSchema.parse(response([
      availablePrice({
        discount_price: discountMoney({ end_datetime })
      })
    ]));

    expect(() => normalizeNintendoPriceResponse(parsed, OBSERVED_AT)).toThrow(ZodError);
  });

  it.each([
    ['missing Z', '2026-08-11T01:02:03.456'],
    ['non-UTC offset', '2026-08-11T10:02:03.456+09:00'],
    ['more than millisecond precision', '2026-08-11T01:02:03.4567Z']
  ])('rejects observedAt with %s', (_name, observedAt) => {
    expect(() => normalizeRaw(response(), observedAt)).toThrow(ZodError);
  });

  it('rejects discount timestamps with more than millisecond precision in the final batch', () => {
    const parsed = NintendoPriceResponseSchema.parse(response([
      availablePrice({
        discount_price: discountMoney({
          start_datetime: '2026-08-01T00:00:00.0001Z'
        })
      })
    ]));

    expect(() => normalizeNintendoPriceResponse(parsed, OBSERVED_AT)).toThrow(ZodError);
  });
});
