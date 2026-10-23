import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import pg from 'pg'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.join(root, 'web', 'dist')
const port = Number(process.env.PORT || 8080)
const postgrestPort = Number(process.env.PGRST_SERVER_PORT || 3000)

function startPostgrest() {
  const child = spawn('postgrest', [], {
    env: {
      ...process.env,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(postgrestPort),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  child.on('exit', (code) => {
    console.error(`PostgREST stopped (${code ?? 'unknown'})`)
    process.exit(1)
  })
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function mailer() {
  const host = process.env.MAIL_HOST || ''
  const user = process.env.MAIL_USER || ''
  const pass = process.env.MAIL_PASSWORD || ''
  const from = process.env.MAIL_FROM || ''
  if (!host || !user || !pass || !from) {
    throw new Error('Set MAIL_HOST, MAIL_USER, MAIL_PASSWORD, and MAIL_FROM to send mail')
  }
  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port: Number(process.env.MAIL_PORT || 587),
      secure: false,
      auth: { user, pass },
    }),
  }
}

async function sendPermit(code) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  try {
    const found = await client.query(
      `SELECT m.email, m.sent_at IS NOT NULL AS sent, m.image,
              e.name AS event, p.first_name || ' ' || p.last_name AS name, p.code
       FROM permit_mail m
       JOIN permits p ON p.id = m.permit_id
       JOIN events e ON e.id = p.event_id
       WHERE p.code = $1`,
      [code],
    )
    const row = found.rows[0]
    if (!row) throw new Error('No email copy is saved for this permit')
    if (row.sent) return { sent: true, already: true }
    const { from, transport } = mailer()
    await transport.sendMail({
      from,
      to: row.email,
      subject: `Parking permit ${row.code}`,
      text: `${row.name}, your parking permit for ${row.event} is attached.\n\nCode: ${row.code}`,
      attachments: [{ filename: `${row.code}.png`, content: row.image, contentType: 'image/png' }],
    })
    await client.query(
      `UPDATE permit_mail m SET sent_at = now()
       FROM permits p
       WHERE p.id = m.permit_id AND p.code = $1 AND m.sent_at IS NULL`,
      [code],
    )
    return { sent: true, already: false }
  } finally {
    await client.end()
  }
}

async function sendInvite({ to, tenant, link, password }) {
  const { from, transport } = mailer()
  const text = password
    ? `You can manage parking permits for ${tenant}.\n\nSign in: ${link}\nEmail: ${to}\n\nTemporary password:\n${password}\n\nChange this password after you sign in.`
    : `You can manage parking permits for ${tenant}.\n\nSign in: ${link}\nEmail: ${to}\n\nUse the password you already have.`
  await transport.sendMail({
    from,
    to,
    subject: `You are invited to ${tenant}`,
    text,
  })
  return { sent: true }
}

function proxyRest(req, res) {
  const target = new URL(req.url.replace(/^\/rest/, '') || '/', `http://127.0.0.1:${postgrestPort}`)
  const headers = { ...req.headers, host: target.host }
  const proxy = http.request(target, { method: req.method, headers }, (upstream) => {
    res.writeHead(upstream.statusCode ?? 502, upstream.headers)
    upstream.pipe(res)
  })
  proxy.on('error', () => sendJson(res, 502, { message: 'The database API is not ready' }))
  req.pipe(proxy)
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost')
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  const file = path.normalize(path.join(webRoot, requested))
  const inside = file.startsWith(webRoot)
  const target = inside && fs.existsSync(file) && fs.statSync(file).isFile()
    ? file
    : path.join(webRoot, 'index.html')
  const type = target.endsWith('.js') ? 'text/javascript'
    : target.endsWith('.css') ? 'text/css'
    : target.endsWith('.svg') ? 'image/svg+xml'
    : target.endsWith('.png') ? 'image/png'
    : 'text/html'
  res.writeHead(200, { 'Content-Type': type })
  fs.createReadStream(target).pipe(res)
}

startPostgrest()

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendJson(res, 400, { message: 'Request is not valid' })
      return
    }
    if (req.url.startsWith('/rest')) {
      proxyRest(req, res)
      return
    }
    if (req.method === 'POST' && req.url.startsWith('/mail/send')) {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
      const code = String(body.code ?? '')
      if (!/^[A-Za-z0-9]{3}-[A-Za-z0-9]{4}$/.test(code)) {
        sendJson(res, 400, { message: 'Permit code is not valid' })
        return
      }
      sendJson(res, 200, await sendPermit(code))
      return
    }
    if (req.method === 'POST' && req.url.startsWith('/mail/invite')) {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
      const to = String(body.to ?? '')
      const tenant = String(body.tenant ?? '')
      const link = String(body.link ?? '')
      const password = String(body.password ?? '')
      const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)
        && tenant.length >= 1 && tenant.length <= 80 && !/[\r\n]/.test(tenant)
        && /^https?:\/\/[^/\s]+\/admin$/.test(link)
        && (password === '' || /^[A-Za-z0-9]{8,32}$/.test(password))
      if (!valid) {
        sendJson(res, 400, { message: 'Invite details are not valid' })
        return
      }
      sendJson(res, 200, await sendInvite({ to, tenant, link, password }))
      return
    }
    if (req.method === 'GET') {
      serveStatic(req, res)
      return
    }
    sendJson(res, 405, { message: 'That action is not available' })
  } catch (error) {
    sendJson(res, 502, { message: error instanceof Error ? error.message : 'Could not finish the request' })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Parking permit listening on ${port}`)
})
