import { Link } from 'react-router-dom'
import { TopBar } from '../components/TopBar'

const sampleId = '11111111-1111-4111-8111-111111111111'

export function Home() {
  return (
    <>
      <TopBar action={<Link to="/admin">Admin</Link>} />
      <main className="sheet">
        <h1>Scan the lot QR code</h1>
        <p className="lede">
          The code at the entrance opens the permit form for that event. After you save, the permit stays on this phone.
        </p>
        <p>
          <Link className="button" to={`/e/${sampleId}`}>Open the sample lot</Link>
        </p>
      </main>
    </>
  )
}
