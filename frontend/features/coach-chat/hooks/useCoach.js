"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createConversation,
  deleteConversation,
  getConversation,
  getCoachQuota,
  getQuickPrompts,
  listConversations,
  refreshCoachContext,
} from "@/features/coach-chat/api/coachApi";
import { streamCoachMessage } from "@/features/coach-chat/lib/streamCoach";

const KEYS = {
  quota: ["coach", "quota"],
  quickPrompts: (a = "freeform") => ["coach", "quick-prompts", a],
  conversations: (anchorKind) => ["coach", "conversations", anchorKind || "all"],
  conversation: (id) => ["coach", "conversation", id],
};

function invalidateCoach(qc) {
  qc.invalidateQueries({ queryKey: ["coach"] });
}

export function useCoachQuota() {
  return useQuery({
    queryKey: KEYS.quota,
    queryFn: ({ signal }) => getCoachQuota(signal),
    staleTime: 30 * 1000,
  });
}

export function useQuickPrompts(anchorKind = "freeform") {
  return useQuery({
    queryKey: KEYS.quickPrompts(anchorKind),
    queryFn: ({ signal }) => getQuickPrompts(anchorKind, signal),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCoachConversations(anchorKind) {
  return useQuery({
    queryKey: KEYS.conversations(anchorKind),
    queryFn: ({ signal }) => listConversations(20, anchorKind, signal),
    staleTime: 30 * 1000,
  });
}

export function useCoachConversation(id) {
  return useQuery({
    queryKey: KEYS.conversation(id),
    queryFn: ({ signal }) => getConversation(id, signal),
    enabled: Boolean(id),
    staleTime: 15 * 1000,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createConversation,
    onSuccess: () => invalidateCoach(qc),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => invalidateCoach(qc),
  });
}

export function useRefreshCoachContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refreshCoachContext,
    onSuccess: () => invalidateCoach(qc),
  });
}

// Streaming hook. Encapsulates the optimistic user bubble + the live assistant
// bubble so any consumer just calls `send("question")` and reads `messages`,
// `streaming`, `error`.
export function useCoachStream(initialConversation) {
  const qc = useQueryClient();
  const [conversation, setConversation] = useState(initialConversation || null);
  const [messages, setMessages] = useState(initialConversation?.messages || []);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [quota, setQuota] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    setConversation(initialConversation || null);
    setMessages(initialConversation?.messages || []);
  }, [initialConversation?.conversation?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const send = useCallback(async ({ conversationId, content, anchor, market }) => {
    setError(null);
    let id = conversationId || conversation?.conversation?._id;
    if (!id) {
      try {
        const created = await createConversation({ anchor, market });
        id = created.conversation._id;
        setConversation({ conversation: created.conversation, messages: [] });
      } catch (err) {
        setError(err);
        return;
      }
    }

    // Optimistic user message + placeholder assistant message.
    const localUserId = `optimistic-user-${Date.now()}`;
    const localAssistantId = `optimistic-assistant-${Date.now() + 1}`;
    setMessages((prev) => ([
      ...prev,
      { _id: localUserId, role: "user", content, status: "complete", createdAt: new Date().toISOString() },
      { _id: localAssistantId, role: "assistant", content: "", status: "streaming", createdAt: new Date().toISOString() },
    ]));

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);

    try {
      await streamCoachMessage({
        conversationId: id,
        content,
        signal: controller.signal,
        onMeta: (data) => {
          if (data?.quota) {
            setQuota(data.quota);
            qc.setQueryData(KEYS.quota, { quota: data.quota });
          }
        },
        onDelta: (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m._id === localAssistantId
                ? { ...m, content: (m.content || "") + chunk }
                : m
            )
          );
        },
        onDone: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m._id === localAssistantId
                ? { ...m, status: "complete" }
                : m
            )
          );
        },
        onError: (err) => {
          setError(err);
          setMessages((prev) =>
            prev.map((m) =>
              m._id === localAssistantId
                ? { ...m, status: "error", content: m.content || err.message }
                : m
            )
          );
        },
      });
    } catch (err) {
      setError(err);
    } finally {
      setStreaming(false);
      qc.invalidateQueries({ queryKey: KEYS.conversations() });
      qc.invalidateQueries({ queryKey: KEYS.conversation(id) });
      qc.invalidateQueries({ queryKey: KEYS.quota });
    }
  }, [conversation?.conversation?._id, qc]);

  return useMemo(() => ({
    conversation,
    messages,
    streaming,
    error,
    quota,
    send,
    stop,
    setConversation,
    setMessages,
  }), [conversation, messages, streaming, error, quota, send, stop]);
}
