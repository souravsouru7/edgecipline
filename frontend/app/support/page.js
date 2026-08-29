"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { Search, X, FileText, ChevronRight, LifeBuoy } from "lucide-react";
import SupportShell from "@/features/support/components/SupportShell";
import ContactChannels from "@/features/support/components/ContactChannels";
import {
  LoadingBlock,
  ErrorBlock,
  EmptyState,
  Pager,
} from "@/features/support/components/SupportBits";
import {
  useSupportConfig,
  useSupportHome,
  useArticleSearch,
  useIsSignedIn,
  useResettablePage,
} from "@/features/support/hooks/useSupport";

/**
 * Help Center — the public front door.
 *
 * THIS PAGE MUST RENDER FOR A LOGGED-OUT VISITOR. It is the support URL given
 * to Google Play and App Store Connect, and scripts/check-public-routes.mjs
 * asserts that a cold browser with no session sees the word "Support" here.
 * Nothing on this screen may require a session, and nothing may block the
 * first paint on a network call — every panel below degrades to static content
 * plus working contact links if the API is unreachable.
 */

function ArticleRow({ article }) {
  return (
    <Link href={`/support/article?slug=${encodeURIComponent(article.slug)}`} className="ar-row">
      <FileText size={15} aria-hidden="true" className="ar-icon" />
      <span className="ar-body">
        <span className="ar-title">{article.title}</span>
        {article.excerpt && <span className="ar-excerpt">{article.excerpt}</span>}
      </span>
      <ChevronRight size={15} aria-hidden="true" className="ar-chev" />
      <style jsx>{`
        :global(.ar-row) {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 14px 16px;
          border-radius: 12px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          text-decoration: none;
          margin-bottom: 9px;
          transition: border-color 0.15s, background 0.15s;
        }
        :global(.ar-row:hover) {
          border-color: var(--color-primary);
          background: var(--color-primary-bg);
        }
        :global(.ar-row:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        :global(.ar-icon) {
          color: var(--color-primary);
          flex-shrink: 0;
          margin-top: 2px;
        }
        .ar-body {
          display: flex;
          flex-direction: column;
          gap: 3px;
          flex: 1;
          min-width: 0;
        }
        .ar-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--color-dark);
          line-height: 1.4;
        }
        .ar-excerpt {
          font-size: 12.5px;
          color: var(--color-text-muted);
          line-height: 1.55;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        :global(.ar-chev) {
          color: var(--color-text-disabled);
          flex-shrink: 0;
          margin-top: 3px;
        }
      `}</style>
    </Link>
  );
}

