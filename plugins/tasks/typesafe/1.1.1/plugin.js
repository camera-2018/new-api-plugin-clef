// SPDX-License-Identifier: Apache-2.0
// Derived from QuantumNous/new-api-plugins TypeSafe 1.1.0 (Apache-2.0).
// Community modification by camera-2018: completion-only wallet billing,
// strict response validation, bounded requests and direct vendor compatibility.
// Self-contained Task Plugin API v1 module, without imports or network calls.
const MAX_INPUT_TOKENS = 65536;
const MODELS = ["jev-1.13.0", "jev-latest", "jev-preview"];

export const meta = {
  apiVersion: 1, key: "typesafe", name: "TypeSafe Jev (postpaid)",
  version: "1.1.1", icon: "text:TS", sortPriority: 90,
  author: { name: "camera-2018", url: "https://github.com/camera-2018" },
  website: "https://github.com/camera-2018/new-api-plugin-clef",
  description: {
    en: "Community Jev System One adapter: bill validated input usage after synchronous inference",
    zh: "社区 Jev System One 适配：同步推理成功后按真实输入 token 结算",
  },
  baseUrl: "https://api.typesafe.ai", auth: "api_key", models: MODELS,
  upstreams: ["vendor", "new_api"], requiredCapabilities: ["json-order@1"],
  fetchMode: "per_task",
  routes: [{ method: "POST", path: "/typesafe/v1/systemone", type: "submit",
    decode: "decodeSystemOne", render: "renderSystemOne", retainResult: false }],
  usageSchema: { input_tokens: { type: "number", unit: "token",
    description: { en: "Input token unit price", zh: "输入 token 单价" } } },
  usageExamples: [{ label: "Jev", facts: { input_tokens: 1000 } }],
};

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function entry(value) { return value === null || typeof value === "string" || typeof value === "object"; }
function probability(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }

function validateRequest(body) {
  if (!object(body)) throw new Error("Request body must be a JSON object");
  if (!MODELS.includes(body.model)) throw new Error("Unsupported TypeSafe model; use a declared Jev model");
  if (Object.keys(body).some(key => !["model", "state", "questions", "stream"].includes(key)))
    throw new Error("Jev accepts only model, state, questions and stream:false; images, audio and chat fields are unsupported");
  if (!own(body, "state") || !entry(body.state)) throw new Error("state must be text, an object, an array or null");
  if (body.stream !== undefined && body.stream !== false) throw new Error("Jev does not support streaming");
  if (!object(body.questions) || Object.keys(body.questions).length < 1 || Object.keys(body.questions).length > 64)
    throw new Error("questions must contain between 1 and 64 questions");
  for (const id of Object.keys(body.questions)) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(id)) throw new Error("Invalid question ID");
    const q = body.questions[id];
    if (!object(q) || !["choice", "noul", "score"].includes(q.type)) throw new Error("Question type must be choice, noul or score");
    if (Object.keys(q).some(key => !["type", "instructions", "criteria"].includes(key))) throw new Error("Unsupported question field");
    if (q.instructions !== undefined && !entry(q.instructions)) throw new Error("Invalid question instructions");
    const criteria = q.criteria;
    if (q.type === "choice") {
      if (!object(criteria) || Object.keys(criteria).length < 1 || Object.keys(criteria).length > 255 ||
          Object.keys(criteria).some(key => !key.trim())) throw new Error("Choice requires 1 to 255 nonempty option IDs");
    } else if (q.type === "score") {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) throw new Error("Score requires 2 to 10 levels");
    } else if (criteria != null && (!object(criteria) || Object.keys(criteria).some(key => key !== "true" && key !== "false"))) {
      throw new Error("Noul criteria may only describe true and false");
    }
    if (criteria != null && Object.values(criteria).some(value => !entry(value))) throw new Error("Invalid criterion description");
  }
  return body;
}

function usage(body) {
  const tokens = body && body.usage && body.usage.input_tokens;
  if (!Number.isInteger(tokens) || tokens < 0 || tokens > MAX_INPUT_TOKENS)
    throw new Error("Jev usage.input_tokens is missing or outside 0..65536");
  return { input_tokens: tokens };
}

