"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/features/support/api/supportApi";
// Staff endpoints use the admin cookie session, not the user bearer token.
import * as adminApi from "@/features/support/api/adminSupportApi";
import { hasValidAuthToken } from "@/utils/auth";

export const SUPPORT_KEY = ["support"];

// Nothing to subscribe to — these snapshots are read once per render.
const noopSubscribe = () => () => {};

/**
 * Is there a session, without breaking hydration?
 *
 * The token lives in storage the server cannot see, so a static prerender must
 * render the signed-out view and the client must correct it after hydration.
 * `useSyncExternalStore` is built for exactly this: React uses the server
 * snapshot while hydrating, then re-renders with the client snapshot.
 *
 * The obvious alternative — `useState(false)` plus a mount effect — reads the
 * same value but does it by scheduling a second render pass from inside an
 * effect, which is the cascading-render pattern `react-hooks/set-state-in-effect`
 * exists to catch.
 */
export function useIsSignedIn() {
  return useSyncExternalStore(
    noopSubscribe,
    () => hasValidAuthToken(),
    () => false
  );
}

/**
 * A page number that returns to 1 whenever the filters change.
 *
 * Adjusts state during render — the documented React pattern for "reset state
 * when an input changes" — rather than from an effect. An effect would render
 * page 3 of the new result set first and then correct itself, which is both a
 * wasted request and a visible flicker.
 *
 * @param {string} filterKey Serialised filter state; any change resets the page.
 */
export function useResettablePage(filterKey) {
  const [page, setPage] = useState(1);
  const [seenKey, setSeenKey] = useState(filterKey);

  if (filterKey !== seenKey) {
    setSeenKey(filterKey);
    setPage(1);
  }

  return [filterKey === seenKey ? page : 1, setPage];
}

/**
 * A draft saved in sessionStorage, read without a hydration mismatch.
 *
 * The raw string is compared before parsing so the returned object keeps a
 * stable identity between renders — `useSyncExternalStore` re-renders forever
 * if `getSnapshot` hands back a new object each time.
 */
export function useSessionDraft(key) {
  const cache = useRef({ raw: null, value: null });

  const readSnapshot = useCallback(() => {
    let raw = null;
    try {
      raw = sessionStorage.getItem(key);
    } catch {
      return null;
    }
    if (raw !== cache.current.raw) {
      cache.current.raw = raw;
      try {
        cache.current.value = raw ? JSON.parse(raw) : null;
      } catch {
        cache.current.value = null;
      }
    }
    return cache.current.value;
  }, [key]);

  return useSyncExternalStore(noopSubscribe, readSnapshot, () => null);
}

/**
 * Polling interval for a live conversation.
 *
 * There is no websocket layer in this app, and adding one for support alone is
 * not justified — so the conversation refreshes on a timer, and push
 * notifications cover the case where the customer is not looking at the screen.
 * Polling PAUSES while the tab is hidden: a backgrounded tab left open
 * overnight would otherwise spend thousands of requests learning nothing.
 */
const CONVERSATION_POLL_MS = 15_000;
const QUEUE_POLL_MS = 30_000;

function useDocumentVisible() {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden
  );

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}

/**
 * Stable id for a submission, so a retry after a timeout is recognised as the
 * same request rather than creating a second ticket or posting a duplicate
 * reply. Regenerated only once the submission genuinely succeeds.
 */
export function useIdempotencyKey() {
  const make = () =>
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const [key, setKey] = useState(make);
  const reset = useCallback(() => setKey(make()), []);
  return [key, reset];
}

// ─── Public ──────────────────────────────────────────────────────────────────

export function useSupportConfig() {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "config"],
    queryFn: ({ signal }) => api.getSupportConfig(signal),
    // Contact details change roughly never. Cached hard so the Help Center
    // renders instantly on repeat visits.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });
}

export function useSupportHome() {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "home"],
    queryFn: ({ signal }) => api.getSupportHome(signal),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useArticleSearch({ q, category, page = 1 }, { enabled = true } = {}) {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "articles", q || "", category || "", page],
    queryFn: ({ signal }) => api.searchArticles({ q, category, page }, signal),
    enabled,
    staleTime: 60 * 1000,
    // Keeps the previous page on screen while the next one loads, so the list
    // does not collapse to a spinner on every keystroke.
    placeholderData: (previous) => previous,
  });
}

