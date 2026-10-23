import { Route, Routes } from 'react-router-dom'
import { AdminPage } from './pages/AdminPage'
import { GuestForm } from './pages/GuestForm'
import { Home } from './pages/Home'
import { PermitPage } from './pages/PermitPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/e/:eventId" element={<GuestForm />} />
      <Route path="/p/:code" element={<PermitPage />} />
    </Routes>
  )
}
