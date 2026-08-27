import type { CheckCategory, CheckStatus } from '@/shared/contract';

export const CATEGORIES: { value: CheckCategory; label: string }[] = [
  { value: 'vessel', label: 'Vessel & Engineering' },
  { value: 'navigation', label: 'Navigation & Comms' },
  { value: 'safety', label: 'Safety Equipment' },
  { value: 'crew', label: 'Crew Readiness' },
  { value: 'passenger', label: 'Passenger & Loading' },
  { value: 'compliance', label: 'Regulatory Compliance' },
];

export const STATUSES: { value: CheckStatus; label: string; color: string }[] = [
  { value: 'ok', label: 'OK', color: '#22c55e' },
  { value: 'issue', label: 'Issue', color: '#dc2626' },
  { value: 'na', label: 'N/A', color: '#64748b' },
];

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function statusMeta(value: string) {
  return STATUSES.find((s) => s.value === value) ?? STATUSES[2];
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
