export const NEW_ARRIVAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function canEditNewArrival(createdAt: Date, now = Date.now()): boolean {
  const age = now - createdAt.getTime();
  return Number.isFinite(age) && age >= 0 && age < NEW_ARRIVAL_DURATION_MS;
}
