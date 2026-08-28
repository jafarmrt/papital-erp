import Decimal from 'decimal.js';

// Set global precision to 30 digits and Banker's / Half-Up rounding standard
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type DecimalValue = string | number | null | undefined | Decimal | FinancialDecimal;

export class FinancialDecimal {
  private readonly value: Decimal;

  constructor(input: DecimalValue) {
    if (input instanceof FinancialDecimal) {
      this.value = input.value;
    } else if (input instanceof Decimal) {
      this.value = input;
    } else if (input === null || input === undefined || input === '') {
      this.value = new Decimal(0);
    } else if (typeof input === 'number') {
      if (isNaN(input) || !isFinite(input)) {
        this.value = new Decimal(0);
      } else {
        this.value = new Decimal(input);
      }
    } else {
      const clean = String(input).replace(/,/g, '').trim();
      if (!clean || clean === 'NaN' || clean === 'null' || clean === 'undefined') {
        this.value = new Decimal(0);
      } else {
        try {
          this.value = new Decimal(clean);
        } catch {
          this.value = new Decimal(0);
        }
      }
    }
  }

  private static toDecimal(val: DecimalValue): Decimal {
    if (val instanceof FinancialDecimal) return val.value;
    if (val instanceof Decimal) return val;
    return new FinancialDecimal(val).value;
  }

  // Factory methods
  public static from(val: DecimalValue): FinancialDecimal {
    return new FinancialDecimal(val);
  }

  public static zero(): FinancialDecimal {
    return new FinancialDecimal(0);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isNegative(): boolean {
    return this.value.isNegative() && !this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  public toString(): string {
    return this.value.toString();
  }

  public toNumber(): number {
    return this.value.toNumber();
  }

  /**
   * Compare two decimals:
   * returns 1 if this > other
   * returns -1 if this < other
   * returns 0 if this === other
   */
  public compareTo(other: DecimalValue): number {
    return this.value.comparedTo(FinancialDecimal.toDecimal(other));
  }

  public equals(other: DecimalValue): boolean {
    return this.value.equals(FinancialDecimal.toDecimal(other));
  }

  public greaterThan(other: DecimalValue): boolean {
    return this.value.greaterThan(FinancialDecimal.toDecimal(other));
  }

  public greaterThanOrEqual(other: DecimalValue): boolean {
    return this.value.greaterThanOrEqualTo(FinancialDecimal.toDecimal(other));
  }

  public lessThan(other: DecimalValue): boolean {
    return this.value.lessThan(FinancialDecimal.toDecimal(other));
  }

  public lessThanOrEqual(other: DecimalValue): boolean {
    return this.value.lessThanOrEqualTo(FinancialDecimal.toDecimal(other));
  }

  // Arithmetic operations
  public add(other: DecimalValue): FinancialDecimal {
    return new FinancialDecimal(this.value.plus(FinancialDecimal.toDecimal(other)));
  }

  public subtract(other: DecimalValue): FinancialDecimal {
    return new FinancialDecimal(this.value.minus(FinancialDecimal.toDecimal(other)));
  }

  public multiply(other: DecimalValue): FinancialDecimal {
    return new FinancialDecimal(this.value.times(FinancialDecimal.toDecimal(other)));
  }

  public divide(other: DecimalValue, scale: number = 4): FinancialDecimal {
    const divisor = FinancialDecimal.toDecimal(other);
    if (divisor.isZero()) {
      throw new Error('Divide by zero in FinancialDecimal');
    }
    const result = this.value.dividedBy(divisor);
    return new FinancialDecimal(result.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP));
  }

  public negate(): FinancialDecimal {
    return new FinancialDecimal(this.value.negated());
  }

  public abs(): FinancialDecimal {
    return new FinancialDecimal(this.value.abs());
  }

  /**
   * Round to specific decimal places using Banker's / Half-Up Rounding.
   */
  public round(decimalPlaces: number = 4): FinancialDecimal {
    return new FinancialDecimal(this.value.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP));
  }

  /**
   * Format for database storage: NUMERIC(18, 4) string.
   */
  public toDbString(): string {
    return this.round(4).toString();
  }

  /**
   * Format with thousands separators for UI display.
   */
  public toDisplayString(decimalPlaces: number = 2): string {
    const rounded = this.round(decimalPlaces).toString();
    const parts = rounded.split('.');
    const intWithCommas = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts[1] && parseInt(parts[1], 10) !== 0 ? `${intWithCommas}.${parts[1]}` : intWithCommas;
  }
}

/**
 * Standard Helper Function
 */
export const fin = (val: DecimalValue): FinancialDecimal => new FinancialDecimal(val);

export const FinancialMath = {
  // Sum array of decimal values
  sum: (items: DecimalValue[]): FinancialDecimal => {
    return items.reduce<FinancialDecimal>((acc, item) => acc.add(item), FinancialDecimal.zero());
  },

  // Calculate Weighted Average Cost (WAC)
  calculateWAC: (
    currentStock: DecimalValue,
    currentWAC: DecimalValue,
    incomingQty: DecimalValue,
    incomingUnitPrice: DecimalValue
  ): FinancialDecimal => {
    const curQty = fin(currentStock);
    const curCost = fin(currentWAC);
    const inQty = fin(incomingQty);
    const inPrice = fin(incomingUnitPrice);

    if (inQty.lessThanOrEqual(0)) {
      return curCost;
    }

    if (curQty.lessThanOrEqual(0)) {
      return inPrice.round(4);
    }

    const currentTotalValue = curQty.multiply(curCost);
    const incomingTotalValue = inQty.multiply(inPrice);
    const totalQty = curQty.add(inQty);

    if (totalQty.isZero()) return inPrice.round(4);

    return currentTotalValue.add(incomingTotalValue).divide(totalQty, 4);
  },

  // Calculate document item total (qty * unitPrice - discount + vat)
  calculateItemTotal: (
    quantity: DecimalValue,
    unitPrice: DecimalValue,
    discountAmount: DecimalValue = 0,
    vatAmount: DecimalValue = 0
  ): FinancialDecimal => {
    const subtotal = fin(quantity).multiply(unitPrice);
    return subtotal.subtract(discountAmount).add(vatAmount).round(4);
  },

  // Rounding standard for currency (IRR / Toman) vs Foreign currencies
  roundCurrency: (amount: DecimalValue, currency: string = 'IRR'): FinancialDecimal => {
    const d = fin(amount);
    if (currency === 'IRR' || currency === 'TMN' || currency === 'ریال' || currency === 'تومان') {
      return d.round(0); // Integer for Rial
    }
    return d.round(2); // 2 decimal places for USD, EUR, etc.
  },

  // Backward compatible number arithmetic methods
  round: (val: DecimalValue, decimals: number = 4): number => {
    return fin(val).round(decimals).toNumber();
  },

  roundMoney: (val: DecimalValue): number => {
    return fin(val).round(2).toNumber();
  },

  roundQty: (val: DecimalValue): number => {
    return fin(val).round(4).toNumber();
  },

  add: (a: DecimalValue, b: DecimalValue): number => {
    return fin(a).add(b).round(4).toNumber();
  },

  subtract: (a: DecimalValue, b: DecimalValue): number => {
    return fin(a).subtract(b).round(4).toNumber();
  },

  multiply: (a: DecimalValue, b: DecimalValue): number => {
    return fin(a).multiply(b).round(4).toNumber();
  },

  divide: (a: DecimalValue, b: DecimalValue): number => {
    const denom = fin(b);
    if (denom.isZero()) return 0;
    return fin(a).divide(denom, 4).toNumber();
  }
};
