/**
 * Money helpers. Amounts move through the service as integer paise; Postgres
 * numeric(12,2) values arrive as strings ("4500.00") and leave as strings.
 */

/** "4500.50" | 4500.5 -> 450050 (exact for strings, which is what pg returns) */
export function toPaise(value) {
  if (value === null || value === undefined) return 0;
  const text = typeof value === 'number' ? value.toFixed(2) : String(value);
  const negative = text.startsWith('-');
  const [rupees, fraction = ''] = text.replace('-', '').split('.');
  const paise = Number(rupees) * 100 + Number((fraction + '00').slice(0, 2));
  return negative ? -paise : paise;
}

/** 450050 -> "4500.50" (safe to pass to a numeric parameter) */
export function fromPaise(paise) {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}
