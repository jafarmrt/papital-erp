/**
 * Financial Math Utility (Re-exported from centralized high-precision FinancialDecimal)
 * 
 * Provides backwards compatibility for legacy imports from utils/financialMath.js
 * while delegating all calculations to decimal.js-backed FinancialDecimal.
 */

export { fin, FinancialDecimal, FinancialMath, type DecimalValue } from '../lib/financialDecimal.js';
