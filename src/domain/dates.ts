import { asIsoDate, type IsoDate } from "@/domain/ids";

function julian(iso: string): number {
  const [y, m, d] = iso.split("-").map((part) => parseInt(part, 10));
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function fromJulian(jd: number): IsoDate {
  const a = jd + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return asIsoDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

export function daysBetween(earlier: IsoDate, later: IsoDate): number {
  return julian(later) - julian(earlier);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromJulian(julian(iso) + days);
}

export function inCandidateWindow(issuedOn: IsoDate, valueDate: IsoDate): boolean {
  const age = daysBetween(issuedOn, valueDate);
  return age >= 0 && age <= 60;
}
