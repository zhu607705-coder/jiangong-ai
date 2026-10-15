// Full-App fixtures use the existing local administrator mode, without login.
export function localSession({ modelConfigured = false } = {}) {
  return {
    model_configured: modelConfigured,
    authentication: { enabled: false, role: 'admin', public_read_only: false },
  }
}
