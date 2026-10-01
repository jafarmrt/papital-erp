/**
 * Central Utils Facade & Modular Architecture (V7 Phase 4.4 / TD-080)
 * 
 * Functions are decomposed into modular domains under `src/utils/`:
 * 1. `persianNumber.ts`: Number conversions, Persian digits, Persian words & financial amount to words
 * 2. `dateUtils.ts`: Jalali/Gregorian conversions, timestamp formatting, timezone & relative dates
 * 3. `cardValidation.ts`: Bank card, Sheba (IBAN), National ID & Iranian phone validations
 * 4. `formatters.ts`: Tailwind cn, file size, price labels, string normalizers & safe array extractors
 */

export * from "./utils/index.js";
