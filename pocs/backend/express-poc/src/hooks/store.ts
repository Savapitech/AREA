import { hookEvents } from '../data-source.js';
import { isUniqueViolation } from '../errors.js';

export async function recordEvent(source: string, externalId: string, payload: Record<string, unknown> | null) {
  try {
    await hookEvents().save(hookEvents().create({ source, externalId, payload }));
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return false;
    }
    throw error;
  }
}
