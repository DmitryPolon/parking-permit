export function todayIso() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function addDays(iso: string, days: number) {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  const nextMonth = String(date.getMonth() + 1).padStart(2, '0')
  const nextDay = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`
}

export function formatDay(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function isPermanent(event: { starts_on: string | null; ends_on: string | null }) {
  return !event.starts_on && !event.ends_on
}

export function scheduleLabel(event: { starts_on: string | null; ends_on: string | null }) {
  if (!event.starts_on || !event.ends_on) return 'Permanent'
  const range = event.starts_on === event.ends_on
    ? formatDay(event.starts_on)
    : `${formatDay(event.starts_on)} – ${formatDay(event.ends_on)}`
  const today = todayIso()
  if (today > event.ends_on) return `${range} (ended)`
  if (today < event.starts_on) return `${range} (not open yet)`
  return range
}
