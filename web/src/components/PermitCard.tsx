import { useEffect, useState } from 'react'
import { savePermitMail, sendPermitMail } from '../api'
import { downloadPermitPng, permitPngBase64 } from '../permitPng'
import { useQr } from '../qr'
import type { PermitPublic } from '../types'

const mailStarted = new Set<string>()

export function PermitCard({ permit, saveForEmail = false }: { permit: PermitPublic; saveForEmail?: boolean }) {
  const link = `${window.location.origin}/p/${permit.code}`
  const qr = useQr(link)
  const [mailNote, setMailNote] = useState('')
  const extras = [
    permit.spot ? `Spot ${permit.spot}` : '',
    permit.apartment ? `Apt ${permit.apartment}` : '',
  ].filter(Boolean)

  useEffect(() => {
    if (!saveForEmail || !qr || mailStarted.has(permit.code)) return
    mailStarted.add(permit.code)
    let cancel = false
    setMailNote('Saving an email copy…')
    permitPngBase64(permit, qr)
      .then((image) => savePermitMail(permit.code, image))
      .then(() => {
        if (!cancel) setMailNote('Sending…')
        return sendPermitMail(permit.code)
      })
      .then(() => {
        if (!cancel) setMailNote('Sent.')
      })
      .catch((reason: unknown) => {
        mailStarted.delete(permit.code)
        if (!cancel) setMailNote(reason instanceof Error ? reason.message : 'Could not send the permit email')
      })
    return () => { cancel = true }
  }, [saveForEmail, qr, permit])

  return (
    <div className="permit-wrap">
      <article className="permit-card">
        <p className="eyebrow">Parking permit</p>
        <h2>{permit.event_name}</h2>
        <p className="code">{permit.code}</p>
        <p className="who">{permit.first_name} {permit.last_name}</p>
        <p className="car">{permit.color} {permit.year} {permit.make} {permit.model}</p>
        <p className="plate">{permit.plate} <span>{permit.state}</span></p>
        {extras.length > 0 && <p className="meta">{extras.join(' · ')}</p>}
        {qr && <img className="qr" src={qr} alt="" />}
      </article>
      {saveForEmail && mailNote && (
        <p className={`no-print ${mailNote.startsWith('Sent from') ? 'notice' : mailNote.startsWith('Saving') || mailNote.startsWith('Sending') ? 'lede' : 'error'}`} role={mailNote.startsWith('Saving') || mailNote.startsWith('Sending') || mailNote.startsWith('Sent from') ? undefined : 'alert'}>
          {mailNote}
        </p>
      )}
      <div className="permit-actions no-print">
        <button type="button" onClick={() => window.print()}>Print</button>
        <button
          type="button"
          className="secondary"
          disabled={!qr}
          onClick={() => { if (qr) void downloadPermitPng(permit, qr) }}
        >
          Save image
        </button>
      </div>
    </div>
  )
}
