import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

export function useQr(text: string) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let cancel = false
    QRCode.toDataURL(text, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then((value) => {
        if (!cancel) setUrl(value)
      })
      .catch(() => {
        if (!cancel) setUrl('')
      })
    return () => {
      cancel = true
    }
  }, [text])

  return url
}
