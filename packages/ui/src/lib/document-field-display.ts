/** Identifier suggestions remain masked even in lender analysis; the original source is unchanged. */
export function displayDocumentField(field: { key: string; label: string; value: string }) {
  const label = `${field.key} ${field.label}`.replaceAll("_", " ");
  if (!/\b(?:ein|tin|ssn|taxpayer|social security)\b|\btax\s+(?:identification|id)\b/i.test(label))
    return field.value;
  const digits = field.value.replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "Masked identifier";
}
