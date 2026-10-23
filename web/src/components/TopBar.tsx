import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function TopBar({ action }: { action?: ReactNode }) {
  return (
    <header className="topbar">
      <Link to="/">Parking permit</Link>
      {action}
    </header>
  )
}
