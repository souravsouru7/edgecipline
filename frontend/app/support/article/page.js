"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ThumbsUp, ThumbsDown, FileText, ChevronRight, CheckCircle2 } from "lucide-react";
import SupportShell from "@/features/support/components/SupportShell";
import ContactChannels from "@/features/support/components/ContactChannels";
import Markdown from "@/features/support/lib/Markdown";
import {
  LoadingBlock,
  ErrorBlock,
  EmptyState,
  InlineSpinner,
} from "@/features/support/components/SupportBits";
import {
  useArticle,
  useRateArticle,
  useSupportConfig,
  useIsSignedIn,
} from "@/features/support/hooks/useSupport";

/**
 * Knowledge-base article reader.
 *
 * Query-param routing (`?slug=`) rather than a `[slug]` segment because the web
 * build is a static export — a dynamic segment would need generateStaticParams
 * and could not serve an article written after the build. Same pattern as
 * /issues/detail and /trades/view.
 *
 * Public: no session required.
 */

function Helpful({ slug, config }) {
  const [answer, setAnswer] = useState(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const rate = useRateArticle(slug);

  const send = async (helpful, withComment = "") => {
    setAnswer(helpful);
    try {
      await rate.mutateAsync({ helpful, comment: withComment });
      setSubmitted(true);
    } catch {
      // Feedback is a nicety. A failed vote must not present the reader with an
      // error on an article they came here to read — the mutation state below
      // simply never flips to submitted, and the buttons stay available.
      setAnswer(null);
    }
  };

  if (submitted && answer === true) {
    return (
      <div className="hp-done" role="status">
        <CheckCircle2 size={17} aria-hidden="true" color="var(--color-primary)" />
        <span>Thanks — glad that helped.</span>
        <style jsx>{`
          .hp-done {
            display: flex;
            align-items: center;
            gap: 9px;
            padding: 15px 18px;
            border-radius: 13px;
            background: var(--color-primary-bg);
            border: 1px solid rgba(13, 158, 110, 0.28);
            font-size: 13.5px;
            font-weight: 600;
            color: var(--color-dark);
          }
        `}</style>
      </div>
    );
  }

  // "No" is the valuable answer — it is the moment the reader tells you which
  // question the article failed. So instead of thanking them and stopping, ask
  // what was missing and put the contact options directly in front of them.
  if (answer === false) {
    return (
      <div className="hp-no">
        <h2 className="hp-title">Sorry that didn&apos;t solve it.</h2>

        {!submitted ? (
          <>
            <label htmlFor="hp-comment" className="hp-label">
              What were you looking for? (optional)
            </label>
            <textarea
              id="hp-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              rows={3}
              className="hp-textarea"
              placeholder="Tell us what was missing and we'll fix the article."
            />
            <button
              type="button"
              onClick={() => send(false, comment)}
              disabled={rate.isPending}
              className="hp-send"
            >
              {rate.isPending ? <InlineSpinner /> : null}
              {rate.isPending ? "Sending…" : "Send feedback"}
            </button>
          </>
        ) : (
          <p className="hp-thanks" role="status">
            Thanks — we&apos;ll use that to improve this article.
          </p>
        )}

        <div className="hp-divider" />
        <h3 className="hp-sub">Talk to us instead</h3>
        <ContactChannels config={config} compact />

        <style jsx>{`
          .hp-no {
            padding: 20px;
            border-radius: 14px;
            border: 1px solid var(--color-border);
            background: var(--color-surface);
          }
          .hp-title {
            font-size: 16px;
            font-weight: 700;
            margin: 0 0 14px;
            color: var(--color-dark);
          }
          .hp-label {
            display: block;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.07em;
            text-transform: uppercase;
            color: var(--color-text-muted);
            margin-bottom: 8px;
          }
          .hp-textarea {
            width: 100%;
            padding: 12px 14px;
            border-radius: 11px;
            border: 1px solid var(--color-border);
            font-family: inherit;
            font-size: 14px;
            line-height: 1.6;
            resize: vertical;
            outline: none;
            color: var(--color-dark);
            background: var(--background);
          }
          .hp-textarea:focus {
            border-color: var(--color-primary);
            box-shadow: 0 0 0 3px var(--color-primary-bg);
          }
          .hp-send {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-top: 12px;
            height: 42px;
            padding: 0 20px;
            border: none;
            border-radius: 10px;
            background: var(--color-dark);
            color: var(--color-primary-light);
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            font-family: inherit;
          }
          .hp-send:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .hp-send:focus-visible {
            outline: 2px solid var(--color-primary);
            outline-offset: 2px;
          }
          .hp-thanks {
            font-size: 13.5px;
            color: var(--color-primary);
            font-weight: 600;
            margin: 0;
          }
          .hp-divider {
            height: 1px;
            background: var(--color-border);
            margin: 22px 0 18px;
          }
          .hp-sub {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.09em;
            text-transform: uppercase;
            color: var(--color-text-muted);
            margin: 0 0 12px;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="hp-ask">
      <span className="hp-q">Was this article helpful?</span>
      <div className="hp-btns">
        <button type="button" onClick={() => send(true)} className="hp-btn" disabled={rate.isPending}>
          <ThumbsUp size={15} aria-hidden="true" /> Yes
        </button>
        <button type="button" onClick={() => setAnswer(false)} className="hp-btn">
          <ThumbsDown size={15} aria-hidden="true" /> No
        </button>
      </div>
      <style jsx>{`
        .hp-ask {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          padding: 18px 20px;
          border-radius: 14px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
        }
        .hp-q {
          font-size: 14px;
          font-weight: 700;
          color: var(--color-dark);
        }
        .hp-btns {
          display: flex;
          gap: 9px;
        }
        .hp-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 40px;
          padding: 0 18px;
          border-radius: 10px;
          border: 1px solid var(--color-border);
          background: var(--background);
          color: var(--color-text-secondary);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .hp-btn:hover:not(:disabled) {
          border-color: var(--color-primary);
          color: var(--color-primary);
          background: var(--color-primary-bg);
        }
        .hp-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .hp-btn:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

function ArticleReader() {
  const params = useSearchParams();
  const slug = params.get("slug");
  const signedIn = useIsSignedIn();

  const { data: article, isPending, isError, error, refetch } = useArticle(slug);
  const { data: config } = useSupportConfig();

  if (!slug) {
    return (
      <SupportShell title="Article" backHref="/support">
        <EmptyState
          title="No article selected"
          description="That link is missing an article reference."
          action={
            <Link href="/support" className="ad-cta">
              Back to the Help Center
            </Link>
          }
        />
      </SupportShell>
    );
  }

  if (isPending) {
    return (
      <SupportShell backHref="/support">
        <LoadingBlock label="Loading article" rows={4} />
      </SupportShell>
    );
  }

  if (isError) {
    const notFound = error?.status === 404;
    return (
      <SupportShell title={notFound ? "Article not found" : "Couldn't load article"} backHref="/support">
        {notFound ? (
          <EmptyState
            icon={<FileText size={28} aria-hidden="true" />}
            title="That article isn't available"
            // Drafts and archived articles 404 exactly like a slug that never
            // existed, so this copy has to cover both without guessing which.
            description="It may have been moved or retired. Search the Help Center, or contact us and we'll answer directly."
            action={
              <Link href="/support" className="ad-cta">
                Search the Help Center
              </Link>
            }
          />
        ) : (
          <ErrorBlock message="We couldn't load this article." onRetry={refetch} />
        )}
        <div style={{ marginTop: 30 }}>
          <ContactChannels
            config={config}
            ticketsEnabled={config?.ticketsEnabled !== false}
            ticketHref={signedIn ? "/support/tickets/new" : "/login?next=/support/tickets/new"}
          />
        </div>
        <style jsx>{`
          :global(.ad-cta) {
            display: inline-block;
            padding: 11px 20px;
            border-radius: 10px;
            background: var(--color-dark);
            color: var(--color-primary-light);
            font-size: 13px;
            font-weight: 700;
            text-decoration: none;
          }
        `}</style>
      </SupportShell>
    );
  }

  return (
    <SupportShell backHref="/support" maxWidth={780}>
      <article>
        <div className="ad-eyebrow">{article.categoryLabel}</div>
        <h1 className="ad-h1">{article.title}</h1>
        {article.excerpt && <p className="ad-lead">{article.excerpt}</p>}

        <div className="ad-rule" aria-hidden="true" />

        {/* Rendered to React elements, never injected as HTML — see
            features/support/lib/Markdown. */}
        <Markdown source={article.bodyMarkdown} />
      </article>

      <div style={{ marginTop: 34 }}>
        <Helpful slug={slug} config={config} />
      </div>

      {article.related?.length > 0 && (
        <section style={{ marginTop: 34 }}>
          <h2 className="ad-h2">Related articles</h2>
          {article.related.map((rel) => (
            <Link
              key={rel.slug}
              href={`/support/article?slug=${encodeURIComponent(rel.slug)}`}
              className="ad-rel"
            >
              <FileText size={15} aria-hidden="true" style={{ color: "var(--color-primary)", flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>{rel.title}</span>
              <ChevronRight size={15} aria-hidden="true" style={{ color: "var(--color-text-disabled)", flexShrink: 0 }} />
            </Link>
          ))}
        </section>
      )}

      <style jsx>{`
        .ad-eyebrow {
          font-family: var(--font-jetbrains-mono);
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.13em;
          text-transform: uppercase;
          color: var(--color-primary);
          margin-bottom: 10px;
        }
        .ad-h1 {
          font-size: 26px;
          font-weight: 800;
          line-height: 1.22;
          letter-spacing: -0.018em;
          margin: 0 0 12px;
          color: var(--color-dark);
        }
        .ad-lead {
          font-size: 15px;
          line-height: 1.65;
          color: var(--color-text-muted);
          margin: 0;
        }
        .ad-rule {
          height: 1px;
          background: var(--color-border);
          margin: 24px 0;
        }
        .ad-h2 {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: var(--color-text-muted);
          margin: 0 0 12px;
        }
        .ad-rel {
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 13px 15px;
          border-radius: 11px;
          border: 1px solid var(--color-border);
          background: var(--color-surface);
          text-decoration: none;
          color: var(--color-dark);
          font-size: 13.5px;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .ad-rel:hover {
          border-color: var(--color-primary);
          background: var(--color-primary-bg);
        }
        .ad-rel:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
        @media (min-width: 720px) {
          .ad-h1 {
            font-size: 32px;
          }
        }
      `}</style>
    </SupportShell>
  );
}

export default function ArticlePage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <SupportShell backHref="/support">
          <LoadingBlock label="Loading article" rows={4} />
        </SupportShell>
      }
    >
      <ArticleReader />
    </Suspense>
  );
}
