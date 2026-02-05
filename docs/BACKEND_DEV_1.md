# Backend Developer 1 - Implementation Guide

## Role Overview

You are responsible for the **infrastructure layer** of Project Jarvis:
- Database setup and migrations (Postgres + pgvector + Drizzle ORM)
- Authentication system (JWT + refresh tokens)
- User secrets management (AES-256-GCM encryption)
- WebSocket server infrastructure
- Security, rate limiting, and observability

## Weekly Breakdown

---

## Week 1: Foundation

### Objectives
- Set up Postgres with pgvector extension
- Configure Drizzle ORM with migrations
- Establish config management and logging infrastructure

### Day 1-2: Docker Compose Setup

**Create `apps/backend/docker-compose.yml`:**
```yaml
version: '3.8'
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: jarvis
      POSTGRES_PASSWORD: jarvis_dev
      POSTGRES_DB: jarvis
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jarvis"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

volumes:
  pgdata:
  redisdata:
```

**Tasks:**
- [ ] Create Docker Compose file
- [ ] Verify pgvector extension loads: `CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] Document local setup in SETUP.md

### Day 2-3: Drizzle ORM Setup

**Install dependencies:**
```bash
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit @types/pg
```

**Create `apps/backend/drizzle.config.ts`:**
```typescript
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/infrastructure/db/schema.ts',
  out: './src/infrastructure/db/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

**Create `apps/backend/src/infrastructure/db/schema.ts`:**
```typescript
import { pgTable, uuid, text, timestamp, varchar, integer, jsonb, boolean, real } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Custom pgvector type
const vector = (name: string, dimensions: number) => 
  text(name).$type<number[]>();

// === User Domain ===
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: varchar('display_name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userSecrets = pgTable('user_secrets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 50 }).notNull(), // 'openai' | 'anthropic' | 'composio' | 'github' | 'custom'
  name: varchar('name', { length: 255 }).notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  iv: varchar('iv', { length: 64 }).notNull(),
  authTag: varchar('auth_tag', { length: 64 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === Agent Domain ===
export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  totalTokens: integer('total_tokens').notNull().default(0),
  totalCost: real('total_cost').notNull().default(0),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(), // 'user' | 'assistant' | 'system' | 'tool'
  content: text('content').notNull(),
  toolCallId: uuid('tool_call_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const toolCalls = pgTable('tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
  toolId: varchar('tool_id', { length: 255 }).notNull(),
  input: jsonb('input').notNull(),
  output: jsonb('output'),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'success' | 'error'
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === Memory Domain ===
export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: vector('embedding', 1536), // OpenAI text-embedding-3-small
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// === Knowledge Graph Domain ===
export const kgEntities = pgTable('kg_entities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 100 }).notNull(),
  name: varchar('name', { length: 500 }).notNull(),
  properties: jsonb('properties').default({}),
  embedding: vector('embedding', 1536),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const kgRelations = pgTable('kg_relations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id').notNull().references(() => kgEntities.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => kgEntities.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 100 }).notNull(),
  properties: jsonb('properties').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

**Tasks:**
- [ ] Install Drizzle dependencies
- [ ] Create schema file with all tables
- [ ] Run first migration: `pnpm drizzle-kit generate:pg`
- [ ] Create migration runner script

### Day 3-4: Config Management

**Create `apps/backend/src/infrastructure/config/index.ts`:**
```typescript
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  
  // Database
  DATABASE_URL: z.string().url(),
  
  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  
  // Auth
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  
  // Secrets encryption
  SECRETS_MASTER_KEY: z.string().length(64), // 32 bytes hex-encoded
  
  // LLM (optional - can use user secrets)
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }
  
  return result.data;
}

export const config = loadConfig();
```

**Create `.env.example`:**
```bash
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://jarvis:jarvis_dev@localhost:5432/jarvis

# Redis
REDIS_URL=redis://localhost:6379

