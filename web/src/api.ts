import type { EventRow, PermitAdmin, PermitInput, PermitPublic, PublicEvent } from './types'

const API = import.meta.env.VITE_API_URL ?? '/rest'

async function send<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API}${path}`, { ...init, headers })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function one<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new Error('Nothing came back')
  return row
}

export function login(email: string, password: string) {
  return send<string>('/rpc/admin_login', {
    method: 'POST',
    body: JSON.stringify({ p_email: email, p_password: password }),
  })
}

export function emailFromToken(token: string) {
  try {
    const payload = token.split('.')[1] ?? ''
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { email?: string }
    return json.email ?? ''
  } catch {
    return ''
  }
}

export type AdminProfile = {
  email: string
  is_super: boolean
}

export function whoami(token: string) {
  return send<AdminProfile>('/rpc/whoami', { method: 'POST', body: '{}' }, token)
}

export function changePassword(token: string, currentPassword: string, newPassword: string) {
  return send<void>('/rpc/change_password', {
    method: 'POST',
    body: JSON.stringify({ p_current: currentPassword, p_new: newPassword }),
  }, token)
}

export function deleteTenant(token: string, eventId: string, password: string) {
  return send<void>('/rpc/delete_tenant', {
    method: 'POST',
    body: JSON.stringify({ p_event_id: eventId, p_password: password }),
  }, token)
}

export function listTenantAdmins(token: string, eventId: string) {
  return send<{ email: string }[]>('/rpc/list_tenant_admins', {
    method: 'POST',
    body: JSON.stringify({ p_event_id: eventId }),
  }, token)
}

export function addTenantAdmin(token: string, eventId: string, email: string) {
  return send<{ email: string; temporary_password: string | null }>('/rpc/add_tenant_admin', {
    method: 'POST',
    body: JSON.stringify({ p_event_id: eventId, p_email: email, p_password: '' }),
  }, token)
}

export async function sendInvite(input: { to: string; tenant: string; link: string; password: string | null }) {
  const response = await fetch('/mail/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: input.to,
      tenant: input.tenant,
      link: input.link,
      password: input.password ?? '',
    }),
  })
  const body = await response.json().catch(() => null) as { message?: string } | null
  if (!response.ok) throw new Error(body?.message || 'Could not send the invite')
}

export function removeTenantAdmin(token: string, eventId: string, email: string) {
  return send<void>('/rpc/remove_tenant_admin', {
    method: 'POST',
    body: JSON.stringify({ p_event_id: eventId, p_email: email }),
  }, token)
}

export async function getPublicEvent(eventId: string) {
  const rows = await send<PublicEvent[]>(
    `/public_events?id=eq.${encodeURIComponent(eventId)}&select=id,name,show_spot,show_apartment,starts_on,ends_on,open`,
  )
  return rows[0] ?? null
}

export async function getMakes() {
  const rows = await send<{ make: string }[]>('/car_makes?select=make&order=make.asc')
  return rows.map((row) => row.make)
}

export async function getModels(make: string) {
  const rows = await send<{ model: string }[]>(
    `/car_models?select=model&make=eq.${encodeURIComponent(make)}&order=model.asc`,
  )
  return rows.map((row) => row.model)
}

export async function getYears(make: string, model: string) {
  const rows = await send<{ year: number }[]>(
    `/car_years?select=year&make=eq.${encodeURIComponent(make)}&model=eq.${encodeURIComponent(model)}&order=year.desc`,
  )
  return rows.map((row) => row.year)
}

export async function getColors() {
  const rows = await send<{ name: string }[]>('/colors?select=name&order=sort.asc')
  return rows.map((row) => row.name)
}

export async function getStates() {
  return send<{ code: string; name: string }[]>('/plate_states?select=code,name&order=name.asc')
}

export function createPermit(input: PermitInput) {
  return send<PermitPublic>('/rpc/create_permit', {
    method: 'POST',
    body: JSON.stringify({
      p_event_id: input.eventId,
      p_first_name: input.firstName,
      p_last_name: input.lastName,
      p_email: input.email,
      p_phone: input.phone,
      p_spot: input.spot,
      p_apartment: input.apartment,
      p_make: input.make,
      p_model: input.model,
      p_year: Number(input.year),
      p_color: input.color,
      p_plate: input.plate,
      p_state: input.state,
    }),
  })
}

export function savePermitMail(code: string, image: string) {
  return send<{ saved: boolean }>('/rpc/save_permit_mail', {
    method: 'POST',
    body: JSON.stringify({ p_code: code, p_image: image }),
  })
}

export async function sendPermitMail(code: string) {
  const response = await fetch('/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const body = await response.json().catch(() => null) as { message?: string; sent?: boolean } | null
  if (!response.ok) throw new Error(body?.message || 'Could not send the permit email')
  return body
}

export async function getPermit(code: string) {
  const permit = await send<PermitPublic | null>('/rpc/permit_by_code', {
    method: 'POST',
    body: JSON.stringify({ p_code: code }),
  })
  return permit
}

export function getEvents(token: string) {
  return send<EventRow[]>(
    '/events?select=id,name,active,show_spot,show_apartment,starts_on,ends_on,created_at&order=created_at.desc',
    {},
    token,
  )
}

export async function createEvent(token: string, name: string) {
  const rows = await send<EventRow[]>('/events', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name }),
  }, token)
  return one(rows)
}

export async function updateEvent(token: string, id: string, patch: Partial<EventRow>) {
  const rows = await send<EventRow[]>(`/events?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  }, token)
  return one(rows)
}

export function searchPermits(token: string, eventId: string, query: string) {
  const filters = [`event_id=eq.${encodeURIComponent(eventId)}`]
  const term = query.trim().replace(/[(),*]/g, '')
  if (term) {
    const like = encodeURIComponent(term)
    filters.push(
      `or=(first_name.ilike.*${like}*,last_name.ilike.*${like}*,email.ilike.*${like}*,plate.ilike.*${like}*,make.ilike.*${like}*,model.ilike.*${like}*,code.ilike.*${like}*)`,
    )
  }
  return send<PermitAdmin[]>(
    `/permits?select=id,event_id,code,first_name,last_name,email,phone,spot,apartment,make,model,year,color,plate,state,created_at&order=created_at.desc&limit=100&${filters.join('&')}`,
    {},
    token,
  )
}
