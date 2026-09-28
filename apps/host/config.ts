import 'dotenv/config'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

const env = z.object({
  HOST: z.enum(['127.0.0.1', 'localhost']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(4310),
  CAPABILITY_PORT: z.coerce.number().int().min(1024).max(65535).default(4311),
  WORKSPACE_PORT: z.coerce.number().int().default(5173),
  DATA_DIR: z.string().default('data/local'), DATABASE_URL: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-flash'),
  ALLOW_INTERNAL_MODEL: z.enum(['true', 'false']).default('false'),
}).parse(process.env)

export const config = {
  ...env, dataDir: resolve(env.DATA_DIR), ownerId: 'local-operator',
  capabilityUrl: `http://127.0.0.1:${env.CAPABILITY_PORT}`,
  capabilityToken: process.env.CAPABILITY_TOKEN || randomBytes(32).toString('hex'),
  modelConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
  searchConfigured: Boolean(process.env.DEEPSEEK_SEARCH_API_KEY || process.env.DEEPSEEK_API_KEY),
}
