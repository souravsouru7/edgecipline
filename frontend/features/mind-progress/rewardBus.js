// Tiny pub/sub between save flows and the global MindRewardHost.
//
// Save screens call announceJournalSaved() right after a successful write and
// then navigate away. The host (mounted once in app/providers) outlives that
// navigation, waits for the redirect to settle, and shows the instant reward.
const listeners = new Set();

export function announceJournalSaved(source = "trade") {
  for (const listener of listeners) {
    try {
      listener({ source, at: Date.now() });
    } catch {
      // a broken listener must never affect the save flow
    }
  }
}

export function subscribeJournalSaved(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Celebrations (level-ups, Mind Wins) from anywhere — the dashboard card, the
// instant reward — go through one queue in MindRewardHost, deduped by id, so
// the same win can never pop twice.
const celebrationListeners = new Set();

export function enqueueCelebrations(list) {
  if (!Array.isArray(list) || list.length === 0) return;
  for (const listener of celebrationListeners) {
    try {
      listener(list);
    } catch {
      // ignore
    }
  }
}

export function subscribeCelebrations(listener) {
  celebrationListeners.add(listener);
  return () => celebrationListeners.delete(listener);
}
