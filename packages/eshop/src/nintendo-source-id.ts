import { z } from 'zod';

export const NINTENDO_SOURCE_ID_VALIDATION_MESSAGE =
  'Nintendo source ID must be a canonical 14-digit integer';

export const NintendoSourceIdSchema = z.string().regex(
  /^[1-9]\d{13}$/,
  NINTENDO_SOURCE_ID_VALIDATION_MESSAGE
);
