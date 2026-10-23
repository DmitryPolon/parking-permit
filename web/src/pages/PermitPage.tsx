import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPermit } from '../api'
import { PermitCard } from '../components/PermitCard'
import { TopBar } from '../components/TopBar'
import type { PermitPublic } from '../types'

export function PermitPage() {
  const { code = '' } = useParams()
  const [permit, setPermit] = useState<PermitPublic | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    document.body.classList.add('print-card')
    return () => document.body.classList.remove('print-card')
  }, [])

  useEffect(() => {
    let cancel = false
    getPermit(code)
      .then((loaded) => {
        if (cancel) return
        setPermit(loaded)
        setMissing(!loaded)
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : 'Could not open this permit')
      })
    return () => { cancel = true }
  }, [code])

  return (
    <>
      <TopBar />
      <main className="sheet">
        {error && <p className="error" role="alert">{error}</p>}
        {missing && (
          <>
            <h1>No permit with that code</h1>
            <p><Link to="/">Back</Link></p>
          </>
        )}
        {permit && (
          <>
            <p className="lede no-print">Show this permit at the lot. Print it or save the image.</p>
            <PermitCard permit={permit} saveForEmail />
          </>
        )}
      </main>
    </>
  )
}