# Auth (generate with: openssl rand -hex 32)
JWT_SECRET=your-32-char-minimum-secret-here-change-me
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Secrets encryption (generate with: openssl rand -hex 32)
SECRETS_MASTER_KEY=your-64-char-hex-encoded-32-byte-key-here

# LLM keys (optional - users can provide their own)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

**Tasks:**
- [ ] Install zod: `pnpm add zod`
- [ ] Create config validation
- [ ] Create `.env.example` file
- [ ] Add `.env` to `.gitignore`

### Day 4-5: Logging Infrastructure

**Create `apps/backend/src/infrastructure/logging/logger.ts`:**
```typescript
import { randomUUID } from 'crypto';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  correlationId?: string;
  userId?: string;
  runId?: string;
  [key: string]: unknown;
}

class Logger {
  private context: LogContext = {};

  child(context: LogContext): Logger {
    const child = new Logger();
    child.context = { ...this.context, ...context };
    return child;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...data,
    };
    
    // In production, send to log aggregator
    // For now, structured JSON to stdout
    console.log(JSON.stringify(entry));
  }

  debug(message: string, data?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== 'production') {
      this.log('debug', message, data);
    }
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log('warn', message, data);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>) {
    this.log('error', message, {
      ...data,
      error: error ? { message: error.message, stack: error.stack } : undefined,
    });
  }
}

export const logger = new Logger();

// Middleware to add correlation ID
export function correlationMiddleware(req: any, res: any, next: any) {
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  req.correlationId = correlationId;
  req.logger = logger.child({ correlationId });
  res.setHeader('x-correlation-id', correlationId);
  next();
}
```

**Tasks:**
- [ ] Create logger with structured output
- [ ] Create correlation ID middleware
- [ ] Test logging in development

### Files to Create This Week

```
apps/backend/
  docker-compose.yml
  drizzle.config.ts
  .env.example
  src/
    infrastructure/
      config/
        index.ts
      db/
        schema.ts
        client.ts
        migrate.ts
      logging/
        logger.ts
```

---

## Week 2: Auth & Secrets

### Objectives
- Implement JWT authentication with refresh tokens
- Build secure secrets encryption/decryption
- Create auth middleware and rate limiting

### Day 1-2: User Repository & Auth Service

**Create `apps/backend/src/adapters/storage/user-repository.ts`:**
```typescript
import { eq } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client';
import { users } from '../../infrastructure/db/schema';
import type { User } from '@project-jarvis/shared-types';

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0] || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0] || null;
  }

  async create(data: { email: string; passwordHash: string; displayName?: string }): Promise<User> {
    const result = await db.insert(users).values(data).returning();
    return result[0];
  }

  async update(id: string, data: Partial<User>): Promise<User | null> {
    const result = await db.update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return result[0] || null;
  }
}
```

**Create `apps/backend/src/application/services/auth-service.ts`:**
```typescript
import { hash, compare } from 'bcrypt';
import { sign, verify } from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import { config } from '../../infrastructure/config';
import { UserRepository } from '../../adapters/storage/user-repository';
import { RefreshTokenRepository } from '../../adapters/storage/refresh-token-repository';
import { AppError } from '../../domain/errors';

interface TokenPayload {
  userId: string;
  email: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  constructor(
    private userRepo: UserRepository,
    private refreshTokenRepo: RefreshTokenRepository
  ) {}

  async register(email: string, password: string, displayName?: string): Promise<AuthTokens> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) {
      throw new AppError('EMAIL_EXISTS', 'Email already registered', 409);
    }

    const passwordHash = await hash(password, 12);
    const user = await this.userRepo.create({ email, passwordHash, displayName });
    
    return this.generateTokens(user.id, user.email);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    const valid = await compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    return this.generateTokens(user.id, user.email);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.refreshTokenRepo.findByHash(tokenHash);
    
    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token', 401);
    }

    // Delete old token
    await this.refreshTokenRepo.delete(stored.id);

    const user = await this.userRepo.findById(stored.userId);
    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    return this.generateTokens(user.id, user.email);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.refreshTokenRepo.deleteByHash(tokenHash);
  }

  verifyAccessToken(token: string): TokenPayload {
    try {
      return verify(token, config.JWT_SECRET) as TokenPayload;
    } catch {
      throw new AppError('INVALID_TOKEN', 'Invalid or expired access token', 401);
    }
  }

  private async generateTokens(userId: string, email: string): Promise<AuthTokens> {
    const payload: TokenPayload = { userId, email };
    
    const accessToken = sign(payload, config.JWT_SECRET, {
      expiresIn: config.JWT_ACCESS_EXPIRY,
    });

    const refreshToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.parseExpiry(config.JWT_REFRESH_EXPIRY));
    
    await this.refreshTokenRepo.create({
      userId,
      tokenHash,
      expiresAt,
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 7 * 24 * 60 * 60 * 1000;
    }
  }
}
```

