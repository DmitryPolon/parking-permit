import { FormEvent, useEffect, useRef, useState } from 'react'
import { addTenantAdmin, changePassword, createEvent, deleteTenant, emailFromToken, getEvents, listTenantAdmins, login, removeTenantAdmin, searchPermits, sendInvite, updateEvent, whoami } from '../api'
import { PermitCard } from '../components/PermitCard'
import { TopBar } from '../components/TopBar'
import { useQr } from '../qr'
import { addDays, isPermanent, scheduleLabel, todayIso } from '../schedule'
import type { EventRow, PermitAdmin, PermitPublic } from '../types'

const tokenKey = 'permit_admin_jwt'

function EventQrTile({ event }: { event: EventRow }) {
  const url = `${window.location.origin}/e/${event.id}`
  const qr = useQr(url)
  return (
    <article className="qr-tile">
      {qr && <img src={qr} alt={`QR code for ${event.name}`} />}
      <h3>{event.name}</h3>
      <p>{scheduleLabel(event)}</p>
      <p>{url}</p>
    </article>
  )
}

function ContactDialog({ permit, onClose }: { permit: PermitAdmin; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const onCancel = (event: Event) => {
      event.preventDefault()
      onCloseRef.current()
    }
    dialog.addEventListener('cancel', onCancel)
    dialog.showModal()
    return () => {
      dialog.removeEventListener('cancel', onCancel)
      dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      className="contact-dialog"
      aria-labelledby="contact-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="contact-card">
        <h2 id="contact-title">{permit.first_name} {permit.last_name}</h2>
        <p><a href={`mailto:${permit.email}`}>{permit.email}</a></p>
        <p><a href={`tel:${permit.phone}`}>{permit.phone}</a></p>
        {permit.apartment && <p>Apartment {permit.apartment}</p>}
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>
    </dialog>
  )
}

function toPublic(permit: PermitAdmin, eventName: string): PermitPublic {
  return {
    code: permit.code,
    event_name: eventName,
    first_name: permit.first_name,
    last_name: permit.last_name,
    color: permit.color,
    make: permit.make,
    model: permit.model,
    year: permit.year,
    plate: permit.plate,
    state: permit.state,
    spot: permit.spot,
    apartment: permit.apartment,
  }
}

export function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey) ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [events, setEvents] = useState<EventRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [eventName, setEventName] = useState('')
  const [query, setQuery] = useState('')
  const [permits, setPermits] = useState<PermitAdmin[]>([])
  const [picked, setPicked] = useState<PermitAdmin | null>(null)
  const [contact, setContact] = useState<PermitAdmin | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'events' | 'qrs' | 'password'>('events')
  const [isSuper, setIsSuper] = useState(false)
  const [tenantAdmins, setTenantAdmins] = useState<{ email: string }[]>([])
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const signedInEmail = emailFromToken(token)

  const selected = events.find((event) => event.id === selectedId) ?? null
  const eventUrl = selected ? `${window.location.origin}/e/${selected.id}` : ''
  const qr = useQr(eventUrl)

  useEffect(() => {
    if (!token) return
    let cancel = false
    whoami(token)
      .then((profile) => { if (!cancel) setIsSuper(profile.is_super) })
      .catch(() => { if (!cancel) setIsSuper(false) })
    getEvents(token)
      .then((rows) => {
        if (cancel) return
        setEvents(rows)
        setSelectedId((current) => current ?? rows[0]?.id ?? null)
      })
      .catch(() => {
        if (cancel) return
        sessionStorage.removeItem(tokenKey)
        setToken('')
      })
    return () => { cancel = true }
  }, [token])

  useEffect(() => {
    if (!token || !selectedId) return
    let cancel = false
    const handle = window.setTimeout(() => {
      searchPermits(token, selectedId, query)
        .then((rows) => { if (!cancel) setPermits(rows) })
        .catch((reason: unknown) => {
          if (!cancel) setError(reason instanceof Error ? reason.message : 'Could not search permits')
        })
    }, 200)
    return () => {
      cancel = true
      window.clearTimeout(handle)
    }
  }, [token, selectedId, query])

  useEffect(() => {
    if (!token || !selectedId) return
    let cancel = false
    listTenantAdmins(token, selectedId)
      .then((rows) => { if (!cancel) setTenantAdmins(rows) })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : 'Could not load tenant admins')
      })
    return () => { cancel = true }
  }, [token, selectedId])

  async function onLogin(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const next = await login(email.trim(), password.trim())
      sessionStorage.setItem(tokenKey, next)
      setToken(next)
      setPassword('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const created = await createEvent(token, eventName.trim())
      setEvents((current) => [created, ...current])
      setSelectedId(created.id)
      setEventName('')
      setQuery('')
      setPicked(null)
      if (inviteEmail.trim()) {
        await inviteAdmin(created.id, created.name, inviteEmail.trim())
        setInviteEmail('')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the tenant')
    } finally {
      setBusy(false)
    }
  }

  async function setPermanent(permanent: boolean) {
    if (!selected) return
    if (permanent) {
      await patch({ starts_on: null, ends_on: null })
      return
    }
    const start = todayIso()
    await patch({ starts_on: start, ends_on: addDays(start, 2) })
  }

  async function setStarts(value: string) {
    if (!selected?.ends_on || !value) return
    const end = value > selected.ends_on ? value : selected.ends_on
    await patch({ starts_on: value, ends_on: end })
  }

  async function setEnds(value: string) {
    if (!selected?.starts_on || !value) return
    const start = value < selected.starts_on ? value : selected.starts_on
    await patch({ starts_on: start, ends_on: value })
  }

  async function patch(partial: Partial<EventRow>) {
    if (!selected) return
    setError('')
    try {
      const updated = await updateEvent(token, selected.id, partial)
      setEvents((current) => current.map((event) => event.id === updated.id ? updated : event))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update the event')
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(eventUrl)
    setNotice('Link copied')
    window.setTimeout(() => setNotice(''), 1500)
  }

  async function inviteAdmin(eventId: string, tenantName: string, adminEmail: string) {
    const invited = await addTenantAdmin(token, eventId, adminEmail)
    try {
      await sendInvite({
        to: invited.email,
        tenant: tenantName,
        link: `${window.location.origin}/admin`,
        password: invited.temporary_password,
      })
      setNotice(`Invite sent to ${invited.email}`)
      window.setTimeout(() => setNotice(''), 2500)
    } catch (reason) {
      const password = invited.temporary_password
      const detail = reason instanceof Error ? reason.message : 'Could not send the invite'
      throw new Error(password
        ? `${detail} Temporary password: ${password}`
        : detail)
    }
  }

  async function onAddAdmin(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      await inviteAdmin(selected.id, selected.name, newAdminEmail.trim())
      setTenantAdmins(await listTenantAdmins(token, selected.id))
      setNewAdminEmail('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not add the admin')
    } finally {
      setBusy(false)
    }
  }

  async function onRemoveAdmin(adminEmail: string) {
    if (!selected) return
    setError('')
    try {
      await removeTenantAdmin(token, selected.id, adminEmail)
      if (adminEmail.toLowerCase() === signedInEmail.toLowerCase() && !isSuper) {
        const rows = await getEvents(token)
        setEvents(rows)
        if (!rows.some((event) => event.id === selected.id)) {
          setSelectedId(rows[0]?.id ?? null)
          setTenantAdmins([])
          return
        }
      }
      setTenantAdmins(await listTenantAdmins(token, selected.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove the admin')
    }
  }

  async function onChangePassword(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await changePassword(token, currentPassword, nextPassword)
      setCurrentPassword('')
      setNextPassword('')
      setNotice('Password updated')
      window.setTimeout(() => setNotice(''), 1500)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteTenant(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const removedId = selected.id
      await deleteTenant(token, removedId, deletePassword)
      setDeletePassword('')
      const remaining = events.filter((item) => item.id !== removedId)
      setEvents(remaining)
      setSelectedId(remaining[0]?.id ?? null)
      setPermits([])
      setPicked(null)
      setTenantAdmins([])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete the tenant')
    } finally {
      setBusy(false)
    }
  }

  function signOut() {
    sessionStorage.removeItem(tokenKey)
    setToken('')
    setEvents([])
    setSelectedId(null)
    setPermits([])
    setPicked(null)
    setView('events')
    setIsSuper(false)
    setTenantAdmins([])
  }

  if (!token) {
    return (
      <>
        <TopBar />
        <main className="sheet">
          <h1>Admin</h1>
          <form className="stack" onSubmit={onLogin}>
            <label>Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </main>
      </>
    )
  }

  return (
    <>
      <TopBar action={<button type="button" className="secondary" onClick={signOut}>Sign out</button>} />
      {view === 'qrs' ? (
        <main className="qr-sheet">
          <div className="sheet-bar no-print">
            <h1>Tenant QR codes</h1>
            <button type="button" onClick={() => window.print()}>Print</button>
            <button type="button" className="secondary" onClick={() => setView('events')}>Back</button>
          </div>
          <div className="qr-grid">
            {events.map((event) => <EventQrTile key={event.id} event={event} />)}
          </div>
        </main>
      ) : view === 'password' ? (
        <main className="sheet">
          <div className="sheet-bar">
            <h1>Password</h1>
            <button type="button" className="secondary" onClick={() => setView('events')}>Back</button>
          </div>
          <form className="stack" onSubmit={onChangePassword}>
            <label>Current password
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </label>
            <label>New password
              <input type="password" value={nextPassword} minLength={8} onChange={(e) => setNextPassword(e.target.value)} required />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            {notice && <p className="notice">{notice}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
          </form>
        </main>
      ) : (
      <main className="admin">
        <section className="panel">
          <h1>Tenants</h1>
          <button type="button" className="secondary" onClick={() => setView('qrs')}>Tenant QR codes</button>
          <button type="button" className="secondary" onClick={() => { setError(''); setView('password') }}>Change password</button>
          {isSuper && (
            <form className="stack" onSubmit={onCreate}>
              <label>New tenant
                <input value={eventName} onChange={(e) => setEventName(e.target.value)} required />
              </label>
              <label>Admin email
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              </label>
              <button type="submit" disabled={busy}>Create tenant</button>
            </form>
          )}
          <ul className="event-list">
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  className={event.id === selectedId ? 'secondary selected' : 'secondary'}
                  onClick={() => {
                    setSelectedId(event.id)
                    setQuery('')
                    setPicked(null)
                    setContact(null)
                  }}
                >
                  {event.name}{event.active ? '' : ' (closed)'}
                  {event.active && !isPermanent(event) ? ` · ${scheduleLabel(event)}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </section>
        {selected && (
          <section className="panel">
            <h2>{selected.name}</h2>
            {qr && <img className="event-qr" src={qr} alt={`QR code for ${selected.name}`} />}
            <p className="link-line">{eventUrl}</p>
            <button type="button" className="secondary" onClick={() => void copyLink()}>Copy link</button>
            {notice && <p className="notice">{notice}</p>}
            <label className="check">
              <input type="checkbox" checked={selected.active} onChange={(e) => void patch({ active: e.target.checked })} />
              Accepting permits
            </label>
            <label className="check">
              <input type="checkbox" checked={selected.show_spot} onChange={(e) => void patch({ show_spot: e.target.checked })} />
              Ask for parking spot
            </label>
            <label className="check">
              <input type="checkbox" checked={selected.show_apartment} onChange={(e) => void patch({ show_apartment: e.target.checked })} />
              Ask for apartment number
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={isPermanent(selected)}
                onChange={(e) => void setPermanent(e.target.checked)}
              />
              Permanent link
            </label>
            {isPermanent(selected) ? (
              <p className="lede">Stays open, like an apartment complex. Uncheck to set dates.</p>
            ) : (
              <>
                <div className="date-row">
                  <label>Starts
                    <input type="date" value={selected.starts_on ?? ''} onChange={(e) => void setStarts(e.target.value)} required />
                  </label>
                  <label>Ends
                    <input type="date" value={selected.ends_on ?? ''} onChange={(e) => void setEnds(e.target.value)} required />
                  </label>
                </div>
                <p className="lede">The guest link accepts permits on these days, then it stops. Permits already issued still open.</p>
              </>
            )}
            <h3>Admins for this tenant</h3>
            <ul className="admin-list">
              {tenantAdmins.map((admin) => (
                <li key={admin.email} className="admin-row">
                  <span>{admin.email}{admin.email === signedInEmail.toLowerCase() ? ' (you)' : ''}</span>
                  <button type="button" className="secondary" onClick={() => void onRemoveAdmin(admin.email)}>Remove</button>
                </li>
              ))}
            </ul>
            {tenantAdmins.length === 0 && <p className="lede">No tenant admins yet.</p>}
            <form className="stack" onSubmit={onAddAdmin}>
              <label>Admin email
                <input type="email" value={newAdminEmail} onChange={(e) => setNewAdminEmail(e.target.value)} required />
              </label>
              <button type="submit" disabled={busy}>Send invite</button>
            </form>
            {isSuper && (
              <form className="stack" onSubmit={onDeleteTenant}>
                <label>Delete this tenant
                  <input
                    type="password"
                    value={deletePassword}
                    placeholder="Your password"
                    onChange={(e) => setDeletePassword(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" disabled={busy}>Delete tenant</button>
              </form>
            )}
            <label>Find a permit in this tenant
              <input
                value={query}
                placeholder="Name, plate, make, or code"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Vehicle</th>
                    <th>Plate</th>
                    <th>Spot</th>
                  </tr>
                </thead>
                <tbody>
                  {permits.map((permit) => (
                    <tr key={permit.id} onClick={() => setPicked(permit)}>
                      <td>{permit.code}</td>
                      <td>
                        <button
                          type="button"
                          className="name-button"
                          onClick={(event) => {
                            event.stopPropagation()
                            setContact(permit)
                          }}
                        >
                          {permit.first_name} {permit.last_name}
                        </button>
                      </td>
                      <td>{permit.color} {permit.year} {permit.make} {permit.model}</td>
                      <td>{permit.plate} {permit.state}</td>
                      <td>{permit.spot ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {picked && <PermitCard permit={toPublic(picked, selected.name)} />}
            {contact && <ContactDialog permit={contact} onClose={() => setContact(null)} />}
          </section>
        )}
      </main>
      )}
    </>
  )
}
