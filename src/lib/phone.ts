/**
 * Phone numbers are stored in international form (+27821234567) so WhatsApp links
 * and SMS work. Local South African formats are assumed when there is no country code.
 */
export function normalisePhone(input: string): string | null {
  let digits = input.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(digits)) return null;

  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  // No "+", "00" or "0": only two readings are safe. 27 + 9 digits is South African already;
  // 9 digits is a South African number whose leading 0 a spreadsheet dropped. Anything else
  // would be a guess, so it is refused rather than stored as some other country's number.
  else if (/^[1-8]\d{8}$/.test(digits)) digits = `27${digits}`;
  else if (!/^27\d{9}$/.test(digits)) return null;

  // South African numbers are 27 + 9 digits; others follow E.164 (8–15 digits).
  if (digits.startsWith("27") && digits.length !== 11) return null;
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}

/** wa.me wants the digits without the plus. */
export function whatsappNumber(e164: string): string {
  return e164.replace(/^\+/, "");
}
