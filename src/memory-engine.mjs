import { createHash, randomUUID } from "node:crypto";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { cosineSimilarity } from "./embeddings.mjs";

const RecallState = Annotation.Root({
  query: Annotation(),
  limit: Annotation(),
  facts: Annotation(),
  graph: Annotation(),
  context: Annotation()
});

const LearnState = Annotation.Root({
  text: Annotation(),
  sessionId: Annotation(),
  sourceMessageId: Annotation(),
  sourceDocumentId: Annotation(),
  sourceDocumentName: Annotation(),
  seed: Annotation(),
  extracted: Annotation(),
  validated: Annotation(),
  stored: Annotation()
});

export class MemoryEngine {
  constructor(store, { extractor, embedder } = {}) {
    this.store = store;
    this.extractor = extractor;
    this.embedder = embedder;
    this.recallGraph = this.#buildRecallGraph();
    this.learnGraph = this.#buildLearnGraph();
  }

  #buildRecallGraph() {
    return new StateGraph(RecallState)
      .addNode("semantic_search", async (state) => ({ facts: await this.#rankFacts(state.query, state.limit) }))
      .addNode("graph_expand", async (state) => ({ graph: this.#rankGraph(state.query, state.facts, state.limit) }))
      .addNode("compose_context", async (state) => ({ context: composeContext(state.facts, state.graph) }))
      .addEdge(START, "semantic_search")
      .addEdge("semantic_search", "graph_expand")
      .addEdge("graph_expand", "compose_context")
      .addEdge("compose_context", END)
      .compile();
  }

  #buildLearnGraph() {
    return new StateGraph(LearnState)
      .addNode("extract", async (state) => ({ extracted: state.seed || await this.#extract(state.text) }))
      .addNode("validate", async (state) => {
        const validated = validateExtraction(state.extracted);
        if (!state.seed) {
          validated.facts = validated.facts.filter((fact) => fact.confidence >= 0.8).slice(0, 8);
          validated.relations = validated.relations.filter((relation) => relation.confidence >= 0.8 && validated.facts.some((fact) => supportsRelation(fact, relation))).slice(0, 12);
        }
        return { validated };
      })
      .addNode("persist", async (state) => ({ stored: this.#persist(state.validated, state) }))
      .addEdge(START, "extract")
      .addEdge("extract", "validate")
      .addEdge("validate", "persist")
      .addEdge("persist", END)
      .compile();
  }

  async recall(query, { limit = 8, touch = true } = {}) {
    const result = await this.recallGraph.invoke({ query: clean(query, 4000), limit: bound(limit, 1, 30) });
    if (touch && result.facts?.length) this.store.touchMemoryFacts(result.facts.map((fact) => fact.id));
    return { facts: result.facts || [], graph: result.graph || { entities: [], relations: [] }, context: result.context || "" };
  }

  async learn({ text = "", sessionId = null, sourceMessageId = null, sourceDocumentId = null, sourceDocumentName = null, facts, relations } = {}) {
    const seed = facts || relations ? { facts: facts || [], relations: relations || [] } : null;
    const result = await this.learnGraph.invoke({ text: clean(text, 30000), sessionId, sourceMessageId, sourceDocumentId, sourceDocumentName, seed });
    const stored = result.stored || { facts: [], entities: [], relations: [] };
    try { await this.#indexFacts(stored.facts); } catch { /* Keep learned facts if the vector service is unavailable. */ }
    this.store.insertMemoryEvent({
      id: randomUUID(), sessionId, eventType: seed ? "manual_learn" : "automatic_learn",
      inputExcerpt: clean(text, 1000), result: { facts: stored.facts.length, entities: stored.entities.length, relations: stored.relations.length }, createdAt: new Date().toISOString()
    });
    return stored;
  }

  status() {
    return this.embedder?.status?.() || { configured: false, mode: "lexical-fallback", model: "", lastError: "" };
  }

  async rememberFact(input, source = {}) {
    const content = clean(input.content, 4000);
    if (!content) throw new Error("memory content is required");
    const fact = {
      kind: input.kind || "fact", subject: input.subject || "user", predicate: input.predicate || "states",
      object: input.object || content, content, confidence: input.confidence ?? 1
    };
    const relations = input.relations || [{
      source: fact.subject,
      sourceType: fact.subject === "user" ? "person" : inferEntityType(fact.subject),
      predicate: fact.predicate,
      target: fact.object,
      targetType: input.targetType || "concept",
      targetIsValue: Boolean(input.targetIsValue),
      confidence: fact.confidence
    }];
    return await this.learn({ ...source, text: content, facts: [fact], relations });
  }

  async search(query, limit = 20) {
    return await this.recall(query, { limit, touch: Boolean(String(query || "").trim()) });
  }

  graph(query = "", limit = 100) {
    return this.#rankGraph(query, [], bound(limit, 1, 300));
  }

  async #rankFacts(query, limit) {
    const facts = this.store.memoryCandidates();
    const queryTokens = tokenize(query);
    let queryVector = null;
    let vectors = new Map();
    if (String(query).trim() && this.embedder?.configured && facts.length) {
      try {
        await this.#indexFacts(facts);
        vectors = new Map(this.store.memoryEmbeddings(this.embedder.indexKey || this.embedder.model).map((row) => [row.factId, row.vector]));
        [queryVector] = await this.embedder.embed([clean(query, 4000)], undefined, { textType: "query" });
      } catch { queryVector = null; }
    }
    const now = Date.now();
    return facts.map((fact) => {
      const haystack = `${fact.kind} ${fact.subject} ${fact.predicate} ${fact.object} ${fact.content}`.toLocaleLowerCase();
      const matches = queryTokens.filter((token) => haystack.includes(token)).length;
      const lexical = queryTokens.length ? matches / queryTokens.length : 0.35;
      const exact = query && haystack.includes(String(query).toLocaleLowerCase()) ? 0.35 : 0;
      const ageDays = Math.max(0, (now - Date.parse(fact.updatedAt)) / 86400000);
      const recency = 1 / (1 + ageDays / 30);
      const usage = Math.min(1, Math.log2(1 + Number(fact.accessCount || 0)) / 5);
      const vector = queryVector && vectors.get(fact.id);
      const vectorScore = vector ? Math.max(0, cosineSimilarity(queryVector, vector)) : null;
      const score = vectorScore === null
        ? lexical * 0.52 + exact + Number(fact.confidence) * 0.18 + recency * 0.18 + usage * 0.12
        : vectorScore * 0.72 + lexical * 0.08 + exact * 0.2 + Number(fact.confidence) * 0.08 + recency * 0.07 + usage * 0.05;
      return { ...fact, score: Number(score.toFixed(4)), vectorScore: vectorScore === null ? null : Number(vectorScore.toFixed(4)), retrieval: vectorScore === null ? "lexical" : "vector" };
    }).filter((fact) => queryTokens.length === 0 || fact.score >= (queryVector ? 0.1 : 0.2))
      .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async #indexFacts(facts) {
    if (!this.embedder?.configured || !facts.length) return;
    const indexKey = this.embedder.indexKey || this.embedder.model;
    const existing = new Set(this.store.memoryEmbeddings(indexKey).map((row) => row.factId));
    const missing = facts.filter((fact) => !existing.has(fact.id));
    for (let offset = 0; offset < missing.length; offset += 32) {
      const batch = missing.slice(offset, offset + 32);
      const vectors = await this.embedder.embed(batch.map((fact) => `${fact.kind}: ${fact.subject} ${fact.predicate} ${fact.object}. ${fact.content}`), undefined, { textType: "document" });
      for (let index = 0; index < batch.length; index += 1) {
        this.store.upsertMemoryEmbedding({ factId: batch[index].id, model: indexKey, vector: vectors[index] });
      }
    }
  }

  #rankGraph(query, facts, limit) {
    const graph = this.store.knowledgeGraph({ limit: Math.max(100, limit * 5) });
    const tokens = new Set([...tokenize(query), ...facts.flatMap((fact) => tokenize(`${fact.subject} ${fact.object}`))]);
    const matches = (value) => {
      const normalized = String(value || "").toLocaleLowerCase();
      return [...tokens].some((token) => normalized.includes(token) || token.includes(normalized));
    };
    const matchedIds = new Set(graph.entities.filter((entity) => tokens.size === 0 || matches(`${entity.normalizedName} ${entity.type}`)).map((entity) => entity.id));
    let relations = graph.relations.filter((relation) => tokens.size === 0 || matchedIds.has(relation.sourceEntityId) || matchedIds.has(relation.targetEntityId) || matches(`${relation.source} ${relation.predicate} ${relation.target || relation.targetValue}`));
    relations = relations.slice(0, limit * 2);
    for (const relation of relations) { matchedIds.add(relation.sourceEntityId); if (relation.targetEntityId) matchedIds.add(relation.targetEntityId); }
    const entities = graph.entities.filter((entity) => matchedIds.has(entity.id)).slice(0, limit);
    return { entities, relations };
  }

  async #extract(text) {
    if (this.extractor) {
      try {
        const extracted = await this.extractor(text);
        if (extracted && (Array.isArray(extracted.facts) || Array.isArray(extracted.relations))) return extracted;
      } catch { return { facts: [], relations: [] }; }
    }
    return deterministicExtraction(text);
  }

  #persist(extraction, state) {
    const now = new Date().toISOString();
    const stored = { facts: [], entities: [], relations: [] };
    const entityCache = new Map();
    const ensureEntity = (name, type = "concept") => {
      const normalizedName = normalizeName(name);
      if (!normalizedName) return null;
      if (entityCache.has(normalizedName)) return entityCache.get(normalizedName);
      const row = this.store.upsertEntity({ id: randomUUID(), normalizedName, name: clean(name, 240), type: clean(type, 80) || "concept", attributes: {}, createdAt: now, updatedAt: now });
      entityCache.set(normalizedName, row);
      stored.entities.push(row);
      return row;
    };

    for (const fact of extraction.facts) {
      const row = {
        id: randomUUID(), fingerprint: digest([fact.kind, fact.subject, fact.predicate, fact.object].map(normalizeName).join("|")),
        ...fact, sourceSessionId: state.sessionId || null, sourceMessageId: state.sourceMessageId || null, sourceDocumentId: state.sourceDocumentId || null, sourceDocumentName: state.sourceDocumentName || null, createdAt: now, updatedAt: now
      };
      stored.facts.push(this.store.upsertMemoryFact(row));
      if (fact.subject) ensureEntity(fact.subject, fact.subjectType || inferEntityType(fact.subject));
    }

    for (const relation of extraction.relations) {
      const source = ensureEntity(relation.source, relation.sourceType || inferEntityType(relation.source));
      if (!source) continue;
      const target = relation.targetIsValue ? null : ensureEntity(relation.target, relation.targetType || inferEntityType(relation.target));
      const targetValue = target ? "" : clean(relation.target, 500);
      const row = {
        id: randomUUID(), fingerprint: digest(`${source.id}|${normalizeName(relation.predicate)}|${target?.id || normalizeName(targetValue)}`), sourceEntityId: source.id,
        predicate: relation.predicate, targetEntityId: target?.id || null, targetValue, confidence: relation.confidence,
        sourceSessionId: state.sessionId || null, createdAt: now, updatedAt: now
      };
      const savedRelation = this.store.upsertRelation(row);
      stored.relations.push(savedRelation);
      for (const fact of stored.facts) {
        if (supportsRelation(fact, relation)) {
          this.store.linkRelationFact(savedRelation.id, fact.id);
        }
      }
    }
    return stored;
  }
}

function supportsRelation(fact, relation) {
  return normalizeName(fact.subject) === normalizeName(relation.source)
    && normalizeName(fact.predicate) === normalizeName(relation.predicate)
    && normalizeName(fact.object) === normalizeName(relation.target);
}

function validateExtraction(value) {
  const facts = Array.isArray(value?.facts) ? value.facts.map((fact) => {
    const content = clean(fact.content || [fact.subject, fact.predicate, fact.object].filter(Boolean).join(" "), 4000);
    return {
      kind: allow(fact.kind, ["preference", "profile", "project", "decision", "constraint", "fact"], "fact"),
      subject: clean(fact.subject || "user", 240), predicate: clean(fact.predicate || "states", 160),
      object: clean(fact.object || content, 1000), content, confidence: clampConfidence(fact.confidence),
      subjectType: clean(fact.subjectType || "", 80)
    };
  }).filter((fact) => fact.content && !looksSensitive(fact.content)) : [];
  const relations = Array.isArray(value?.relations) ? value.relations.map((relation) => ({
    source: clean(relation.source, 240), sourceType: clean(relation.sourceType || "", 80),
    predicate: clean(relation.predicate, 160), target: clean(relation.target, 500), targetType: clean(relation.targetType || "", 80),
    targetIsValue: Boolean(relation.targetIsValue), confidence: clampConfidence(relation.confidence)
  })).filter((relation) => relation.source && relation.predicate && relation.target && !looksSensitive(`${relation.source} ${relation.target}`)) : [];
  return { facts: facts.slice(0, 20), relations: relations.slice(0, 30) };
}

function deterministicExtraction(text) {
  const facts = [];
  const relations = [];
  const input = String(text || "").replace(/```[\s\S]*?```/g, "").split(/\n(?:Assistant|助手)\s*[:：]/i)[0];
  const patterns = [
    [/(?:记住|请记住)[：:\s]+?([^\n]{2,300})/giu, "fact", "user", "wants_remembered"],
    [/(?:我叫|我的名字是)[：:\s]*([^，。,.\n]{1,80})/giu, "profile", "user", "name"],
    [/(?:我喜欢|我偏好|我的偏好是)[：:\s]*([^。\n]{1,200})/giu, "preference", "user", "prefers"],
    [/(?:我不喜欢|我不想要)[：:\s]*([^。\n]{1,200})/giu, "preference", "user", "avoids"],
    [/(?:I prefer|I like)\s+([^.!?\n]{1,200})/giu, "preference", "user", "prefers"]
  ];
  for (const [pattern, kind, subject, predicate] of patterns) {
    for (const match of input.matchAll(pattern)) {
      const object = clean(match[1], 500);
      facts.push({ kind, subject, predicate, object, content: `${subject} ${predicate} ${object}`, confidence: 0.92 });
      relations.push({ source: subject, sourceType: "person", predicate, target: object, targetIsValue: true, confidence: 0.92 });
    }
  }
  for (const match of input.matchAll(/(?:^|[。\n])\s*([\p{L}\p{N}_-]{1,40})\s*项目\s*(?:使用|采用|基于)[：:\s]*([^，。,.\n]{1,80})/gu)) {
    const source = clean(match[1], 160); const target = clean(match[2], 160);
    if (!source || !target) continue;
    facts.push({ kind: "project", subject: source, predicate: "uses", object: target, content: `${source} uses ${target}`, confidence: 0.82 });
    relations.push({ source, sourceType: "project", predicate: "uses", target, targetType: "technology", confidence: 0.82 });
  }
  return { facts, relations };
}

function composeContext(facts, graph) {
  const sections = [];
  if (facts.length) sections.push(`Relevant semantic memories:\n${facts.map((fact) => `- ${fact.content} (confidence ${Number(fact.confidence).toFixed(2)})`).join("\n")}`);
  if (graph.relations.length) sections.push(`Related knowledge graph:\n${graph.relations.map((relation) => `- ${relation.source} --${relation.predicate}--> ${relation.target || relation.targetValue}`).join("\n")}`);
  return sections.join("\n\n");
}

function tokenize(value) {
  const text = String(value || "").toLocaleLowerCase().trim();
  if (!text) return [];
  const words = [];
  try {
    for (const item of new Intl.Segmenter("zh", { granularity: "word" }).segment(text)) if (item.isWordLike && item.segment.length > 1) words.push(item.segment);
  } catch { words.push(...text.split(/[^\p{L}\p{N}_-]+/u)); }
  const cjk = [...text.replace(/[^\p{Script=Han}]/gu, "")];
  for (let index = 0; index < cjk.length - 1; index += 1) words.push(`${cjk[index]}${cjk[index + 1]}`);
  return [...new Set(words.filter((word) => word.length > 1))].slice(0, 80);
}

function looksSensitive(value) {
  const text = String(value).toLocaleLowerCase();
  return /(api[_ -]?key|password|passwd|密码|密钥|token|secret|authorization\s*[:=]|bearer\s+[a-z0-9._-]+|身份证|银行卡|credit card|sk-[a-z0-9_-]{12,}|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/i.test(text);
}

function inferEntityType(name) { return normalizeName(name) === "user" ? "person" : "concept"; }
function normalizeName(value) { return clean(value, 240).toLocaleLowerCase().replace(/\s+/g, " "); }
function clean(value, limit) { return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, limit); }
function digest(value) { return createHash("sha256").update(String(value).toLocaleLowerCase()).digest("hex"); }
function clampConfidence(value) { const number = Number(value); return Number.isFinite(number) ? Math.max(0.1, Math.min(number, 1)) : 0.7; }
function bound(value, min, max) { const number = Number(value); return Math.max(min, Math.min(Number.isFinite(number) ? number : min, max)); }
function allow(value, choices, fallback) { return choices.includes(value) ? value : fallback; }

export { deterministicExtraction, validateExtraction };