**Tasks:**
- [ ] Install bcrypt and jsonwebtoken: `pnpm add bcrypt jsonwebtoken && pnpm add -D @types/bcrypt @types/jsonwebtoken`
- [ ] Create UserRepository
- [ ] Create RefreshTokenRepository
- [ ] Create AuthService with register/login/refresh/logout

### Day 2-3: JWT Auth Middleware

**Create `apps/backend/src/api/middleware/auth.ts`:**
```typescript
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../../application/services/auth-service';
import { AppError } from '../../domain/errors';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

export function authMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHORIZED', 'Missing or invalid authorization header', 401);
    }

    const token = authHeader.slice(7);
    const payload = authService.verifyAccessToken(token);
    
    req.userId = payload.userId;
    req.userEmail = payload.email;
    
    next();
  };
}

export function optionalAuthMiddleware(authService: AuthService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payload = authService.verifyAccessToken(token);
        req.userId = payload.userId;
        req.userEmail = payload.email;
      } catch {
        // Ignore invalid tokens for optional auth
      }
    }
    
    next();
  };
}
```

### Day 3-4: Secrets Encryption Module

**Create `apps/backend/src/infrastructure/crypto/secrets.ts`:**
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Master key from environment (32 bytes = 64 hex chars)
const MASTER_KEY = Buffer.from(config.SECRETS_MASTER_KEY, 'hex');

if (MASTER_KEY.length !== 32) {
  throw new Error('SECRETS_MASTER_KEY must be 32 bytes (64 hex characters)');
}

export interface EncryptedSecret {
  encryptedValue: string;
  iv: string;
  authTag: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, MASTER_KEY, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encryptedValue: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

export function decryptSecret(encrypted: EncryptedSecret): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    MASTER_KEY,
    Buffer.from(encrypted.iv, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
  
  let decrypted = decipher.update(encrypted.encryptedValue, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// IMPORTANT: Never log the result of decryptSecret!
// Use this wrapper when you need to use a secret
export function withDecryptedSecret<T>(
  encrypted: EncryptedSecret,
  fn: (secret: string) => T
): T {
  const secret = decryptSecret(encrypted);
  try {
    return fn(secret);
  } finally {
    // In a real implementation, you might want to zero out the memory
    // JavaScript doesn't give us that control, but we can at least
    // ensure the secret doesn't escape this scope
  }
}
```

### Day 4-5: Secrets CRUD API

**Create `apps/backend/src/api/http/secrets-router.ts`:**
```typescript
import { Router } from 'express';
import { z } from 'zod';
import { SecretsService } from '../../application/services/secrets-service';
import { authMiddleware } from '../middleware/auth';
import { validateBody } from '../middleware/validate';

const createSecretSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'composio', 'github', 'custom']),
  name: z.string().min(1).max(255),
  value: z.string().min(1),
});

const updateSecretSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  value: z.string().min(1).optional(),
});

