import { recordEvent } from './store.js';

const POLL_INTERVAL_MS = 10_000;
const TIMER_PERIOD_MS = 60_000;

export function startTimerHook() {
  const poll = async () => {
    const occurrence = Math.floor(Date.now() / TIMER_PERIOD_MS);
    try {
      const isNew = await recordEvent('timer', String(occurrence), {
        tickAt: new Date(occurrence * TIMER_PERIOD_MS).toISOString(),
      });
      if (isNew) {
        console.log(`[timer] timer.tick ${occurrence} detected, workflow would start here`);
      }
    } catch (error) {
      console.error('[timer] polling failed', error);
    }
  };

  const handle = setInterval(poll, POLL_INTERVAL_MS);
  return () => clearInterval(handle);
}