export function useArticle(slug) {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "article", slug],
    queryFn: ({ signal }) => api.getArticle(slug, signal),
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useRateArticle(slug) {
  return useMutation({
    mutationFn: ({ helpful, comment }) => api.rateArticle(slug, { helpful, comment }),
  });
}

// ─── Customer tickets ────────────────────────────────────────────────────────

export function useMyTickets(filters = {}) {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "my-tickets", filters],
    queryFn: ({ signal }) => api.listMyTickets(filters, signal),
    staleTime: 30 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useMyTicket(id) {
  const visible = useDocumentVisible();

  return useQuery({
    queryKey: [...SUPPORT_KEY, "my-ticket", id],
    queryFn: ({ signal }) => api.getMyTicket(id, signal),
    enabled: Boolean(id),
    staleTime: 10 * 1000,
    refetchInterval: visible ? CONVERSATION_POLL_MS : false,
    // The app disables focus refetching globally; on an open conversation it is
    // exactly what you want — coming back to the tab should show the reply.
    refetchOnWindowFocus: true,
  });
}

export function useMyTicketMessages(id, { page = 1 } = {}) {
  const visible = useDocumentVisible();

  return useQuery({
    queryKey: [...SUPPORT_KEY, "my-ticket-messages", id, page],
    queryFn: ({ signal }) => api.listMyTicketMessages(id, { page }, signal),
    enabled: Boolean(id),
    staleTime: 5 * 1000,
    refetchInterval: visible ? CONVERSATION_POLL_MS : false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useDuplicateCandidates(category) {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "duplicates", category || ""],
    queryFn: ({ signal }) => api.getDuplicateCandidates(category, signal),
    enabled: Boolean(category),
    staleTime: 30 * 1000,
  });
}

/**
 * Article suggestions while the customer types a subject.
 *
 * Debounced locally rather than firing per keystroke — this is the deflection
 * surface, not a search box, and a request per character would be both noisy
 * and slower to settle than one request 500 ms after they stop typing.
 */
export function useArticleSuggestions({ category, subject }) {
  const [debounced, setDebounced] = useState(subject);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(subject), 500);
    return () => clearTimeout(timer.current);
  }, [subject]);

  return useQuery({
    queryKey: [...SUPPORT_KEY, "suggestions", category || "", debounced || ""],
    queryFn: ({ signal }) => api.getArticleSuggestions({ category, subject: debounced }, signal),
    enabled: Boolean(category),
    staleTime: 60 * 1000,
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload) => api.createTicket(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "my-tickets"] });
    },
  });
}

export function useReplyToTicket(id) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload) => api.replyToTicket(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "my-ticket", id] });
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "my-ticket-messages", id] });
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "my-tickets"] });
    },
  });
}

export function useReopenTicket(id) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.reopenTicket(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "my-ticket", id] });
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "my-ticket-messages", id] });
    },
  });
}

export function useRateTicket(id) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload) => api.rateTicket(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "my-ticket", id] });
    },
  });
}

// ─── Staff console ───────────────────────────────────────────────────────────

export function useSupportCapabilities() {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "capabilities"],
    queryFn: ({ signal }) => adminApi.getMySupportCapabilities(signal),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Capability check for rendering controls.
 *
 * A convenience only. Every mutating endpoint re-checks the same capability
 * server-side, so hiding a button here is presentation, never protection.
 */
export function useCan(capabilities) {
  return useMemo(() => {
    const set = new Set(capabilities || []);
    return (capability) => set.has(capability);
  }, [capabilities]);
}

export function useSupportMetrics() {
  const visible = useDocumentVisible();

  return useQuery({
    queryKey: [...SUPPORT_KEY, "metrics"],
    queryFn: ({ signal }) => adminApi.getSupportMetrics(signal),
    staleTime: 20 * 1000,
    refetchInterval: visible ? QUEUE_POLL_MS : false,
  });
}

export function useSupportAgents() {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "agents"],
    queryFn: ({ signal }) => adminApi.listSupportAgents(signal),
    staleTime: 5 * 60 * 1000,
  });
}

