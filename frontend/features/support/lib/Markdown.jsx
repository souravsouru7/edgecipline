"use client";

import { Fragment } from "react";

/**
 * Minimal Markdown renderer for knowledge-base articles.
 *
 * Renders to React ELEMENTS, never to an HTML string. There is no
 * `dangerouslySetInnerHTML` anywhere in this file, which means there is no
 * sanitiser to get wrong and no XSS surface to audit — React escapes every
 * text node it is handed, and the only tags that can ever appear are the ones
 * this file constructs itself.
 *
 * That is a deliberate trade against pulling in a markdown parser plus a
 * sanitiser: two dependencies, a configuration surface, and a class of CVE we
 * would have to track, in exchange for syntax an internal help centre does not
 * need. The supported subset below covers everything a support article
 * actually uses.
 *
 * Supported: # headings, **bold**, *italic*, `code`, ```code blocks```,
 * [links](url), - bullets, 1. numbers, > quotes, --- rules, | tables |.
 */

// Only these schemes may appear in a link. Blocks `javascript:` and `data:`,
// which are the two that turn a rendered link into script execution.
const SAFE_LINK = /^(https?:\/\/|mailto:|\/)/i;

function safeHref(href) {
  const trimmed = String(href || "").trim();
  return SAFE_LINK.test(trimmed) ? trimmed : null;
}

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/** Parse bold / italic / code / links inside one line of text. */
function renderInline(text, keyPrefix) {
  const parts = String(text || "").split(INLINE_PATTERN).filter((p) => p !== "" && p !== undefined);

  return parts.map((part, i) => {
    const key = `${keyPrefix}-i${i}`;

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          style={{
            background: "var(--color-surface-hover)",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
            padding: "1px 5px",
            fontFamily: "var(--font-jetbrains-mono)",
            fontSize: "0.9em",
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      // An unsafe scheme renders as plain text rather than disappearing, so a
      // reader still sees what the author wrote and an editor can spot it.
      if (!href) return <Fragment key={key}>{link[1]}</Fragment>;

      const external = /^https?:\/\//i.test(href);
      return (
        <a
          key={key}
          href={href}
          {...(external
            ? // noreferrer is the load-bearing half: without it the target page
              // gets window.opener and can navigate this tab somewhere else.
              { target: "_blank", rel: "noopener noreferrer" }
            : {})}
          style={{ color: "var(--color-primary)", fontWeight: 600 }}
        >
          {link[1]}
        </a>
      );
    }

    return <Fragment key={key}>{part}</Fragment>;
  });
}

const HEADING_SIZES = { 1: 24, 2: 19, 3: 16, 4: 15, 5: 14, 6: 13 };

export default function Markdown({ source, style }) {
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block — consumed verbatim, no inline parsing inside.
    if (line.trim().startsWith("```")) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre
          key={`b${blocks.length}`}
          style={{
            background: "var(--color-dark)",
            color: "#22C78E",
            padding: 14,
            borderRadius: 10,
            overflowX: "auto",
            fontSize: 12.5,
            lineHeight: 1.6,
            fontFamily: "var(--font-jetbrains-mono)",
            margin: "16px 0",
          }}
        >
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(
        <hr
          key={`b${blocks.length}`}
          style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: "22px 0" }}
        />
      );
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${Math.min(level + 1, 6)}`;
      blocks.push(
        <Tag
          key={`b${blocks.length}`}
          style={{
            fontSize: HEADING_SIZES[level],
            fontWeight: 800,
            margin: blocks.length === 0 ? "0 0 12px" : "26px 0 10px",
            color: "var(--color-dark)",
            lineHeight: 1.3,
          }}
        >
          {renderInline(heading[2], `b${blocks.length}`)}
        </Tag>
      );
      i += 1;
      continue;
    }

    // Table — header row, separator, then body rows.
    if (line.includes("|") && lines[i + 1] && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const cells = (row) =>
        row.split("|").map((c) => c.trim()).filter((c, idx, arr) => !(c === "" && (idx === 0 || idx === arr.length - 1)));

      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(cells(lines[i]));
        i += 1;
      }

      blocks.push(
        // Wide tables scroll inside their own container rather than making the
        // whole article scroll sideways on a phone.
        <div key={`b${blocks.length}`} style={{ overflowX: "auto", margin: "16px 0" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5, minWidth: 380 }}>
            <thead>
              <tr>
                {header.map((cell, ci) => (
                  <th
                    key={ci}
                    style={{
                      textAlign: "left",
                      padding: "9px 12px",
                      borderBottom: "2px solid var(--color-border)",
                      color: "var(--color-text-muted)",
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {renderInline(cell, `th${ci}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: "9px 12px", borderBottom: "1px solid var(--color-border-subtle)" }}>
                      {renderInline(cell, `td${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Lists — bullets and numbers.
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (
        i < lines.length &&
        (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*+]\s+/.test(lines[i]))
      ) {
        items.push(lines[i].replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""));
        i += 1;
      }

      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={`b${blocks.length}`}
          style={{ margin: "12px 0", paddingLeft: 22, lineHeight: 1.75, fontSize: 14.5 }}
        >
          {items.map((item, li) => (
            <li key={li} style={{ marginBottom: 5 }}>
              {renderInline(item, `b${blocks.length}-l${li}`)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`b${blocks.length}`}
          style={{
            borderLeft: "3px solid var(--color-primary)",
            background: "var(--color-primary-bg)",
            padding: "12px 16px",
            margin: "16px 0",
            borderRadius: "0 8px 8px 0",
            color: "var(--color-text-secondary)",
            fontSize: 14,
            lineHeight: 1.7,
          }}
        >
          {renderInline(quote.join(" "), `b${blocks.length}`)}
        </blockquote>
      );
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Paragraph — consecutive non-blank lines join with a space, the way
    // markdown soft-wraps behave.
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|-{3,}$)/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i += 1;
    }

    blocks.push(
      <p
        key={`b${blocks.length}`}
        style={{ margin: "0 0 14px", lineHeight: 1.75, fontSize: 14.5, color: "var(--color-text-secondary)" }}
      >
        {renderInline(para.join(" "), `b${blocks.length}`)}
      </p>
    );
  }

  return <div style={{ wordBreak: "break-word", ...style }}>{blocks}</div>;
}
