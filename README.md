# Parking permit

A guest opens a lot from its QR code, fills in the form, and gets a permit. An admin signs in to manage lots and look up permits.

Copy `.env.example` to `.env` and fill in the database and mail settings. `.env` and `postgrest/postgrest.conf` stay off this repo.

The web app is in `web/`. Run `npm install`, then `npm run dev`. It serves http://localhost:5173/ and proxies `/rest` to PostgREST on port 3000.
