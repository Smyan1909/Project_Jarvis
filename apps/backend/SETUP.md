# Backend Local Setup

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (with Docker Compose)
- [pnpm](https://pnpm.io/installation)

## Getting Started

### 1. Start Infrastructure Services

```bash
cd apps/backend
docker compose up -d
```

### 2. Verify Services

Check that containers are running:
```bash
docker compose ps
```

Verify pgvector extension:
```bash
docker exec -it $(docker compose ps -q postgres) psql -U jarvis -d jarvis -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Test Redis:
```bash
docker exec -it $(docker compose ps -q redis) redis-cli ping
# Should return: PONG
```

## Service Endpoints

| Service  | URL                                    |
|----------|----------------------------------------|
| Postgres | `postgresql://jarvis:jarvis_dev@localhost:5433/jarvis` |
| Redis    | `redis://localhost:6380`               |

## Stopping Services

```bash
docker compose down      # Stop containers
docker compose down -v   # Stop and remove volumes (reset data)
```
