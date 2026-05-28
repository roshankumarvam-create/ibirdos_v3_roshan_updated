/**
 * Class merger — joins truthy class strings, last-wins on Tailwind
 * conflicts. Used by every UI primitive.
 */
type ClassValue = string | number | null | undefined | boolean | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  return flatten(inputs).filter(Boolean).join(" ");
}

function flatten(values: ClassValue[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (Array.isArray(v)) out.push(...flatten(v));
    else out.push(String(v));
  }
  return out;
}
