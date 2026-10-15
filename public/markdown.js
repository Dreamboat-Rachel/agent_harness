import { marked, Renderer } from "marked";

const renderer = new Renderer();

renderer.html = ({ text }) => escapeHtml(text);

renderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens);
  if (!safeLink(href)) return label;
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${titleAttribute}>${label}</a>`;
};

renderer.image = ({ text }) => `<span class="markdown-image-label">[图片：${escapeHtml(text || "未命名")}]</span>`;

renderer.table = function (token) {
  return `<div class="markdown-table-wrap">${Renderer.prototype.table.call(this, token)}</div>`;
};

marked.setOptions({
  async: false,
  breaks: true,
  gfm: true,
  renderer
});

export function renderMarkdown(value) {
  return marked.parse(String(value ?? ""));
}

function safeLink(value) {
  const href = String(value || "").trim();
  if (/^(?:https?:|mailto:)/i.test(href)) return true;
  return /^(?:#|\/)(?!\/)/.test(href);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
