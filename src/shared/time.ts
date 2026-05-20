export function addMinutes(baseTime: Date, minutes: number): Date {
  return new Date(baseTime.getTime() + minutes * 60_000);
}
