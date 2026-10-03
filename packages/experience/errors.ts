export class ExperienceError extends Error {
  constructor(readonly status: number, readonly code: string, detail: string) { super(detail) }
}