export function createSecretsRouter(secretsService: SecretsService) {
  const router = Router();

  // List user's secrets (without values)
  router.get('/', async (req, res) => {
    const secrets = await secretsService.listByUser(req.userId!);
    res.json({
      data: secrets.map(s => ({
        id: s.id,
        provider: s.provider,
        name: s.name,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  });

  // Create a new secret
  router.post('/', validateBody(createSecretSchema), async (req, res) => {
    const { provider, name, value } = req.body;
    const secret = await secretsService.create(req.userId!, provider, name, value);
    res.status(201).json({
      data: {
        id: secret.id,
        provider: secret.provider,
        name: secret.name,
        createdAt: secret.createdAt,
      },
    });
  });

  // Update a secret
  router.patch('/:id', validateBody(updateSecretSchema), async (req, res) => {
    const secret = await secretsService.update(req.userId!, req.params.id, req.body);
    res.json({
      data: {
        id: secret.id,
        provider: secret.provider,
        name: secret.name,
        updatedAt: secret.updatedAt,
      },
    });
  });

  // Delete a secret
  router.delete('/:id', async (req, res) => {
    await secretsService.delete(req.userId!, req.params.id);
    res.status(204).send();
  });

  return router;
}
```

**Create `apps/backend/src/application/services/secrets-service.ts`:**
```typescript
import { UserSecretRepository } from '../../adapters/storage/user-secret-repository';
import { encryptSecret, decryptSecret, EncryptedSecret } from '../../infrastructure/crypto/secrets';
import { AppError } from '../../domain/errors';
import { logger } from '../../infrastructure/logging/logger';

export class SecretsService {
  constructor(private secretRepo: UserSecretRepository) {}

  async listByUser(userId: string) {
    return this.secretRepo.findByUserId(userId);
  }

  async create(userId: string, provider: string, name: string, value: string) {
    const encrypted = encryptSecret(value);
    
    const secret = await this.secretRepo.create({
      userId,
      provider,
      name,
      encryptedValue: encrypted.encryptedValue,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });

    logger.info('Secret created', { userId, provider, secretId: secret.id });
    // NEVER log the value!
    
    return secret;
  }

  async update(userId: string, secretId: string, data: { name?: string; value?: string }) {
    const existing = await this.secretRepo.findById(secretId);
    
    if (!existing || existing.userId !== userId) {
      throw new AppError('SECRET_NOT_FOUND', 'Secret not found', 404);
    }

    const updateData: any = {};
    
    if (data.name) {
      updateData.name = data.name;
    }
    
    if (data.value) {
      const encrypted = encryptSecret(data.value);
      updateData.encryptedValue = encrypted.encryptedValue;
      updateData.iv = encrypted.iv;
      updateData.authTag = encrypted.authTag;
    }

    const updated = await this.secretRepo.update(secretId, updateData);
    
    logger.info('Secret updated', { userId, secretId });
    
    return updated;
  }

  async delete(userId: string, secretId: string) {
    const existing = await this.secretRepo.findById(secretId);
    
    if (!existing || existing.userId !== userId) {
      throw new AppError('SECRET_NOT_FOUND', 'Secret not found', 404);
    }

    await this.secretRepo.delete(secretId);
    
    logger.info('Secret deleted', { userId, secretId });
  }

  // Used internally by LLM adapters
  async getDecryptedValue(userId: string, provider: string): Promise<string | null> {
    const secret = await this.secretRepo.findByUserAndProvider(userId, provider);
    
    if (!secret) {
      return null;
    }

    return decryptSecret({
      encryptedValue: secret.encryptedValue,
      iv: secret.iv,
      authTag: secret.authTag,
    });
  }
}
```

**Tasks:**
- [ ] Create secrets encryption module
- [ ] Create SecretsService
- [ ] Create secrets API routes
- [ ] Add input validation
- [ ] Test encryption/decryption round-trip

### Files to Create This Week

```
apps/backend/src/
  adapters/storage/
    user-repository.ts
    refresh-token-repository.ts
    user-secret-repository.ts
  application/services/
    auth-service.ts
    secrets-service.ts
  api/
    http/
      auth-router.ts
      secrets-router.ts
    middleware/
      auth.ts
      validate.ts
      error-handler.ts
  infrastructure/crypto/
    secrets.ts
  domain/
    errors.ts
```

---

## Week 3: Persistence & WebSocket

### Objectives
- Create AgentRun, Message, ToolCall repositories
- Set up WebSocket server
- Implement EventStreamAdapter

### Day 1-2: Agent Run Repositories

**Create `apps/backend/src/adapters/storage/agent-run-repository.ts`:**
```typescript
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client';
import { agentRuns, messages, toolCalls } from '../../infrastructure/db/schema';

export class AgentRunRepository {
  async create(userId: string) {
    const result = await db.insert(agentRuns).values({ userId }).returning();
    return result[0];
  }

  async findById(id: string) {
    const result = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
    return result[0] || null;
  }

  async findByUser(userId: string, limit = 20, offset = 0) {
    return db.select()
      .from(agentRuns)
      .where(eq(agentRuns.userId, userId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit)
      .offset(offset);
  }

  async updateStatus(id: string, status: string, cost?: { tokens: number; cost: number }) {
    const updateData: any = { status };
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateData.completedAt = new Date();
    }
    if (cost) {
      updateData.totalTokens = cost.tokens;
      updateData.totalCost = cost.cost;
    }
    
    const result = await db.update(agentRuns)
      .set(updateData)
      .where(eq(agentRuns.id, id))
      .returning();
    return result[0];
  }
}

export class MessageRepository {
  async create(runId: string, role: string, content: string, toolCallId?: string) {
    const result = await db.insert(messages).values({ runId, role, content, toolCallId }).returning();
    return result[0];
  }

  async findByRun(runId: string) {
    return db.select()
      .from(messages)
      .where(eq(messages.runId, runId))
      .orderBy(messages.createdAt);
  }
}

export class ToolCallRepository {
  async create(runId: string, toolId: string, input: Record<string, unknown>) {
    const result = await db.insert(toolCalls).values({ runId, toolId, input }).returning();
    return result[0];
  }

  async complete(id: string, output: Record<string, unknown>, durationMs: number) {
    const result = await db.update(toolCalls)
      .set({ output, durationMs, status: 'success' })
      .where(eq(toolCalls.id, id))
      .returning();
    return result[0];
  }

  async fail(id: string, error: string, durationMs: number) {
    const result = await db.update(toolCalls)
      .set({ output: { error }, durationMs, status: 'error' })
      .where(eq(toolCalls.id, id))
      .returning();
    return result[0];
  }

  async findByRun(runId: string) {
    return db.select()
      .from(toolCalls)
      .where(eq(toolCalls.runId, runId))
      .orderBy(toolCalls.createdAt);
  }
}
```

### Day 3-4: WebSocket Server

**Install Socket.io:**
```bash
pnpm add socket.io
pnpm add -D @types/socket.io
```

**Create `apps/backend/src/api/ws/socket-server.ts`:**
```typescript
import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../../application/services/auth-service';
import { logger } from '../../infrastructure/logging/logger';
import type { AgentEvent } from '@project-jarvis/shared-types';

interface AuthenticatedSocket extends Socket {
  userId: string;
  userEmail: string;
}

export class SocketServer {
  private io: Server;
  private userSockets: Map<string, Set<string>> = new Map();

  constructor(httpServer: HttpServer, authService: AuthService) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
      },
    });

    // Auth middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication required'));
        }

        const payload = authService.verifyAccessToken(token);
        (socket as AuthenticatedSocket).userId = payload.userId;
        (socket as AuthenticatedSocket).userEmail = payload.email;
        next();
      } catch (error) {
        next(new Error('Invalid token'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const authSocket = socket as AuthenticatedSocket;
      const userId = authSocket.userId;

      // Track socket for user
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(socket.id);

      logger.info('WebSocket connected', { userId, socketId: socket.id });

      // Join user-specific room
      socket.join(`user:${userId}`);

      socket.on('disconnect', () => {
        this.userSockets.get(userId)?.delete(socket.id);
        if (this.userSockets.get(userId)?.size === 0) {
          this.userSockets.delete(userId);
        }
        logger.info('WebSocket disconnected', { userId, socketId: socket.id });
      });
    });
  }

  // Send event to all of a user's connected sockets
  emitToUser(userId: string, event: AgentEvent) {
    this.io.to(`user:${userId}`).emit('agent:event', event);
  }

  // Send event for a specific run
  emitToRun(userId: string, runId: string, event: AgentEvent) {
    this.io.to(`user:${userId}`).emit(`run:${runId}`, event);
  }

  isUserConnected(userId: string): boolean {
    return this.userSockets.has(userId) && this.userSockets.get(userId)!.size > 0;
  }
}
```

### Day 4-5: Event Stream Adapter

**Create `apps/backend/src/adapters/event-stream/websocket-adapter.ts`:**
```typescript
import { EventStreamPort } from '../../ports/EventStreamPort';
import { SocketServer } from '../../api/ws/socket-server';
import type { AgentEvent } from '@project-jarvis/shared-types';

