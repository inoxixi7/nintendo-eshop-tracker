import { z } from 'zod';

export const CountryCodeSchema = z.enum(['JP', 'US', 'GB']);
export type CountryCode = z.infer<typeof CountryCodeSchema>;

export const CurrencyCodeSchema = z.enum(['JPY', 'USD', 'GBP']);
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
