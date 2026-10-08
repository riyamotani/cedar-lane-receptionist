// Normalizes a US/Canada number to E.164, e.g. "(415) 555-0190" -> "+14155550190".
// Returns null for anything else (too short, international, impossible) so the agent asks again.
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // North American numbering: area code and exchange can't start with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}
