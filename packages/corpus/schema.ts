import { z } from 'zod'

export const splitSchema = z.enum(['train', 'development'])
const nonempty = z.string().trim().min(1)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const origin = { path: nonempty, family_id: nonempty, split: splitSchema }
export const collectionSchema = z.object({
  schema_version: z.literal('1.0'),
  sources: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('run_sources'), ...origin }).strict(),
    z.object({ kind: z.literal('html_snapshot'), ...origin, metadata_path: nonempty }).strict(),
  ])),
  regression: z.array(z.object({ path: nonempty, pointer: z.string(), family_id: nonempty,
    kind: z.enum(['fixture', 'model_run', 'context_output']) }).strict()),
}).strict()

// Source itself is validated against the existing canonical business contract.
export const bundleSchema = z.object({
  schema_version: z.literal('1.0'), family_id: nonempty, split: splitSchema,
  origin: nonempty, sources: z.array(z.unknown()).min(1),
}).strict()

const reviewIdentity = {
  candidate_id: nonempty, candidate_sha256: sha256,
  reviewer_kind: z.literal('human'), reviewer: nonempty,
  reviewed_at: z.iso.datetime({ offset: true }),
}
export const reviewSchema = z.discriminatedUnion('status', [z.object({
  ...reviewIdentity, status: z.literal('approved'),
  question: nonempty, answer: nonempty, evidence_quote: nonempty,
  unknowns: z.array(nonempty), privacy_cleared: z.literal(true),
}).strict(), z.object({ ...reviewIdentity, status: z.literal('rejected'), reason: nonempty }).strict()])

export const grantSchema = z.object({
  document_id: nonempty, content_sha256: sha256,
  allowed_use: z.literal('local_sft'), evidence: nonempty,
  attested_by: nonempty, attested_at: z.iso.datetime({ offset: true }),
}).strict()

export type Split = z.infer<typeof splitSchema>
export type Collection = z.infer<typeof collectionSchema>
export type Bundle = z.infer<typeof bundleSchema>
export type Review = z.infer<typeof reviewSchema>
export type Grant = z.infer<typeof grantSchema>
