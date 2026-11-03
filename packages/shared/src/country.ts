import { z } from 'zod';

export const CountryCodeSchema = z.enum(['JP', 'US', 'GB', 'CA', 'MX', 'BR']);
export type CountryCode = z.infer<typeof CountryCodeSchema>;

export const CurrencyCodeSchema = z.enum(['JPY', 'USD', 'GBP', 'CAD', 'MXN', 'BRL']);
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
