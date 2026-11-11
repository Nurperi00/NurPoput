export function normalizePhone(input: string): string | null {
  let digits = String(input ?? "").replace(/[^\d+]/g, "");
  const hadPlus = digits.startsWith("+");
  digits = digits.replace(/\+/g, "");

  if (!digits) return null;

  if (!hadPlus) {
    if (digits.startsWith("996")) {
      digits = `+${digits}`;
    } else if (digits.startsWith("0")) {
      digits = `+996${digits.slice(1)}`;
    } else {
      digits = `+996${digits}`;
    }
  } else {
    digits = `+${digits}`;
  }

  if (!/^\+\d{10,15}$/.test(digits)) return null;

  return digits;
}
