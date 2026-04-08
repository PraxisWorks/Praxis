/**
 * Lightweight markdown-to-HTML renderer for session chat messages.
 *
 * Handles the subset of markdown that Claude typically produces:
 * fenced code blocks, inline code, bold, italic, headers, links,
 * unordered/ordered lists, horizontal rules, and blockquotes.
 *
 * No external dependencies -- uses dangerouslySetInnerHTML with a
 * pure-string transform (no user-generated URLs or attributes).
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownToHtml(md: string): string {
  // Escape HTML entities first to prevent injection
  let html = escapeHtml(md);

  // Fenced code blocks: ```lang\n...\n```
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, _lang, code) =>
      `<pre class="md-pre"><code>${code.replace(/\n$/, "")}</code></pre>`,
  );

  // Inline code: `code`
  html = html.replace(
    /`([^`\n]+)`/g,
    '<code class="md-code">$1</code>',
  );

  // Headers (### before ## before #) -- only at line start
  html = html.replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr class="md-hr" />');

  // Bold + italic: ***text*** or ___text___
  html = html.replace(/\*{3}([^*]+)\*{3}/g, "<strong><em>$1</em></strong>");
  html = html.replace(/_{3}([^_]+)_{3}/g, "<strong><em>$1</em></strong>");

  // Bold: **text** or __text__
  html = html.replace(/\*{2}([^*]+)\*{2}/g, "<strong>$1</strong>");
  html = html.replace(/_{2}([^_]+)_{2}/g, "<strong>$1</strong>");

  // Italic: *text* or _text_ (but not inside words for underscores)
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/(?<![a-zA-Z])_([^_]+)_(?![a-zA-Z])/g, "<em>$1</em>");

  // Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Blockquotes: > text (consecutive lines merged)
  html = html.replace(
    /(?:^&gt; (.+)$\n?)+/gm,
    (match) => {
      const inner = match.replace(/^&gt; /gm, "").trim();
      return `<blockquote class="md-blockquote">${inner}</blockquote>\n`;
    },
  );

  // Unordered lists: lines starting with - or *
  html = html.replace(
    /(?:^(?:[-*]) (.+)$\n?)+/gm,
    (match) => {
      const items = match
        .trim()
        .split("\n")
        .map((line) => `<li>${line.replace(/^[-*] /, "")}</li>`)
        .join("");
      return `<ul class="md-ul">${items}</ul>\n`;
    },
  );

  // Ordered lists: lines starting with 1. 2. etc
  html = html.replace(
    /(?:^\d+\. (.+)$\n?)+/gm,
    (match) => {
      const items = match
        .trim()
        .split("\n")
        .map((line) => `<li>${line.replace(/^\d+\. /, "")}</li>`)
        .join("");
      return `<ol class="md-ol">${items}</ol>\n`;
    },
  );

  // Paragraphs: double newlines become paragraph breaks
  html = html.replace(/\n{2,}/g, "</p><p>");

  // Single newlines become <br> (except inside block elements handled above)
  html = html.replace(/\n/g, "<br />");

  // Clean up <br /> immediately after block-level closing tags
  html = html.replace(/(<\/(?:pre|ul|ol|blockquote|h[1-4]|hr)>)<br \/>/g, "$1");
  // Clean up <br /> immediately before block-level opening tags
  html = html.replace(/<br \/>(<(?:pre|ul|ol|blockquote|h[1-4]|hr)[ >])/g, "$1");

  return `<p>${html}</p>`
    .replace(/<p><\/p>/g, "")
    .replace(/<p>(<(?:pre|ul|ol|blockquote|h[1-4]|hr))/g, "$1")
    .replace(/(<\/(?:pre|ul|ol|blockquote|h[1-4])>)<\/p>/g, "$1");
}

type MarkdownContentProps = {
  content: string;
  className?: string;
};

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const html = markdownToHtml(content);
  return (
    <div
      className={`md-content ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
