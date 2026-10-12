// Exported for settings only some entry points need (e.g. Vapi), read at the point of use so
// the text chat doesn't require them.
export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name} (see .env.example)`);
  }
  return value;
}

export const env = {
  GOOGLE_APPLICATION_CREDENTIALS: required('GOOGLE_APPLICATION_CREDENTIALS'),
  GOOGLE_CALENDAR_ID: required('GOOGLE_CALENDAR_ID'),
  GOOGLE_SHEET_ID: required('GOOGLE_SHEET_ID'),
  LLM_API_KEY: required('LLM_API_KEY'),
  LLM_BASE_URL: required('LLM_BASE_URL'),
  LLM_MODEL: required('LLM_MODEL'),
};
