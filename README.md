# Praxis

Full-stack TypeScript monorepo for building AI-powered project management tools.

📖 **Docs:** [https://www.prax.work/documentation](https://www.prax.work/documentation/getting-started)

## Tech Stack

- **API**: [tRPC](https://trpc.io) + Express + [Drizzle ORM](https://orm.drizzle.team) + PostgreSQL
- **Web**: React 19 + [Vite](https://vitejs.dev) + [TailwindCSS v4](https://tailwindcss.com)
- **Worker**: Background job processor with [pg-boss](https://github.com/timgit/pg-boss) + Claude AI
- **Auth**: [Auth0](https://auth0.com)
- **Monorepo**: pnpm workspaces + [Turborepo](https://turbo.build)

## Packages

| Package | Description |
|---------|-------------|
| `packages/api` | tRPC API server with Express, Drizzle ORM, pg-boss job queue |
| `packages/web` | React 19 SPA with Auth0, React Router, Recharts, ReactFlow |
| `packages/worker` | Background worker + CLI for AI-powered sessions |
| `packages/shared` | Shared types, schemas, and utilities (Zod) |
| `packages/hooks` | React hooks for tRPC + Auth0 integration |

## Quick Start (Local Development)

### Prerequisites

- Node.js 18+
- pnpm 9+
- Docker

### Setup

```bash
git clone https://github.com/PraxisWorks/Praxis.git
cd Praxis
pnpm setup     # checks prerequisites, configures .env, installs deps, starts Postgres, runs migrations
pnpm dev       # starts API (3001), Web (3000), and Worker in dev mode
```

The `pnpm setup` script will prompt you for Auth0 credentials. See [Configuration](#configuration) below.

## Self-Hosting (Docker)

Run the full stack with Docker Compose:

```bash
# 1. Copy and configure environment
cp envs/.example.env .env
# Edit .env with your Auth0 credentials

# 2. Start all services
docker compose -f docker-compose.full.yml up --build

# 3. Run database migrations
docker compose -f docker-compose.full.yml exec api node dist/db/migrate.js

# 4. Open http://localhost:3000
```

Services:
- **Web**: http://localhost:3000
- **API**: http://localhost:3001
- **PostgreSQL**: localhost:5432

## Worker CLI

Install the worker CLI globally to connect external machines as AI session runners:

```bash
npm install -g @praxwork/cli
praxis login    # configure connection
praxis start    # start processing jobs
```

## Configuration

Copy `envs/.example.env` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `AUTH0_ISSUER_BASE_URL` | Yes | Auth0 issuer URL (`https://your-tenant.us.auth0.com/`) |
| `AUTH0_AUDIENCE` | Yes | Auth0 API audience |
| `VITE_AUTH0_DOMAIN` | Yes | Auth0 domain for frontend |
| `VITE_AUTH0_CLIENT_ID` | Yes | Auth0 SPA client ID |
| `VITE_AUTH0_AUDIENCE` | Yes | Auth0 audience for frontend |
| `ANTHROPIC_API_KEY` | No | Anthropic API key for AI worker sessions |

## Available Commands

```bash
# Development
pnpm dev              # Start all packages in dev mode
pnpm build            # Production build
pnpm test             # Run tests
pnpm typecheck        # TypeScript type checking

# Database
pnpm db:generate      # Generate Drizzle migrations
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Drizzle Studio (DB browser)
pnpm db:seed          # Seed sample data

# Docker
pnpm docker:up        # Start PostgreSQL
pnpm docker:down      # Stop PostgreSQL
pnpm docker:reset     # Reset PostgreSQL (destructive)
pnpm docker:init      # Start PostgreSQL + generate + migrate

# Worker
pnpm worker:dev       # Start worker in dev mode
pnpm worker:start     # Start worker in production mode
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes and add tests
4. Run `pnpm build && pnpm typecheck && pnpm test`
5. Open a Pull Request

## License

[MIT](LICENSE)
