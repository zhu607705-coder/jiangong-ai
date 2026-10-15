import 'dotenv/config'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { requestOriginPolicy } from './request-origin'

const env = z.object({
  HOST: z.enum(['127.0.0.1', 'localhost']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(4310),
  CAPABILITY_PORT: z.coerce.number().int().min(1024).max(65535).default(4311),
  WORKSPACE_PORT: z.coerce.number().int().default(5173),
  // Public requests still require the reverse proxy's client access policy.
  TRUSTED_PUBLIC_ORIGIN: z.string().default(''),
  ADMIN_USERNAME: z.string().regex(/^[A-Za-z0-9_.-]{3,64}$/).default('admin'),
  ADMIN_PASSWORD_HASH: z.string().refine(value => !value || /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value), 'ADMIN_PASSWORD_HASH must be a scrypt password hash.').default(''),
  ADMIN_SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(28800),
  DATA_DIR: z.string().default('data/local'), DATABASE_URL: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-flash'),
  QWEN_DECISION_ENABLED: z.enum(['true', 'false']).default('false'),
  QWEN_DECISION_MODEL: z.literal('decision-model-preview').default('decision-model-preview'),
  QWEN_DECISION_ENDPOINT: z.string().default(''),
  QWEN_DECISION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(12000),
  ALLOW_INTERNAL_MODEL: z.enum(['true', 'false']).default('false'),
}).parse(process.env)

if (env.TRUSTED_PUBLIC_ORIGIN.trim() && !env.ADMIN_PASSWORD_HASH) throw new Error('A trusted public origin requires administrator credentials.')

export const config = {
  ...env, dataDir: resolve(env.DATA_DIR), ownerId: 'local-operator',
  requestOrigins: requestOriginPolicy(env.PORT, env.WORKSPACE_PORT, env.TRUSTED_PUBLIC_ORIGIN),
  capabilityUrl: `http://127.0.0.1:${env.CAPABILITY_PORT}`,
  capabilityToken: process.env.CAPABILITY_TOKEN || randomBytes(32).toString('hex'),
  modelConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
  decisionEnabled: env.QWEN_DECISION_ENABLED === 'true',
  decisionConfigured: Boolean(process.env.QWEN_DECISION_API_KEY && env.QWEN_DECISION_ENDPOINT),
  searchConfigured: Boolean(process.env.DEEPSEEK_SEARCH_API_KEY || process.env.DEEPSEEK_API_KEY),
}
