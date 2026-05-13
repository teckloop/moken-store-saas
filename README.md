# Moken Store SaaS

Independent ecommerce SaaS foundation with optional integration to the Moken platform.

## Stack

- React + Vite for the storefront/admin UI
- Node.js + Express for the API
- SQLite for the first database stage
- Domain-based tenant resolution for separate storefront domains

## Run

```bash
npm install
npm run dev
```

API: `http://localhost:4100`

Edge router: `http://localhost:5173`

Landing web: `http://localhost:5177`

Company admin: `http://localhost:5174`

Store admin: `http://localhost:5175`

Storefront: `http://localhost:5176`

## Public Hostnames

When Cloudflare Tunnel uses one shared local service, point public hostnames to the edge router:

| Hostname | Local service |
| --- | --- |
| `moken-saas.online` | `http://localhost:5173` |
| `www.moken-saas.online` | `http://localhost:5173` |
| `company.moken-saas.online` | `http://localhost:5173` |
| `merchant.moken-saas.online` | `http://localhost:5173` |
| `store.moken-saas.online` | `http://localhost:5173` |
| `api.moken-saas.online` | `http://localhost:4100` |

The edge router then sends each hostname to the correct isolated app:

| App | Port |
| --- | --- |
| Landing web | `5177` |
| Company admin | `5174` |
| Store admin | `5175` |
| Storefront | `5176` |

## Tenant Resolution

The API resolves the current store using:

1. `x-store-domain` header
2. request hostname
3. fallback seed tenant `demo.localhost`

This keeps the project ready for custom domains per store without tying tenants to separate codebases.
