import { API_URL } from "@/config/api";
import { getValidToken, hydrateAuthToken } from "@/utils/auth";
import { silentRefresh } from "@/services/apiClient";

// SSE wire format we negotiated with the backend:
//   event: meta     -> { conversationId, userMessageId, quota }
//   event: context  -> { cached, sourceHash, tradeCount, ... }
//   event: delta    -> { text }
//   event: done     -> { ok: true }
//   event: error    -> { code, message }
//
// We can't use EventSource because it doesn't support POST + custom headers;
// instead we fetch with the auth header and parse the body as a ReadableStream.

function buildHeaders(token) {
  const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function resolveToken() {
  let token = getValidToken();
  if (!token) token = await hydrateAuthToken();
  if (!token) {
    try { token = await silentRefresh(); } catch { /* handled below */ }
  }
  return token;
}

function parseSseChunk(buffer, onEvent) {
  // SSE splits messages on a blank line. Anything before the first blank line
  // belongs to the next event; we keep the trailing partial in the buffer.
  let idx;
  while ((idx = buffer.indexOf("\n\n")) >= 0) {
    const rawEvent = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    const lines = rawEvent.split("\n");
    let eventName = "message";
    const dataLines = [];
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue; // heartbeat or comment
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    const data = dataLines.join("\n");
    if (data) {
      let parsed = null;
      try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
      onEvent(eventName, parsed);
    } else {
      onEvent(eventName, null);
    }
  }
  return buffer;
}

export async function streamCoachMessage({
  conversationId,
  content,
  signal,
  onMeta,
  onContext,
  onDelta,
  onDone,
  onError,
}) {
  if (!conversationId) throw new Error("conversationId is required");
  const token = await resolveToken();

  const response = await fetch(`${API_URL}/coach/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: buildHeaders(token),
    credentials: "include",
    body: JSON.stringify({ content, stream: true }),
    signal,
  });

  // Quota-exhausted and validation errors short-circuit to a JSON body.
  if (response.status === 402) {
    const body = await response.json().catch(() => ({}));
    const err = new Error(body?.error?.message || "Coach quota exhausted");
    err.code = body?.error?.code || "COACH_QUOTA_EXHAUSTED";
    err.details = body?.error?.details || null;
    err.quotaExhausted = true;
    onError?.(err);
    throw err;
  }
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    const err = new Error(`Coach stream failed (${response.status})`);
    err.status = response.status;
    err.body = body;
    onError?.(err);
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, (eventName, data) => {
        if (eventName === "meta")    onMeta?.(data);
        else if (eventName === "context") onContext?.(data);
        else if (eventName === "delta")   onDelta?.(data?.text || "");
        else if (eventName === "done")    onDone?.(data);
        else if (eventName === "error") {
          const err = new Error(data?.message || "Coach error");
          err.code = data?.code || "COACH_STREAM_ERROR";
          onError?.(err);
        }
      });
    }
  } finally {
    try { reader.releaseLock(); } catch { /* noop */ }
  }
}
