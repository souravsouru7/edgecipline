"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Eye, EyeOff, Archive, Trash2, ThumbsUp, ThumbsDown, X } from "lucide-react";
import AdminHeader from "@/components/AdminHeader";
import Markdown from "@/features/support/lib/Markdown";
import {
  LoadingBlock,
  ErrorBlock,
  EmptyState,
  Pager,
  Field,
  InlineSpinner,
  formatWhen,
} from "@/features/support/components/SupportBits";
import {
  useAdminArticles,
  useCreateArticle,
  useUpdateArticle,
  useChangeArticleStatus,
  useDeleteArticle,
  useSupportCapabilities,
  useCan,
  useSupportConfig,
  useResettablePage,
} from "@/features/support/hooks/useSupport";
import { getArticleFeedbackReport } from "@/features/support/api/adminSupportApi";

const STATUS_TONE = {
  draft: { fg: "#B8860B", bg: "rgba(184,134,11,0.12)" },
  published: { fg: "#0D9E6E", bg: "rgba(13,158,110,0.12)" },
  archived: { fg: "#64748B", bg: "rgba(100,116,139,0.12)" },
};

const EMPTY_ARTICLE = {
  title: "",
  slug: "",
  excerpt: "",
  bodyMarkdown: "",
  category: "getting_started",
  tags: [],
  status: "draft",
  order: 0,
  relatedSlugs: [],
};

