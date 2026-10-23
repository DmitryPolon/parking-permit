import type { PermitPublic } from './types'

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, family: string, weight: string) {
  let size = startSize
  ctx.font = `${weight} ${size}px ${family}`
  while (size > 22 && ctx.measureText(text).width > maxWidth) {
    size -= 2
    ctx.font = `${weight} ${size}px ${family}`
  }
}

export async function renderPermitPng(permit: PermitPublic, qrDataUrl: string) {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = 1012
  canvas.height = 638
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not draw the permit')

  ctx.fillStyle = '#fffdf8'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#0c6b52'
  ctx.fillRect(0, 0, 22, canvas.height)
  ctx.fillStyle = '#1a1916'

  const ui = 'Outfit, Segoe UI, sans-serif'
  const display = 'Fraunces, Georgia, serif'
  fit(ctx, 'PARKING PERMIT', 680, 26, ui, '600')
  ctx.fillText('PARKING PERMIT', 56, 78)
  fit(ctx, permit.event_name, 680, 40, display, '700')
  ctx.fillText(permit.event_name, 56, 136)
  fit(ctx, permit.code, 680, 84, display, '700')
  ctx.fillText(permit.code, 56, 250)
  fit(ctx, `${permit.first_name} ${permit.last_name}`, 680, 36, ui, '600')
  ctx.fillText(`${permit.first_name} ${permit.last_name}`, 56, 330)
  fit(ctx, `${permit.color} ${permit.year} ${permit.make} ${permit.model}`, 680, 30, ui, '500')
  ctx.fillText(`${permit.color} ${permit.year} ${permit.make} ${permit.model}`, 56, 390)
  fit(ctx, `${permit.plate}   ${permit.state}`, 680, 42, ui, '700')
  ctx.fillText(`${permit.plate}   ${permit.state}`, 56, 470)

  const extras = [
    permit.spot ? `Spot ${permit.spot}` : '',
    permit.apartment ? `Apt ${permit.apartment}` : '',
  ].filter(Boolean).join('    ')
  fit(ctx, extras, 680, 28, ui, '500')
  ctx.fillText(extras, 56, 540)

  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Could not draw the QR code'))
    image.src = qrDataUrl
  })
  ctx.drawImage(image, 748, 390, 210, 210)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value)
      else reject(new Error('Could not draw the permit'))
    }, 'image/png')
  })
  return blob
}

export async function permitPngBase64(permit: PermitPublic, qrDataUrl: string) {
  const blob = await renderPermitPng(permit, qrDataUrl)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the permit image'))
    reader.readAsDataURL(blob)
  })
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

export async function downloadPermitPng(permit: PermitPublic, qrDataUrl: string) {
  const blob = await renderPermitPng(permit, qrDataUrl)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `permit-${permit.code}.png`
  link.click()
  URL.revokeObjectURL(link.href)
}