function HelpCenter() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const signedIn = useIsSignedIn();
  // Returns to page 1 whenever the search or category changes — otherwise a
  // new query asks for page 3 of a completely different result set.
  const [page, setPage] = useResettablePage(`${query.trim()}|${category}`);

  const configQuery = useSupportConfig();
  const homeQuery = useSupportHome();

  const searching = query.trim().length > 0 || Boolean(category);
  const searchQuery = useArticleSearch(
    { q: query.trim(), category, page },
    { enabled: searching }
  );

  const config = configQuery.data;
  // Memoised on the query result: a fresh `[]` every render would change the
  // dependency of the useMemo below every render, defeating it entirely.
  const categories = useMemo(() => homeQuery.data?.categories || [], [homeQuery.data]);
  const popular = homeQuery.data?.popular || [];

  const activeCategory = useMemo(
    () => categories.find((c) => c.value === category),
    [categories, category]
  );

  // Categories with nothing published in them would be dead ends.
  const visibleCategories = categories.filter((c) => c.articleCount > 0);

  return (
    <SupportShell
      eyebrow="SUPPORT"
      actions={
        signedIn ? (
          <Link href="/support/tickets" className="hc-mine">
            My tickets
          </Link>
        ) : null
      }
    >
      {/* ── Hero + search ─────────────────────────────────────────────── */}
      <section className="hc-hero">
        <h1 className="hc-h1">
          How can we <span className="hc-accent">help?</span>
        </h1>
        <p className="hc-sub">
          Search our guides, or reach the team directly. Support is available for every
          Edgecipline account.
        </p>

        <div className="hc-search">
          <Search size={17} aria-hidden="true" className="hc-search-icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for answers…"
            aria-label="Search help articles"
            className="hc-input"
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="hc-clear"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>

        {activeCategory && (
          <div className="hc-filter">
            <span>Filtered by</span>
            <button type="button" onClick={() => setCategory("")} className="hc-chip-active">
              {activeCategory.label}
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </section>

      {/* ── Results, or browse ────────────────────────────────────────── */}
      {searching ? (
        <section aria-live="polite" className="hc-section">
          <h2 className="hc-h2">Results</h2>

          {searchQuery.isPending && <LoadingBlock label="Searching" rows={3} />}

          {searchQuery.isError && (
            <ErrorBlock
              message="We couldn't search the help centre just now."
              onRetry={() => searchQuery.refetch()}
            />
          )}

          {searchQuery.data?.items?.length > 0 && (
            <>
              {/* When the exact search found nothing, the server falls back to
                  a substring match and then to spelling correction. Saying so
                  is the honest framing — presenting a loose or corrected match
                  as the answer wastes the reader's time. */}
              {["partial", "fuzzy"].includes(searchQuery.data.matchedBy) && (
                <p className="hc-note">
                  No exact matches
                  {searchQuery.data.matchedBy === "fuzzy" ? " — did you mean:" : ". Here is the closest we found:"}
                </p>
              )}
              {searchQuery.data.items.map((article) => (
                <ArticleRow key={article.slug} article={article} />
              ))}
              <Pager pagination={searchQuery.data.pagination} onPage={setPage} />
            </>
          )}

          {searchQuery.data && searchQuery.data.items.length === 0 && (
            <EmptyState
              icon={<Search size={28} aria-hidden="true" />}
              title="No articles matched that"
              description="Try a different word, or skip straight to the team — the contact options below all work."
            />
          )}
        </section>
      ) : (
        <>
          {homeQuery.isPending && (
            <section className="hc-section">
              <LoadingBlock label="Loading help topics" rows={2} />
            </section>
          )}

          {visibleCategories.length > 0 && (
            <section className="hc-section">
              <h2 className="hc-h2">Browse by topic</h2>
              <div className="hc-cats">
                {visibleCategories.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setCategory(cat.value)}
                    className="hc-cat"
                  >
                    <span className="hc-cat-label">{cat.label}</span>
                    <span className="hc-cat-desc">{cat.description}</span>
                    <span className="hc-cat-count">
                      {cat.articleCount} {cat.articleCount === 1 ? "article" : "articles"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {popular.length > 0 && (
            <section className="hc-section">
              <h2 className="hc-h2">Popular questions</h2>
              {popular.map((article) => (
                <ArticleRow key={article.slug} article={article} />
              ))}
            </section>
          )}

          {/* An outage and an empty knowledge base look identical from the
              component's point of view, but they are not the same message.
              Telling someone we haven't written any articles when the real
              cause is a failed request is a lie they can act on. */}
          {homeQuery.isError && (
            <section className="hc-section">
              <ErrorBlock
                message="We couldn't load the help articles just now. The contact options below still work."
                onRetry={() => homeQuery.refetch()}
              />
            </section>
          )}

          {/* The knowledge base being genuinely empty must not leave the page
              blank — the contact channels below are the actual guarantee this
              page makes to the app stores. */}
          {!homeQuery.isPending && !homeQuery.isError && visibleCategories.length === 0 && popular.length === 0 && (
            <section className="hc-section">
              <EmptyState
                icon={<LifeBuoy size={28} aria-hidden="true" />}
                title="Guides are on their way"
                description="We're still writing our help articles. In the meantime the team below will answer anything you need."
              />
            </section>
          )}
        </>
      )}

      {/* ── Contact ───────────────────────────────────────────────────── */}
      <section className="hc-section">
        <h2 className="hc-h2">Still need help?</h2>
        <p className="hc-lead">
          Pick whichever suits you. For anything involving your account, billing, or a payment,
          a ticket is best — it keeps a written record against your account.
        </p>

        {configQuery.isError ? (
          <ErrorBlock
            message="We couldn't load the contact options. Please refresh, or email us at info@edgecipline.com."
            onRetry={() => configQuery.refetch()}
          />
        ) : (
          <ContactChannels
            config={config}
            categoryLabel={activeCategory?.label}
            ticketsEnabled={config?.ticketsEnabled !== false}
            ticketHref={signedIn ? "/support/tickets/new" : "/login?next=/support/tickets/new"}
          />
        )}
      </section>

      <style jsx>{`
        .hc-hero {
          margin-bottom: 32px;
        }
        .hc-h1 {
          font-size: 28px;
          font-weight: 800;
          line-height: 1.15;
          letter-spacing: -0.02em;
          margin: 0 0 10px;
          color: var(--color-dark);
        }
        .hc-accent {
          color: var(--color-primary);
        }
        .hc-sub {
          font-size: 14.5px;
          line-height: 1.65;
          color: var(--color-text-muted);
          margin: 0 0 22px;
          max-width: 560px;
        }
        .hc-search {
          position: relative;
          display: flex;
          align-items: center;
        }
        :global(.hc-search-icon) {
          position: absolute;
          left: 16px;
          color: var(--color-text-disabled);
          pointer-events: none;
        }
        .hc-input {
          width: 100%;
          height: 52px;
          padding: 0 46px;
          border-radius: 13px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          font-size: 15px;
          font-family: inherit;
          color: var(--color-dark);
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .hc-input::placeholder {
          color: var(--color-text-disabled);
        }
        .hc-input:focus {
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px var(--color-primary-bg);
        }
        .hc-clear {
          position: absolute;
          right: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: none;
          border-radius: 50%;
          background: var(--color-surface-hover);
          color: var(--color-text-muted);
          cursor: pointer;
        }
        .hc-clear:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .hc-filter {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
          font-size: 12px;
          color: var(--color-text-muted);
        }
        .hc-chip-active {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--color-primary);
          background: var(--color-primary-bg);
          color: var(--color-primary);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .hc-section {
          margin-bottom: 34px;
        }
        .hc-h2 {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--color-text-muted);
          margin: 0 0 14px;
        }
        .hc-lead {
          font-size: 13.5px;
          line-height: 1.65;
          color: var(--color-text-muted);
          margin: -4px 0 16px;
          max-width: 620px;
        }
        .hc-note {
          font-size: 13px;
          color: var(--color-text-muted);
          margin: 0 0 12px;
        }
        .hc-cats {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
          gap: 11px;
        }
        .hc-cat {
          display: flex;
          flex-direction: column;
          gap: 4px;
          text-align: left;
          padding: 15px 16px;
          border-radius: 13px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.15s, transform 0.15s;
          min-height: 92px;
        }
        .hc-cat:hover {
          border-color: var(--color-primary);
          transform: translateY(-2px);
        }
        .hc-cat:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        .hc-cat-label {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-dark);
        }
        .hc-cat-desc {
          font-size: 12px;
          color: var(--color-text-muted);
          line-height: 1.5;
          flex: 1;
        }
        .hc-cat-count {
          font-family: var(--font-jetbrains-mono);
          font-size: 10px;
          font-weight: 700;
          color: var(--color-primary);
          letter-spacing: 0.03em;
        }
        :global(.hc-mine) {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--color-primary);
          text-decoration: none;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid rgba(13, 158, 110, 0.3);
          background: var(--color-primary-bg);
          white-space: nowrap;
        }
        :global(.hc-mine:focus-visible) {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        @media (min-width: 720px) {
          .hc-h1 {
            font-size: 38px;
          }
          .hc-sub {
            font-size: 15.5px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .hc-cat,
          .hc-cat:hover {
            transform: none;
            transition: none;
          }
        }
      `}</style>
    </SupportShell>
  );
}

export default function SupportPage() {
  // The shell renders synchronously so the page never flashes blank while the
  // client bundle hydrates — which is what an app-store reviewer would see.
  return (
    <Suspense fallback={<SupportShell eyebrow="SUPPORT"><LoadingBlock label="Loading support" rows={3} /></SupportShell>}>
      <HelpCenter />
    </Suspense>
  );
}
