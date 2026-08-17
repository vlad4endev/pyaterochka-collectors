const PHONE_MAX_LEN = 20;

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }
  let national = digits;
  if (digits.length === 11 && digits.startsWith("8")) {
    national = `7${digits.slice(1)}`;
  } else if (digits.length === 10) {
    national = `7${digits}`;
  }
  const canonical = `+${national}`;
  return canonical.length <= PHONE_MAX_LEN ? canonical : canonical.slice(0, PHONE_MAX_LEN);
}

export function phoneMatchValues(raw: string): string[] {
  const canonical = normalizePhone(raw);
  if (!canonical) {
    return [];
  }
  const digits = canonical.replace(/\D/g, "");
  const values = new Set<string>([canonical, digits, raw.trim()]);
  if (digits.length === 11 && digits.startsWith("7")) {
    const local = digits.slice(1);
    values.add(`+7${local}`);
    values.add(`7${local}`);
    values.add(`8${local}`);
    values.add(`+8${local}`);
  }
  return [...values].filter((value) => value.length > 0);
}

export function phoneFromVcf(vcf: string | null | undefined): string | null {
  if (!vcf) {
    return null;
  }
  const match = vcf.match(/TEL[^:]*:([^\r\n]+)/i);
  return match?.[1] ? normalizePhone(match[1]) : null;
}
