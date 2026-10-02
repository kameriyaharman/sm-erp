/**
 * Indian-system amount in words, for receipts:
 *   3900050 paise -> "Rupees Thirty-Nine Thousand and Fifty Paise Only"
 *   1234567800 paise -> "Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only"
 */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

function belowThousand(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

export function rupeesInWords(paise) {
  if (!Number.isInteger(paise) || paise < 0) throw new TypeError('paise must be a non-negative integer');
  let rupees = Math.floor(paise / 100);
  const p = paise % 100;

  const parts = [];
  const crore = Math.floor(rupees / 1e7);
  rupees %= 1e7;
  const lakh = Math.floor(rupees / 1e5);
  rupees %= 1e5;
  const thousand = Math.floor(rupees / 1e3);
  rupees %= 1e3;

  if (crore) parts.push(`${crore >= 1000 ? rupeesInWords(crore * 100).replace(/^Rupees | Only$/g, '') : belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rupees) parts.push(belowThousand(rupees));

  const rupeeText = parts.length ? parts.join(' ') : 'Zero';
  return `Rupees ${rupeeText}${p ? ` and ${belowHundred(p)} Paise` : ''} Only`;
}
