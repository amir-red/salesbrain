export function relativeTime(date: Date | string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function dueLabel(date: Date | string): string {
  const now = new Date();
  const due = new Date(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffDays = Math.floor((dueDay.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) return 'Overdue';
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return 'This week';
  return 'Later';
}

/** A time in the future, said plainly: "in 5 min", "in 3h", "in 2d"; a past time falls back to relativeTime. */
export function timeUntil(date: Date | string): string {
  const diffMin = Math.round((new Date(date).getTime() - Date.now()) / 60000);
  if (diffMin <= 0) return relativeTime(date);
  if (diffMin < 60) return `in ${diffMin} min`;
  if (diffMin < 48 * 60) return `in ${Math.round(diffMin / 60)}h`;
  return `in ${Math.round(diffMin / 1440)}d`;
}
