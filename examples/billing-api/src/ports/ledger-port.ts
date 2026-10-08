import Decimal from "decimal.js";

export enum Currency {
  EUR = "EUR",
  USD = "USD",
}

/** Single place where monetary rounding happens (banker's rounding, per currency). */
export const LedgerPort = {
  round(amount: number, currency: Currency): number {
    const decimals = currency === Currency.EUR || currency === Currency.USD ? 2 : 0;
    return new Decimal(amount).toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN).toNumber();
  },
};
