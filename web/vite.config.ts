import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function permitMail(): Plugin {
  const runMail = (script: string, args: string[], res: import('node:http').ServerResponse) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-Sta',
      '-File',
      path.join(root, 'scripts', script),
      ...args,
    ], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('close', (status) => {
      res.setHeader('Content-Type', 'application/json')
      if (status !== 0) {
        res.statusCode = 502
        const message = stderr.trim() || stdout.trim() || 'Could not send the email'
        res.end(JSON.stringify({ message }))
        return
      }
      res.end(stdout.trim() || '{"sent":true}')
    })
  }

  return {
    name: 'permit-mail',
    configureServer(server) {
      server.middlewares.use('/mail/send', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          let code = ''
          try {
            code = String(JSON.parse(Buffer.concat(chunks).toString('utf8')).code ?? '')
          } catch {
            code = ''
          }
          if (!/^[A-Za-z0-9]{3}-[A-Za-z0-9]{4}$/.test(code)) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ message: 'Permit code is not valid' }))
            return
          }
          runMail('send-permit-mail.ps1', ['-Code', code], res)
        })
      })
      server.middlewares.use('/mail/invite', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          let body: { to?: string; tenant?: string; link?: string; password?: string } = {}
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            body = {}
          }
          const to = String(body.to ?? '')
          const tenant = String(body.tenant ?? '')
          const link = String(body.link ?? '')
          const password = String(body.password ?? '')
          const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)
            && tenant.length >= 1 && tenant.length <= 80 && !/[\r\n]/.test(tenant)
            && /^https?:\/\/[^/\s]+\/admin$/.test(link)
            && (password === '' || /^[A-Za-z0-9]{8,32}$/.test(password))
          if (!valid) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ message: 'Invite details are not valid' }))
            return
          }
          runMail('send-invite.ps1', ['-To', to, '-Tenant', tenant, '-Link', link, '-Password', password], res)
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), permitMail()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/rest': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rest/, ''),
      },
    },
  },
})
