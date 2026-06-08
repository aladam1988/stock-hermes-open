# Security Policy

## Sensitive Files

Never commit these files or values:

- `.env`, `.env.local`, `.env.production`
- `config.yaml`, `auth.json`, `credentials.json`, `token.json`
- `*.db`, `*.sqlite*`, `*.log`
- OAuth tokens, cookies, API keys, screenshots or QR codes containing credentials

## Reporting a Vulnerability

Please open a GitHub issue without including secrets. If a report needs private details, contact the maintainer through GitHub first and share sensitive information only after a private channel is agreed.

## Design Principle

The frontend should never contain model provider credentials. API keys must stay in server-side environment variables and be used only by the backend proxy.
