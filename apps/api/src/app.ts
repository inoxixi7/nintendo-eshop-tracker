import type { QueryClient } from '@eshop-tracker/database';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getHealth, getListing, getPriceHistory, listListings } from './queries.js';

const MAX_PAGE_SIZE = 100;

const Platform = z.enum(['switch', 'switch2']);
const ProductType = z.enum(['game', 'bundle', 'dlc', 'unknown']);
const BooleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');
const Page = z.coerce.number().int().min(1).max(10_000).default(1);
const PageSize = z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20);

const ListingsQuery = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  platform: Platform.optional(),
  type: ProductType.optional(),
  onSale: BooleanFlag.optional(),
  sort: z.enum(['releaseDate', 'title', 'discount']).default('releaseDate'),
  page: Page,
  pageSize: PageSize
}).strict();

const DealsQuery = z.object({
  platform: Platform.optional(),
  type: ProductType.optional(),
  minDiscountPercent: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.enum(['discount', 'endingSoon']).default('discount'),
  page: Page,
  pageSize: PageSize
}).strict();

const ListingParams = z.object({ id: z.uuid() });

const HistoryQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500)
}).strict();

class ApiError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.join('.') || 'query';
  throw new ApiError(400, 'INVALID_QUERY', `${field}: ${issue?.message ?? 'is invalid'}`);
}

function sendError(request: FastifyRequest, reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send({ error: { code, message, requestId: request.id } });
}

function notFound(): never {
  throw new ApiError(404, 'NOT_FOUND', 'listing not found');
}

export function buildApp(db: QueryClient, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return sendError(request, reply, error.statusCode, error.code, error.message);
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return sendError(request, reply, statusCode, 'BAD_REQUEST', 'request is invalid');
    }
    request.log.error(error);
    return sendError(request, reply, 500, 'INTERNAL', 'internal error');
  });
  app.setNotFoundHandler((request, reply) => sendError(request, reply, 404, 'NOT_FOUND', 'route not found'));

  app.get('/v1/health', async () => getHealth(db));

  app.get('/v1/listings', async (request) => {
    const query = parse(ListingsQuery, request.query);
    const result = await listListings(db, query);
    return { items: result.items, page: query.page, pageSize: query.pageSize, total: result.total };
  });

  app.get('/v1/deals', async (request) => {
    const query = parse(DealsQuery, request.query);
    const result = await listListings(db, { ...query, onSale: true });
    return { items: result.items, page: query.page, pageSize: query.pageSize, total: result.total };
  });

  app.get('/v1/listings/:id', async (request) => {
    const { id } = parse(ListingParams, request.params);
    return (await getListing(db, id)) ?? notFound();
  });

  app.get('/v1/listings/:id/price-history', async (request) => {
    const { id } = parse(ListingParams, request.params);
    const query = parse(HistoryQuery, request.query);
    return (await getPriceHistory(db, id, query)) ?? notFound();
  });

  return app;
}