export function useStaffTickets(params = {}) {
  const visible = useDocumentVisible();

  return useQuery({
    queryKey: [...SUPPORT_KEY, "staff-tickets", params],
    queryFn: ({ signal }) => adminApi.listStaffTickets(params, signal),
    staleTime: 15 * 1000,
    refetchInterval: visible ? QUEUE_POLL_MS : false,
    placeholderData: (previous) => previous,
  });
}

export function useStaffTicket(id) {
  const visible = useDocumentVisible();

  return useQuery({
    queryKey: [...SUPPORT_KEY, "staff-ticket", id],
    queryFn: ({ signal }) => adminApi.getStaffTicket(id, signal),
    enabled: Boolean(id),
    staleTime: 10 * 1000,
    refetchInterval: visible ? CONVERSATION_POLL_MS : false,
    refetchOnWindowFocus: true,
  });
}

export function useStaffTicketMessages(id) {
  const visible = useDocumentVisible();

  return useQuery({
    queryKey: [...SUPPORT_KEY, "staff-messages", id],
    queryFn: ({ signal }) => adminApi.listStaffTicketMessages(id, {}, signal),
    enabled: Boolean(id),
    staleTime: 5 * 1000,
    refetchInterval: visible ? CONVERSATION_POLL_MS : false,
    refetchOnWindowFocus: true,
  });
}

export function useTicketContext(id) {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "ticket-context", id],
    queryFn: ({ signal }) => adminApi.getTicketContext(id, signal),
    enabled: Boolean(id),
    staleTime: 60 * 1000,
  });
}

export function useTicketAudit(id) {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "ticket-audit", id],
    queryFn: ({ signal }) => adminApi.getTicketAudit(id, signal),
    enabled: Boolean(id),
    staleTime: 30 * 1000,
  });
}

/**
 * Every staff mutation invalidates the same set, because they all change what
 * the queue and the metric tiles should show. Cheap, and it removes a whole
 * category of "the list says open but the ticket is resolved" bugs.
 */
function useStaffMutation(id, mutationFn) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "staff-ticket", id] });
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "staff-messages", id] });
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "staff-tickets"] });
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "metrics"] });
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "ticket-audit", id] });
    },
  });
}

export const useStaffReply = (id) => useStaffMutation(id, (payload) => adminApi.staffReply(id, payload));
export const useAssignTicket = (id) => useStaffMutation(id, (payload) => adminApi.assignTicket(id, payload));
export const useChangeStatus = (id) => useStaffMutation(id, (payload) => adminApi.changeTicketStatus(id, payload));
export const useChangePriority = (id) => useStaffMutation(id, (payload) => adminApi.changeTicketPriority(id, payload));
export const useUpdateTags = (id) => useStaffMutation(id, (tags) => adminApi.updateTicketTags(id, tags));

// ─── Knowledge base management ───────────────────────────────────────────────

export function useAdminArticles(params = {}) {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "admin-articles", params],
    queryFn: ({ signal }) => adminApi.listAdminArticles(params, signal),
    staleTime: 30 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useAdminArticle(id) {
  return useQuery({
    queryKey: [...SUPPORT_KEY, "admin-article", id],
    queryFn: ({ signal }) => adminApi.getAdminArticle(id, signal),
    enabled: Boolean(id),
    staleTime: 30 * 1000,
  });
}

function useArticleMutation(mutationFn) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "admin-articles"] });
      // The public Help Center caches hard; publishing must not leave readers
      // looking at a stale category listing.
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "home"] });
      queryClient.invalidateQueries({ queryKey: [...SUPPORT_KEY, "articles"] });
    },
  });
}

export const useCreateArticle = () => useArticleMutation((payload) => adminApi.createArticle(payload));
export const useUpdateArticle = () =>
  useArticleMutation(({ id, ...payload }) => adminApi.updateArticle(id, payload));
export const useChangeArticleStatus = () =>
  useArticleMutation(({ id, status }) => adminApi.changeArticleStatus(id, status));
export const useDeleteArticle = () => useArticleMutation((id) => adminApi.deleteArticle(id));
