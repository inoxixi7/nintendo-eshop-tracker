import type { CountryCode, CurrencyCode, PriceObservation } from '@eshop-tracker/shared';
import { EshopError } from '../errors.js';
import type { PriceFetchResult } from '../price-fetch-result.js';
import {
  NINTENDO_SOURCE_ID_VALIDATION_MESSAGE,
  NintendoSourceIdSchema
} from '../nintendo-source-id.js';
import { requestJson, type FetchLike } from '../upstream-json.js';
import { validatePriceBatch } from '../validate-batch.js';
import { normalizeNintendoPriceResponse } from './normalize-price.js';
import {
  NintendoPriceResponseSchema,
  type NintendoPriceResponse
} from './price-schema.js';

export interface NintendoPriceClientOptions {
  fetch: FetchLike;
  now: () => Date;
  country?: CountryCode;
}

const STORES = {
  JP: { lang: 'ja', currency: 'JPY' },
  US: { lang: 'en', currency: 'USD' },
  GB: { lang: 'en', currency: 'GBP' },
  CA: { lang: 'en', currency: 'CAD' },
  MX: { lang: 'es', currency: 'MXN' },
  BR: { lang: 'pt', currency: 'BRL' }
} satisfies Record<CountryCode, { lang: string; currency: CurrencyCode }>;

const PRICE_URL = 'https://api.ec.nintendo.com/v1/price';
const MAX_BATCH_SIZE = 50;

function invalidPayload(cause: unknown, country: CountryCode): EshopError {
  return new EshopError({
    code: 'INVALID_PAYLOAD',
    message: 'Nintendo price payload is invalid',
    country,
    cause
  });
}

function reconcileResponse(
  response: NintendoPriceResponse,
  requestedSourceIds: readonly string[]
): void {
  const requested = new Set(requestedSourceIds.map(Number));
  const received = new Set<number>();

  for (const price of response.prices) {
    const sourceId = price.title_id;

    if (!requested.has(sourceId)) {
      throw new Error('Nintendo price response contained an unexpected source ID');
    }
    if (received.has(sourceId)) {
      throw new Error('Nintendo price response contained a duplicate source ID');
    }

    received.add(sourceId);
  }

  for (const sourceId of requestedSourceIds) {
    if (!received.has(Number(sourceId))) {
      throw new Error('Nintendo price response omitted a requested source ID');
    }
  }
}

export class NintendoPriceClient {
  constructor(private readonly options: NintendoPriceClientOptions) {}

  async fetchPrices(
    sourceIds: readonly string[],
    signal?: AbortSignal
  ): Promise<PriceFetchResult> {
    const country = this.options.country ?? 'JP';
    const store = STORES[country];
    const uniqueSourceIds: string[] = [];
    const seenInput = new Set<string>();

    for (const sourceId of sourceIds) {
      const parsedSourceId = NintendoSourceIdSchema.safeParse(sourceId);
      if (!parsedSourceId.success) {
        throw invalidPayload(new Error(NINTENDO_SOURCE_ID_VALIDATION_MESSAGE), country);
      }

      if (!seenInput.has(sourceId)) {
        seenInput.add(sourceId);
        uniqueSourceIds.push(sourceId);
      }
    }

    if (uniqueSourceIds.length === 0) {
      return { observations: [], unavailableSourceIds: [] };
    }

    const observedAt = this.options.now().toISOString();
    const observationsBySourceId = new Map<string, PriceObservation>();
    const unavailableSourceIds = new Set<string>();
    const classifiedSourceIds = new Set<string>();

    for (let offset = 0; offset < uniqueSourceIds.length; offset += MAX_BATCH_SIZE) {
      const batch = uniqueSourceIds.slice(offset, offset + MAX_BATCH_SIZE);
      const url = new URL(PRICE_URL);
      url.searchParams.set('country', country);
      url.searchParams.set('lang', store.lang);
      url.searchParams.set('ids', batch.join(','));

      const raw = await requestJson({
        fetch: this.options.fetch,
        url,
        country,
        ...(signal === undefined ? {} : { signal })
      });

      try {
        const response = NintendoPriceResponseSchema.parse(raw);
        reconcileResponse(response, batch);
        const normalized = normalizeNintendoPriceResponse(response, observedAt, country, store.currency);

        for (const observation of normalized.observations) {
          if (classifiedSourceIds.has(observation.sourceId)) {
            throw new Error('Nintendo price result classified a source ID more than once');
          }
          classifiedSourceIds.add(observation.sourceId);
          observationsBySourceId.set(observation.sourceId, observation);
        }

        for (const sourceId of normalized.unavailableSourceIds) {
          if (classifiedSourceIds.has(sourceId)) {
            throw new Error('Nintendo price result classified a source ID more than once');
          }
          classifiedSourceIds.add(sourceId);
          unavailableSourceIds.add(sourceId);
        }
      } catch (cause) {
        throw invalidPayload(cause, country);
      }
    }

    const observations = uniqueSourceIds.flatMap((sourceId) => {
      const observation = observationsBySourceId.get(sourceId);
      return observation === undefined ? [] : [observation];
    });
    const orderedUnavailableSourceIds = uniqueSourceIds.filter(
      (sourceId) => unavailableSourceIds.has(sourceId)
    );

    try {
      return {
        observations: validatePriceBatch(observations, country),
        unavailableSourceIds: orderedUnavailableSourceIds
      };
    } catch (cause) {
      throw invalidPayload(cause, country);
    }
  }
}
