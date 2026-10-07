/** Decimal string parsing happens before PostgreSQL can round numeric(20,2) input. */
export function normalizeMoney(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,17})(\.\d{1,2})?$/.test(value)) {
    throw new Error(
      "Amount must be a positive decimal string with at most 18 whole digits and 2 decimal places.",
    );
  }
  const [whole, fraction = ""] = value.split(".");
  const normalized = `${whole}.${fraction.padEnd(2, "0")}`;
  if (normalized === "0.00") throw new Error("Amount must be greater than zero.");
  return normalized;
}
