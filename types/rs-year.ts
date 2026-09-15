/** RS sheet years actually included in the published dataset. */
export const SUPPORTED_YEARS = ['2024', '2025'] as const;
export type SupportedYear = (typeof SUPPORTED_YEARS)[number];
