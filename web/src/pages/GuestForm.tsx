import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createPermit, getColors, getMakes, getModels, getPublicEvent, getStates, getYears } from '../api'
import { TopBar } from '../components/TopBar'
import { formatDay, todayIso } from '../schedule'
import type { PublicEvent } from '../types'

const empty = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  spot: '',
  apartment: '',
  make: '',
  model: '',
  year: '',
  color: '',
  plate: '',
  state: '',
}

export function GuestForm() {
  const { eventId = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<PublicEvent | null>(null)
  const [missing, setMissing] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [makes, setMakes] = useState<string[]>([])
  const [models, setModels] = useState<string[]>([])
  const [years, setYears] = useState<number[]>([])
  const [colors, setColors] = useState<string[]>([])
  const [states, setStates] = useState<{ code: string; name: string }[]>([])
  const [form, setForm] = useState(empty)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancel = false
    Promise.all([getPublicEvent(eventId), getMakes(), getColors(), getStates()])
      .then(([loadedEvent, makeRows, colorRows, stateRows]) => {
        if (cancel) return
        setEvent(loadedEvent)
        setMissing(!loadedEvent)
        setLoaded(true)
        setMakes(makeRows)
        setColors(colorRows)
        setStates(stateRows)
      })
      .catch((reason: unknown) => {
        if (cancel) return
        setLoaded(true)
        setError(reason instanceof Error ? reason.message : 'Could not open this form')
      })
    return () => {
      cancel = true
    }
  }, [eventId])

  useEffect(() => {
    if (!form.make) {
      setModels([])
      return
    }
    let cancel = false
    getModels(form.make)
      .then((rows) => { if (!cancel) setModels(rows) })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : 'Could not load models')
      })
    return () => { cancel = true }
  }, [form.make])

  useEffect(() => {
    if (!form.make || !form.model) {
      setYears([])
      return
    }
    let cancel = false
    getYears(form.make, form.model)
      .then((rows) => { if (!cancel) setYears(rows) })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : 'Could not load years')
      })
    return () => { cancel = true }
  }, [form.make, form.model])

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function onSubmit(eventSubmit: FormEvent) {
    eventSubmit.preventDefault()
    setBusy(true)
    setError('')
    try {
      const permit = await createPermit({ ...form, eventId })
      navigate(`/p/${permit.code}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the permit')
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <>
        <TopBar />
        <main className="sheet">
          <h1>Parking permit</h1>
        </main>
      </>
    )
  }

  if (error && !event) {
    return (
      <>
        <TopBar />
        <main className="sheet">
          <h1>Parking permit</h1>
          <p className="error" role="alert">{error}</p>
        </main>
      </>
    )
  }

  if (missing || (event && !event.open)) {
    const upcoming = event?.starts_on && todayIso() < event.starts_on
    const closed = event && !event.open
      ? upcoming
        ? `This link opens on ${formatDay(event.starts_on!)}.`
        : `This link ended on ${formatDay(event.ends_on!)}.`
      : 'This parking link is not open'
    return (
      <>
        <TopBar />
        <main className="sheet">
          <h1>{event?.name ?? 'Parking permit'}</h1>
          <p>{closed}</p>
          <p><Link to="/">Back</Link></p>
        </main>
      </>
    )
  }

  return (
    <>
      <TopBar />
      <main className="sheet">
        <h1>{event?.name ?? 'Parking permit'}</h1>
        <p className="lede">Fill this in once. The permit code comes back on the next screen.</p>
        <form className="stack" onSubmit={onSubmit}>
          <label>First name
            <input value={form.firstName} autoComplete="given-name" onChange={(e) => set('firstName', e.target.value)} required />
          </label>
          <label>Last name
            <input value={form.lastName} autoComplete="family-name" onChange={(e) => set('lastName', e.target.value)} required />
          </label>
          <label>Email
            <input type="email" value={form.email} autoComplete="email" onChange={(e) => set('email', e.target.value)} required />
          </label>
          <label>Phone
            <input type="tel" value={form.phone} autoComplete="tel" onChange={(e) => set('phone', e.target.value)} required />
          </label>
          {event?.show_spot && (
            <label>Parking spot
              <input value={form.spot} onChange={(e) => set('spot', e.target.value)} required />
            </label>
          )}
          {event?.show_apartment && (
            <label>Apartment number
              <input value={form.apartment} onChange={(e) => set('apartment', e.target.value)} required />
            </label>
          )}
          <label>Make
            <select
              value={form.make}
              required
              onChange={(e) => {
                setForm((current) => ({ ...current, make: e.target.value, model: '', year: '' }))
              }}
            >
              <option value="">Select a make</option>
              {makes.map((make) => <option key={make}>{make}</option>)}
            </select>
          </label>
          <label>Model
            <select
              value={form.model}
              required
              disabled={!form.make}
              onChange={(e) => {
                setForm((current) => ({ ...current, model: e.target.value, year: '' }))
              }}
            >
              <option value="">Select a model</option>
              {models.map((model) => <option key={model}>{model}</option>)}
            </select>
          </label>
          <label>Year
            <select value={form.year} required disabled={!form.model} onChange={(e) => set('year', e.target.value)}>
              <option value="">Select a year</option>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <label>Color
            <select value={form.color} required onChange={(e) => set('color', e.target.value)}>
              <option value="">Select a color</option>
              {colors.map((color) => <option key={color}>{color}</option>)}
            </select>
          </label>
          <label>License plate
            <input value={form.plate} autoCapitalize="characters" onChange={(e) => set('plate', e.target.value)} required />
          </label>
          <label>State
            <select value={form.state} required onChange={(e) => set('state', e.target.value)}>
              <option value="">Select a state</option>
              {states.map((state) => <option key={state.code} value={state.code}>{state.name}</option>)}
            </select>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" disabled={busy || !event}>{busy ? 'Saving…' : 'Get permit'}</button>
        </form>
      </main>
    </>
  )
}
