export type EventSchedule = {
  id: string
  name: string
  show_spot: boolean
  show_apartment: boolean
  starts_on: string | null
  ends_on: string | null
}

export type PublicEvent = EventSchedule & {
  open: boolean
}

export type EventRow = EventSchedule & {
  active: boolean
  created_at: string
}

export type PermitPublic = {
  code: string
  event_name: string
  first_name: string
  last_name: string
  color: string
  make: string
  model: string
  year: number
  plate: string
  state: string
  spot: string | null
  apartment: string | null
}

export type PermitAdmin = {
  id: string
  event_id: string
  code: string
  first_name: string
  last_name: string
  email: string
  phone: string
  spot: string | null
  apartment: string | null
  make: string
  model: string
  year: number
  color: string
  plate: string
  state: string
  created_at: string
}

export type PermitInput = {
  eventId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  spot: string
  apartment: string
  make: string
  model: string
  year: string
  color: string
  plate: string
  state: string
}