export class WebSocketEventStreamAdapter implements EventStreamPort {
  constructor(private socketServer: SocketServer) {}

  async publish(userId: string, runId: string, event: AgentEvent): Promise<void> {
    this.socketServer.emitToRun(userId, runId, event);
  }

  async publishToken(userId: string, runId: string, token: string): Promise<void> {
    await this.publish(userId, runId, { type: 'agent.token', token });
  }

  async publishToolCall(userId: string, runId: string, toolId: string, input: unknown): Promise<void> {
    await this.publish(userId, runId, { type: 'agent.tool_call', toolId, input });
  }

  async publishToolResult(userId: string, runId: string, toolId: string, output: unknown): Promise<void> {
    await this.publish(userId, runId, { type: 'agent.tool_result', toolId, output });
  }

  async publishFinal(userId: string, runId: string, content: string): Promise<void> {
    await this.publish(userId, runId, { type: 'agent.final', content });
  }

  async publishError(userId: string, runId: string, message: string): Promise<void> {
    await this.publish(userId, runId, { type: 'agent.error', message });
  }
}
```

### Files to Create This Week

```
apps/backend/src/
  adapters/
    storage/
      agent-run-repository.ts
      message-repository.ts
      tool-call-repository.ts
    event-stream/
      websocket-adapter.ts
  api/ws/
    socket-server.ts
  ports/
    EventStreamPort.ts
