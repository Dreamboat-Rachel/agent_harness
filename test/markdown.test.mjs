import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../public/markdown.js";

test("assistant Markdown renders tables, lists and code", () => {
  const html = renderMarkdown(`**天气**\n\n| 城市 | 温度 |\n| --- | --- |\n| 杭州 | 19-24 C |\n\n- 阴天\n\n\`\`\`python\nprint("ok")\n\`\`\``);
  assert.match(html, /<strong>天气<\/strong>/);
  assert.match(html, /class="markdown-table-wrap"/);
  assert.match(html, /<th>城市<\/th>/);
  assert.match(html, /<li>阴天<\/li>/);
  assert.match(html, /language-python/);
});

test("assistant Markdown cannot inject HTML or unsafe links", () => {
  const html = renderMarkdown(`<script>alert(1)</script>\n\n[x](javascript:alert(2))\n\n![track](https://example.com/pixel.gif)`);
  assert.doesNotMatch(html, /<script|javascript:|<img/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /\[图片：track\]/);
});