function validateAnswer(answer, q) {
  if (!object(answer) || answer.type !== q.type) throw new Error("Jev response is missing a matching answer");
  if (q.type === "noul") {
    if (!probability(answer.noul)) throw new Error("Jev noul answer must be a probability");
    return;
  }
  const keys = Object.keys(q.criteria);
  const probs = answer.probabilities;
  if (!object(probs) || Object.keys(probs).length !== keys.length ||
      !keys.every(k => own(probs, k) && probability(probs[k])) || !probability(answer.confidence))
    throw new Error("Jev response has invalid probabilities or confidence");
  if (Math.abs(keys.reduce((sum, k) => sum + probs[k], 0) - 1) > 0.002) throw new Error("Jev probabilities do not sum to 1");
  if (q.type === "choice") {
    if (typeof answer.choice !== "string" || !own(q.criteria, answer.choice) ||
        probs[answer.choice] + 0.002 < Math.max(...keys.map(k => probs[k]))) throw new Error("Jev choice does not match the requested options and probabilities");
  } else {
    const weighted = keys.reduce((sum, k) => sum + Number(k) * probs[k], 0);
    if (typeof answer.score !== "number" || !Number.isFinite(answer.score) ||
        answer.score < 0 || answer.score > keys.length - 1 || Math.abs(answer.score - weighted) > 0.01 ||
        !object(answer.legend) || Object.keys(answer.legend).length !== keys.length || !keys.every(k => own(answer.legend, k)))
      throw new Error("Jev score or legend does not match the requested rubric");
  }
}

export function buildSubmitRequest(ctx) {
  const body = validateRequest(ctx.requestBody);
  const model = ctx.upstreamModel || ctx.model;
  if (!MODELS.includes(model)) throw new Error("Unsupported upstream Jev model");
  if (typeof ctx.baseUrl !== "string" || !/^https?:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/.test(ctx.baseUrl))
    throw new Error("Configure a valid HTTP(S) Base URL without credentials, query or fragment");
  let base = ctx.baseUrl.replace(/\/+$/, "").replace(/(?:\/typesafe)?\/v1(?:\/systemone)?$/, "").replace(/\/typesafe$/, "");
  const prefix = ctx.upstream && ctx.upstream.kind === "new_api" ? "/typesafe" : "";
  if (typeof ctx.apiKey !== "string" || !ctx.apiKey.trim() || /[\r\n]/.test(ctx.apiKey)) throw new Error("Configure a valid channel API key");
  return { url: base + prefix + "/v1/systemone", method: "POST",
    headers: { Authorization: "Bearer " + ctx.apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: { model, state: body.state, questions: body.questions } };
}

export function parseSubmitResponse(ctx, response) {
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error("Jev upstream returned HTTP " + response.statusCode);
  const body = response.body;
  if (!object(body) || typeof body.model !== "string" || !object(body.answers)) throw new Error("Jev response is missing model or answers (HTML is not System One)");
  const expected = ctx.upstreamModel || ctx.model;
  if (body.model !== expected && !(["jev-latest", "jev-preview"].includes(expected) && /^jev-\d+\.\d+\.\d+$/.test(body.model)))
    throw new Error("The upstream served a different Jev model");
  const questions = validateRequest(ctx.requestBody).questions;
  if (Object.keys(body.answers).length !== Object.keys(questions).length) throw new Error("Jev answer IDs do not match");
  for (const id of Object.keys(questions)) validateAnswer(own(body.answers, id) ? body.answers[id] : null, questions[id]);
  // Validate usage BEFORE success: malformed responses cannot become free successes.
  usage(body);
  if (!ctx.publicTaskId) throw new Error("Missing gateway request ID");
  return { taskId: ctx.publicTaskId, taskData: body, immediate: { status: "SUCCESS", progress: "100%" } };
}

export function extractUsage(ctx) {
  validateRequest(ctx.requestBody);
  if (ctx.usagePurpose === "billing_ratios") return null;
  // Zero submission reservation, ONLY measured input is billed at completion.
  // Wallet billing has no pre-deduction; subscriptions may reserve a host minimum.
  return { input_tokens: 0 };
}
export function extractUsageOnComplete(ctx, result, body) { return usage(body); }
export function buildQueryRequest() { throw new Error("Jev System One has no asynchronous task retrieval endpoint"); }
export function parseTaskResult() { return { status: "UNKNOWN", reason: "Jev completes synchronously" }; }
export const native = {
  decodeSystemOne: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON request body required");
    const body = validateRequest(ctx.body.value);
    return { kind: "submit", model: body.model, action: "systemone", requestBody: body };
  },
  renderSystemOne: function (ctx, task) { return task.data; },
  error: function (ctx, error) { return { detail: error.message, code: error.code }; },
};
