# Stashly

Stashly is a React/Vite cloud-drive client and an Express API backed by Neon
PostgreSQL and an S3-compatible object store.

## Local development

1. Install dependencies with `npm install` in both `server` and `client`.
2. Copy `server/.env.example` to `server/.env`, then set the database URL, a
   random JWT secret of at least 32 bytes, allowed browser origins, and private
   S3 bucket settings. AWS access keys are optional when the server runs with an
   IAM role; if used, configure both keys.
3. Copy `client/.env.example` to `client/.env` and set `VITE_BASE_URL` to the
   API origin. The default empty base URL uses the same origin and is suitable
   when a reverse proxy serves the API under `/api`.
4. Start the API with `npm run dev` in `server` and the client with `npm run dev`
   in `client`.

The API requires `ORIGINS` as a comma-separated list of exact browser origins
(without trailing slashes). `MAX_FILE_SIZE` and `MAX_STORAGE_PER_USER` are byte
counts. Never commit `.env` files.

## Checks

- Client: `npm run lint` and `npm run build` in `client`.
- Server: `npm test` in `server`.

## Before production

- Use HTTPS for the client and API; set `NODE_ENV=production` and configure
  `ORIGINS` to the deployed client origin(s).
- Keep the object bucket private, configure its CORS rules for signed browser
  downloads, and use a least-privilege IAM role or credentials.
- Configure database backups, monitoring, and an external rate limit/WAF for
  authentication and public share endpoints.
- Add account verification and password-recovery flows before accepting public
  registrations. These flows are not implemented by this app.
