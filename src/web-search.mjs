const DEFAULT_ENDPOINT = "https://api.bocha.cn/v1/web-search";
const FRESHNESS_VALUES = new Set(["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"]);

export class BochaSearchClient {
  constructor(config = {}) {
    this.endpoint = String(config.bochaSearchUrl || process.env.BOCHA_SEARCH_URL || DEFAULT_ENDPOINT).trim();
    this.apiKey = String(config.bochaApiKey || process.env.BOCHA_API_KEY || "").trim();
  }

  get configured() { return Boolean(this.apiKey); }

  configure({ bochaApiKey }) {
    this.apiKey = String(bochaApiKey || "").trim();
  }

  status() {
    return { configured: this.configured, provider: "bocha", endpoint: this.endpoint };
  }

  async search(input = {}, signal) {
    if (!this.configured) throw new Error("未配置 BOCHA_API_KEY，请在配置页填写博查搜索 Key");
    const query = String(input.query || "").trim();
    if (!query) throw new Error("搜索关键词不能为空");
    const freshness = FRESHNESS_VALUES.has(input.freshness) ? input.freshness : "noLimit";
    const count = Math.min(50, Math.max(1, Number.isInteger(Number(input.count)) ? Number(input.count) : 10));
    const summary = input.summary !== false;
    const timeout = AbortSignal.timeout(30000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(this.endpoint, {
      method: "POST",
      signal: requestSignal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ query, summary, freshness, count })
    });
    if (!response.ok) throw new Error(`博查搜索请求失败：HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.code != null && Number(payload.code) !== 200) throw new Error(`博查搜索请求失败：${String(payload.msg || "服务返回错误").slice(0, 300)}`);
    return normalizeResponse(payload, query);
  }
}

function normalizeResponse(payload, query) {
  const data = payload?.data || payload || {};
  const pages = data?.webPages?.value || data?.webpages?.value || data?.results || [];
  const results = Array.isArray(pages) ? pages.map((item) => ({
    title: String(item?.name || item?.title || ""),
    url: String(item?.url || ""),
    siteName: String(item?.siteName || item?.displayUrl || ""),
    snippet: String(item?.snippet || ""),
    summary: String(item?.summary || ""),
    datePublished: String(item?.datePublished || "")
  })).filter((item) => item.title || item.url || item.snippet || item.summary) : [];
  return {
    query,
    totalEstimatedMatches: Number(data?.webPages?.totalEstimatedMatches || data?.webpages?.totalEstimatedMatches || results.length),
    results
  };
}