```

---

## Week 4: Memory Storage

### Objectives
- Set up pgvector indexes
- Create memory and KG repositories
- Implement vector search queries

### Day 1-2: pgvector Setup

**Create migration for vector indexes:**
```sql
-- Create HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS memories_embedding_idx 
ON memories USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS kg_entities_embedding_idx 
ON kg_entities USING hnsw (embedding vector_cosine_ops);
```

**Create `apps/backend/src/adapters/storage/memory-repository.ts`:**
```typescript
import { eq, sql, desc } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client';
import { memories } from '../../infrastructure/db/schema';

export class MemoryRepository {
  async create(userId: string, content: string, embedding: number[], metadata?: Record<string, unknown>) {
    const result = await db.insert(memories).values({
      userId,
      content,
      embedding: JSON.stringify(embedding), // pgvector accepts array or string
      metadata: metadata || {},
    }).returning();
    return result[0];
  }

  async search(userId: string, embedding: number[], limit = 10, threshold = 0.7) {
    // Cosine similarity search using pgvector
    const results = await db.execute(sql`
      SELECT 
        id, 
        content, 
        metadata, 
        created_at,
        1 - (embedding <=> ${JSON.stringify(embedding)}::vector) as similarity
      FROM memories
      WHERE user_id = ${userId}
        AND 1 - (embedding <=> ${JSON.stringify(embedding)}::vector) > ${threshold}
      ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
      LIMIT ${limit}
    `);
    
    return results.rows;
  }