function Editor({ article, categories, onClose, onSaved }) {
  const isNew = !article?.id;
  const [form, setForm] = useState(() => ({ ...EMPTY_ARTICLE, ...(article || {}) }));
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const create = useCreateArticle();
  const update = useUpdateArticle();
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (isNew || !article?.id) return;
    let cancelled = false;
    getArticleFeedbackReport(article.id)
      .then((data) => !cancelled && setFeedback(data))
      .catch(() => {
        /* the usefulness report is supplementary, not required to edit */
      });
    return () => {
      cancelled = true;
    };
  }, [isNew, article?.id]);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    setError("");

    if (form.title.trim().length < 3) return setError("Title must be at least 3 characters.");
    if (!form.bodyMarkdown.trim()) return setError("The article body cannot be empty.");

    const payload = {
      title: form.title.trim(),
      excerpt: form.excerpt.trim(),
      bodyMarkdown: form.bodyMarkdown,
      category: form.category,
      tags: (Array.isArray(form.tags) ? form.tags : String(form.tags).split(","))
        .map((t) => String(t).trim())
        .filter(Boolean),
      order: Number(form.order) || 0,
      relatedSlugs: (Array.isArray(form.relatedSlugs)
        ? form.relatedSlugs
        : String(form.relatedSlugs).split(","))
        .map((s) => String(s).trim())
        .filter(Boolean),
      // The slug is only editable while the article is a draft — changing it
      // after publication breaks every bookmark and cross-reference. The server
      // enforces this too; sending it regardless would just be ignored.
      ...(isNew || form.status === "draft" ? { slug: form.slug.trim() } : {}),
      ...(isNew ? { status: form.status } : {}),
    };

    try {
      const saved = isNew
        ? await create.mutateAsync(payload)
        : await update.mutateAsync({ id: article.id, ...payload });
      onSaved(saved);
    } catch (err) {
      setError(err?.data?.message || err?.message || "Could not save the article.");
    }
  };

  return (
    <div className="ed-overlay" role="dialog" aria-modal="true" aria-label={isNew ? "New article" : "Edit article"}>
      <div className="ed-panel">
        <header className="ed-head">
          <h2 className="ed-title">{isNew ? "New article" : "Edit article"}</h2>
          <div className="ed-head-actions">
            <button type="button" onClick={() => setPreview((p) => !p)} className="ed-ghost">
              {preview ? "Edit" : "Preview"}
            </button>
            <button type="button" onClick={onClose} aria-label="Close editor" className="ed-x">
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="ed-body">
          {preview ? (
            <div className="ed-preview">
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 10px", color: "#0f1923" }}>
                {form.title || "Untitled"}
              </h1>
              {form.excerpt && (
                <p style={{ fontSize: 14.5, color: "#64748b", margin: "0 0 18px", lineHeight: 1.6 }}>
                  {form.excerpt}
                </p>
              )}
              <Markdown source={form.bodyMarkdown} />
            </div>
          ) : (
            <form onSubmit={save} id="article-form">
              <Field label="Title" htmlFor="ed-title" required>
                {(props) => (
                  <input {...props} value={form.title} onChange={set("title")} maxLength={200} className="ed-input" />
                )}
              </Field>

              <Field
                label="Slug"
                htmlFor="ed-slug"
                hint={
                  isNew || form.status === "draft"
                    ? "Lowercase, hyphenated. Leave blank to generate from the title."
                    : "Locked once published — changing it would break existing links."
                }
              >
                {(props) => (
                  <input
                    {...props}
                    value={form.slug}
                    onChange={set("slug")}
                    disabled={!isNew && form.status !== "draft"}
                    maxLength={120}
                    className="ed-input"
                    placeholder="why-was-i-charged-twice"
                  />
                )}
              </Field>

              <Field label="Category" htmlFor="ed-category" required>
                {(props) => (
                  <select {...props} value={form.category} onChange={set("category")} className="ed-input">
                    {categories.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field
                label="Excerpt"
                htmlFor="ed-excerpt"
                hint="Shown in search results and category listings."
              >
                {(props) => (
                  <textarea
                    {...props}
                    value={form.excerpt}
                    onChange={set("excerpt")}
                    rows={2}
                    maxLength={400}
                    className="ed-input"
                  />
                )}
              </Field>

              <Field
                label="Body"
                htmlFor="ed-body"
                required
                hint="Markdown: # headings, **bold**, `code`, - lists, > quotes, [links](url), | tables |."
              >
                {(props) => (
                  <textarea
                    {...props}
                    value={form.bodyMarkdown}
                    onChange={set("bodyMarkdown")}
                    rows={16}
                    maxLength={50000}
                    className="ed-input ed-mono"
                  />
                )}
              </Field>

              <div className="ed-row">
                <Field label="Tags" htmlFor="ed-tags" hint="Comma separated.">
                  {(props) => (
                    <input
                      {...props}
                      value={Array.isArray(form.tags) ? form.tags.join(", ") : form.tags}
                      onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value.split(",") }))}
                      className="ed-input"
                    />
                  )}
                </Field>

                <Field label="Order" htmlFor="ed-order" hint="Lower sorts first.">
                  {(props) => (
                    <input {...props} type="number" value={form.order} onChange={set("order")} className="ed-input" />
                  )}
                </Field>
              </div>

              <Field
                label="Related slugs"
                htmlFor="ed-related"
                hint="Comma separated. A slug that no longer resolves is simply not rendered."
              >
                {(props) => (
                  <input
                    {...props}
                    value={Array.isArray(form.relatedSlugs) ? form.relatedSlugs.join(", ") : form.relatedSlugs}
                    onChange={(e) => setForm((f) => ({ ...f, relatedSlugs: e.target.value.split(",") }))}
                    className="ed-input"
                  />
                )}
              </Field>

              {error && <ErrorBlock message={error} />}
            </form>
          )}

          {feedback && (
            <section className="ed-feedback">
              <h3 className="ed-fb-h">Reader feedback</h3>
              <div className="ed-fb-counts">
                <span className="ed-fb-yes">
                  <ThumbsUp size={13} aria-hidden="true" /> {feedback.helpfulCount}
                </span>
                <span className="ed-fb-no">
                  <ThumbsDown size={13} aria-hidden="true" /> {feedback.notHelpfulCount}
                </span>
                {feedback.helpfulRate != null && (
                  <span className="ed-fb-rate">{Math.round(feedback.helpfulRate * 100)}% helpful</span>
                )}
              </div>
              {feedback.comments?.length > 0 ? (
                <ul className="ed-fb-list">
                  {feedback.comments.map((c, i) => (
                    <li key={i} className={c.helpful ? "ed-fb-c" : "ed-fb-c ed-fb-c-neg"}>
                      <span>{c.comment}</span>
                      <time dateTime={c.at}>{formatWhen(c.at)}</time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ed-fb-empty">No written feedback yet.</p>
              )}
            </section>
          )}
        </div>

        <footer className="ed-foot">
          <button type="button" onClick={onClose} className="ed-ghost">
            Cancel
          </button>
          <button type="submit" form="article-form" disabled={saving || preview} className="ed-save">
            {saving ? <InlineSpinner /> : null}
            {saving ? "Saving…" : isNew ? "Create article" : "Save changes"}
          </button>
        </footer>
      </div>

      <style jsx>{`
        .ed-overlay {
          position: fixed;
          inset: 0;
          z-index: 200;
          background: rgba(15, 25, 35, 0.45);
          display: flex;
          justify-content: flex-end;
        }
        .ed-panel {
          display: flex;
          flex-direction: column;
          width: min(760px, 100%);
          height: 100%;
          background: #f0eee9;
          box-shadow: -8px 0 32px rgba(15, 25, 35, 0.2);
        }
        .ed-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 20px;
          border-bottom: 1px solid #e2e8f0;
          background: #fff;
          flex-shrink: 0;
        }
        .ed-title {
          font-size: 16px;
          font-weight: 800;
          margin: 0;
          color: #0f1923;
        }
        .ed-head-actions {
          display: flex;
          align-items: center;
          gap: 9px;
        }
        .ed-x {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: #64748b;
          cursor: pointer;
        }
        .ed-x:hover {
          background: #f1f5f9;
        }
        .ed-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }
        .ed-preview {
          padding: 22px;
          border-radius: 13px;
          background: #fff;
          border: 1px solid #e2e8f0;
        }
        .ed-input {
          width: 100%;
          padding: 11px 13px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          background: #fff;
          font-family: inherit;
          font-size: 14px;
          line-height: 1.6;
          color: #0f1923;
          outline: none;
        }
        .ed-input:focus {
          border-color: #0d9e6e;
          box-shadow: 0 0 0 3px rgba(13, 158, 110, 0.1);
        }
        .ed-input:disabled {
          background: #f8fafc;
          color: #94a3b8;
        }
        .ed-mono {
          font-family: var(--font-jetbrains-mono);
          font-size: 13px;
          resize: vertical;
        }
        .ed-row {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 14px;
        }
        .ed-feedback {
          margin-top: 22px;
          padding: 16px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          background: #fff;
        }
        .ed-fb-h {
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #94a3b8;
          margin: 0 0 10px;
        }
        .ed-fb-counts {
          display: flex;
          align-items: center;
          gap: 14px;
          font-size: 13px;
          font-weight: 700;
          margin-bottom: 12px;
        }
        .ed-fb-yes {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #0d9e6e;
        }
        .ed-fb-no {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #d63b3b;
        }
        .ed-fb-rate {
          color: #64748b;
          font-weight: 600;
          font-size: 12px;
        }
        .ed-fb-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .ed-fb-c {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 9px 11px;
          border-radius: 8px;
          background: #f8fafc;
          font-size: 12.5px;
          color: #4a5568;
          line-height: 1.5;
        }
        .ed-fb-c-neg {
          background: rgba(214, 59, 59, 0.05);
        }
        .ed-fb-c time {
          color: #94a3b8;
          font-size: 10.5px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .ed-fb-empty {
          margin: 0;
          font-size: 12px;
          color: #94a3b8;
        }
        .ed-foot {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 20px;
          border-top: 1px solid #e2e8f0;
          background: #fff;
          flex-shrink: 0;
          padding-bottom: calc(14px + env(safe-area-inset-bottom, 0px));
        }
        .ed-ghost {
          height: 40px;
          padding: 0 18px;
          border-radius: 9px;
          border: 1px solid #e2e8f0;
          background: #fff;
          color: #64748b;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .ed-save {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 40px;
          padding: 0 22px;
          border: none;
          border-radius: 9px;
          background: #0f1923;
          color: #22c78e;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .ed-save:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        @media (max-width: 620px) {
          .ed-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function KnowledgeBaseManager() {
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useResettablePage(`${status}|${query}`);
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState("");

  const capabilities = useSupportCapabilities();
  const can = useCan(capabilities.data?.capabilities);
  const config = useSupportConfig();
  const articles = useAdminArticles({ status, q: query, page });
  const changeStatus = useChangeArticleStatus();
  const remove = useDeleteArticle();

  if (capabilities.data && !can("support:manage_kb")) {
    return (
      <div style={{ minHeight: "100vh", background: "#f0eee9" }}>
        <AdminHeader />
        <div style={{ maxWidth: 640, margin: "60px auto", padding: "0 20px" }}>
          <ErrorBlock message="Editing knowledge-base articles requires support lead or administrator access." />
        </div>
      </div>
    );
  }

  const rows = articles.data?.items || [];

  const act = async (fn) => {
    setActionError("");
    try {
      await fn();
    } catch (err) {
      setActionError(err?.data?.message || err?.message || "That action could not be completed.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f0eee9", paddingBottom: 60 }}>
      <AdminHeader />

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 20px" }}>
        <Link href="/admin/support" className="kb-back">
          <ArrowLeft size={15} aria-hidden="true" /> Back to support
        </Link>

        <div className="kb-top">
          <div>
            <h1 className="kb-h1">Knowledge base</h1>
            <p className="kb-sub">
              Published articles appear on the public Help Center and are suggested while customers
              write a ticket.
            </p>
          </div>
          <button type="button" onClick={() => setEditing({})} className="kb-new">
            <Plus size={15} aria-hidden="true" /> New article
          </button>
        </div>

        <div className="kb-controls">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or slug…"
            aria-label="Search articles"
            className="kb-input"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
            className="kb-select"
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {actionError && (
          <div style={{ marginBottom: 14 }}>
            <ErrorBlock message={actionError} />
          </div>
        )}

        {articles.isPending && <LoadingBlock label="Loading articles" rows={4} />}
        {articles.isError && (
          <ErrorBlock message="Could not load articles." onRetry={() => articles.refetch()} />
        )}

        {articles.data && rows.length === 0 && (
          <EmptyState
            title={query || status ? "No articles match" : "No articles yet"}
            description={
              query || status
                ? "Try a different search or status."
                : "Write your first help article — every published article is one fewer ticket."
            }
            action={
              <button type="button" onClick={() => setEditing({})} className="kb-cta">
                Create an article
              </button>
            }
          />
        )}

        {rows.length > 0 && (
          <div className="kb-table-wrap">
            <table className="kb-table">
              <thead>
                <tr>
                  <th scope="col">Article</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Helpful</th>
                  <th scope="col">Views</th>
                  <th scope="col">Updated</th>
                  <th scope="col"><span className="kb-sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((article) => {
                  const tone = STATUS_TONE[article.status];
                  return (
                    <tr key={article.id}>
                      <td>
                        <button type="button" onClick={() => setEditing(article)} className="kb-title-btn">
                          {article.title}
                        </button>
                        <div className="kb-slug">/{article.slug}</div>
                      </td>
                      <td className="kb-muted">{article.categoryLabel}</td>
                      <td>
                        <span
                          className="kb-badge"
                          style={{ color: tone.fg, background: tone.bg }}
                        >
                          {article.status}
                        </span>
                      </td>
                      <td className="kb-muted">
                        {article.helpfulCount}/{article.helpfulCount + article.notHelpfulCount}
                      </td>
                      <td className="kb-muted">{article.viewCount}</td>
                      <td className="kb-muted">{formatWhen(article.updatedAt)}</td>
                      <td>
                        <div className="kb-actions">
                          {article.status !== "published" ? (
                            <button
                              type="button"
                              title="Publish"
                              aria-label={`Publish ${article.title}`}
                              onClick={() => act(() => changeStatus.mutateAsync({ id: article.id, status: "published" }))}
                              className="kb-icon"
                            >
                              <Eye size={15} aria-hidden="true" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              title="Unpublish"
                              aria-label={`Unpublish ${article.title}`}
                              onClick={() => act(() => changeStatus.mutateAsync({ id: article.id, status: "draft" }))}
                              className="kb-icon"
                            >
                              <EyeOff size={15} aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            title="Archive"
                            aria-label={`Archive ${article.title}`}
                            onClick={() => act(() => changeStatus.mutateAsync({ id: article.id, status: "archived" }))}
                            className="kb-icon"
                          >
                            <Archive size={15} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            aria-label={`Delete ${article.title}`}
                            onClick={() => {
                              // Archiving is the normal path; deleting also
                              // removes the reader feedback, so it asks first.
                              if (
                                window.confirm(
                                  `Delete "${article.title}" permanently? Reader feedback goes with it. Archiving is usually what you want.`
                                )
                              ) {
                                act(() => remove.mutateAsync(article.id));
                              }
                            }}
                            className="kb-icon kb-icon-danger"
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pager pagination={articles.data?.pagination} onPage={setPage} />
      </main>

      {editing && (
        <Editor
          article={editing.id ? editing : null}
          categories={config.data?.categories || []}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      <style jsx>{`
        .kb-back {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 12.5px;
          font-weight: 700;
          color: #64748b;
          text-decoration: none;
          margin-bottom: 16px;
        }
        .kb-back:hover {
          color: #0d9e6e;
        }
        .kb-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 18px;
        }
        .kb-h1 {
          font-size: 22px;
          font-weight: 800;
          margin: 0 0 5px;
          color: #0f1923;
        }
        .kb-sub {
          margin: 0;
          font-size: 12.5px;
          color: #64748b;
          max-width: 560px;
          line-height: 1.55;
        }
        .kb-new,
        .kb-cta {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          height: 38px;
          padding: 0 16px;
          border: none;
          border-radius: 9px;
          background: #0f1923;
          color: #22c78e;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }
        .kb-controls {
          display: flex;
          gap: 9px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .kb-input {
          flex: 1;
          min-width: 200px;
          height: 38px;
          padding: 0 13px;
          border-radius: 9px;
          border: 1px solid #e2e8f0;
          background: #fff;
          font-size: 13px;
          font-family: inherit;
          outline: none;
        }
        .kb-input:focus {
          border-color: #0d9e6e;
        }
        .kb-select {
          height: 38px;
          padding: 0 11px;
          border-radius: 9px;
          border: 1px solid #e2e8f0;
          background: #fff;
          font-size: 12.5px;
          font-family: inherit;
          color: #4a5568;
          cursor: pointer;
        }
        .kb-table-wrap {
          overflow-x: auto;
          border-radius: 13px;
          border: 1px solid #e2e8f0;
          background: #fff;
        }
        .kb-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 820px;
        }
        .kb-table th {
          text-align: left;
          padding: 11px 14px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          color: #94a3b8;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }
        .kb-table td {
          padding: 12px 14px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 13px;
          vertical-align: top;
        }
        .kb-title-btn {
          background: none;
          border: none;
          padding: 0;
          font-family: inherit;
          font-size: 13.5px;
          font-weight: 600;
          color: #0f1923;
          cursor: pointer;
          text-align: left;
        }
        .kb-title-btn:hover {
          color: #0d9e6e;
          text-decoration: underline;
        }
        .kb-title-btn:focus-visible {
          outline: 2px solid #0d9e6e;
          outline-offset: 2px;
        }
        .kb-slug {
          font-family: var(--font-jetbrains-mono);
          font-size: 10.5px;
          color: #94a3b8;
          margin-top: 3px;
        }
        .kb-badge {
          display: inline-block;
          padding: 3px 9px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .kb-muted {
          color: #64748b;
          white-space: nowrap;
        }
        .kb-actions {
          display: flex;
          gap: 5px;
        }
        .kb-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border: 1px solid #e2e8f0;
          border-radius: 7px;
          background: #fff;
          color: #64748b;
          cursor: pointer;
        }
        .kb-icon:hover {
          border-color: #0d9e6e;
          color: #0d9e6e;
        }
        .kb-icon-danger:hover {
          border-color: #d63b3b;
          color: #d63b3b;
        }
        .kb-icon:focus-visible {
          outline: 2px solid #0d9e6e;
          outline-offset: 1px;
        }
        .kb-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
      `}</style>
    </div>
  );
}

export default function AdminArticlesPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f0eee9" }} />}>
      <KnowledgeBaseManager />
    </Suspense>
  );
}