  async findByUser(userId: string, limit = 50, offset = 0) {
    return db.select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(desc(memories.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async delete(id: string, userId: string) {
    await db.delete(memories)
      .where(sql`id = ${id} AND user_id = ${userId}`);
  }
}
```

### Day 3-4: Knowledge Graph Repository

**Create `apps/backend/src/adapters/storage/kg-repository.ts`:**
```typescript
import { eq, and, or, sql } from 'drizzle-orm';
import { db } from '../../infrastructure/db/client';
import { kgEntities, kgRelations } from '../../infrastructure/db/schema';

export class KGEntityRepository {
  async create(userId: string, type: string, name: string, properties?: Record<string, unknown>, embedding?: number[]) {
    const result = await db.insert(kgEntities).values({
      userId,
      type,
      name,
      properties: properties || {},
      embedding: embedding ? JSON.stringify(embedding) : null,
    }).returning();
    return result[0];
  }

  async findById(id: string) {
    const result = await db.select().from(kgEntities).where(eq(kgEntities.id, id)).limit(1);
    return result[0] || null;
  }

  async findByUser(userId: string, type?: string) {
    let query = db.select().from(kgEntities).where(eq(kgEntities.userId, userId));
    if (type) {
      query = query.where(and(eq(kgEntities.userId, userId), eq(kgEntities.type, type)));
    }
    return query;
  }

  async searchByEmbedding(userId: string, embedding: number[], limit = 10) {
    const results = await db.execute(sql`
      SELECT 
        id, type, name, properties, created_at,
        1 - (embedding <=> ${JSON.stringify(embedding)}::vector) as similarity
      FROM kg_entities
      WHERE user_id = ${userId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
      LIMIT ${limit}
    `);
    return results.rows;
  }

  async update(id: string, data: { name?: string; properties?: Record<string, unknown> }) {
    const result = await db.update(kgEntities)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(kgEntities.id, id))
      .returning();
    return result[0];
  }

  async delete(id: string) {
    await db.delete(kgEntities).where(eq(kgEntities.id, id));
  }
}

export class KGRelationRepository {
  async create(userId: string, sourceId: string, targetId: string, type: string, properties?: Record<string, unknown>) {
    const result = await db.insert(kgRelations).values({
      userId,
      sourceId,
      targetId,
      type,
      properties: properties || {},
    }).returning();
    return result[0];
  }

  async findByEntity(entityId: string) {
    return db.select()
      .from(kgRelations)
      .where(or(
        eq(kgRelations.sourceId, entityId),
        eq(kgRelations.targetId, entityId)
      ));
  }

  async findRelated(entityId: string, relationType?: string, depth = 1) {
    // For now, single-hop traversal
    // TODO: Implement recursive CTE for multi-hop
    let query = db.select()
      .from(kgRelations)
      .where(or(
        eq(kgRelations.sourceId, entityId),
        eq(kgRelations.targetId, entityId)
      ));
    
    if (relationType) {
      query = query.where(eq(kgRelations.type, relationType));
    }
    
    return query;
  }

  async delete(id: string) {
    await db.delete(kgRelations).where(eq(kgRelations.id, id));
  }
}
```

### Day 4-5: Rate Limiting

**Install rate limiting packages:**
```bash
pnpm add rate-limiter-flexible ioredis
```

**Create `apps/backend/src/api/middleware/rate-limit.ts`:**
```typescript
import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import Redis from 'ioredis';
import { config } from '../../infrastructure/config';
import { AppError } from '../../domain/errors';

const redis = new Redis(config.REDIS_URL);

// Global rate limiter: 100 requests per minute
const globalLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:global',
  points: 100,
  duration: 60,
});

// Per-user rate limiter: 30 requests per minute
const userLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:user',
  points: 30,
  duration: 60,
});

// Agent run limiter: 10 concurrent runs per user
const agentRunLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:agent',
  points: 10,
  duration: 60 * 60, // 1 hour
});

export async function globalRateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.ip || 'unknown';
    await globalLimiter.consume(key);
    next();
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      res.set('Retry-After', String(Math.ceil(error.msBeforeNext / 1000)));
      throw new AppError('RATE_LIMIT_EXCEEDED', 'Too many requests', 429);
    }
    throw error;
  }
}

export async function userRateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) {
    return next();
  }

  try {
    await userLimiter.consume(req.userId);
    next();
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      res.set('Retry-After', String(Math.ceil(error.msBeforeNext / 1000)));
      throw new AppError('RATE_LIMIT_EXCEEDED', 'Too many requests', 429);
    }
    throw error;
  }
}

export async function checkAgentRunLimit(userId: string): Promise<void> {
  try {
    await agentRunLimiter.consume(userId);
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      throw new AppError('AGENT_RUN_LIMIT', 'Too many concurrent agent runs', 429);
    }
    throw error;
  }
}
```

### Files to Create This Week

```
apps/backend/src/
  adapters/storage/
    memory-repository.ts
    kg-repository.ts
  api/middleware/
    rate-limit.ts
  infrastructure/db/migrations/
    0002_add_vector_indexes.sql
```

---

## Week 5: Tool Permissions & OAuth

### Objectives
- Implement tool permission system
- Store Composio OAuth tokens
- Add cost tracking

### Key Tasks

1. **Tool Permissions Table:**
```typescript
export const toolPermissions = pgTable('tool_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toolId: varchar('tool_id', { length: 255 }).notNull(),
  allowed: boolean('allowed').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

2. **Cost Tracking in AgentRun:**
   - Track tokens and cost per LLM call
   - Aggregate in agent_runs table
   - Implement per-user budget limits

3. **OAuth Token Storage:**
   - Store OAuth refresh tokens as encrypted UserSecrets
   - Implement token refresh logic in Composio adapter

---

## Week 6: Security & Observability

### Objectives
- Implement row-level security
- Set up OpenTelemetry tracing
- PII redaction

### Key Tasks

1. **Row-Level Security:**
```sql
-- Enable RLS
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_secrets ENABLE ROW LEVEL SECURITY;

-- Policies (example)
CREATE POLICY memories_user_policy ON memories
  USING (user_id = current_setting('app.current_user_id')::uuid);
```

2. **OpenTelemetry Setup:**
```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

3. **PII Redaction:**
   - Scrub emails, phone numbers, SSNs before storing in memories
   - Use regex patterns with replacement

---

## Testing Checklist

### Unit Tests
- [ ] Auth service (register, login, refresh, logout)
- [ ] Secrets encryption/decryption
- [ ] Repository CRUD operations
- [ ] Rate limiting logic

### Integration Tests
- [ ] Auth flow end-to-end
- [ ] Secrets API
- [ ] WebSocket connection and events
- [ ] Vector similarity search

### Security Tests
- [ ] JWT validation edge cases
- [ ] Secrets never logged
- [ ] Rate limiting effectiveness
- [ ] RLS policy enforcement

---

## Coordination with Other Developers

### With Backend Dev 2
- **Week 1:** Agree on port interfaces
- **Week 3:** Sync on WebSocket event format and EventStreamPort
- **Week 4:** Sync on memory/KG repository interfaces

### With Frontend Dev
- **Week 2:** Document JWT payload and refresh flow
- **Week 2:** Document API error response format
- **Week 3:** Test WebSocket connection from mobile

---

## Quick Reference

### Generate Master Key
```bash
openssl rand -hex 32
```

### Run Migrations
```bash
pnpm drizzle-kit generate:pg
pnpm drizzle-kit push:pg
```

### Start Local Services
```bash
docker-compose up -d
pnpm dev:backend
```
