// SPDX-License-Identifier: Apache-2.0
// Derived from QuantumNous/new-api-plugins TypeSafe 1.1.0 (Apache-2.0).
// Modified by camera-2018: Clef models, Workers AI REST, images, validation,
// deployment-specific reservations and normalized synchronous responses.
// This module is self-contained: no imports, network calls or request globals.

// Reservation estimates, NOT tokenizer limits. Keep self-hosted values aligned
// with your server before serving larger contexts. Never take these from clients.
const SELF_HOSTED_RESERVE = { clef: 4096, "clef-flash": 4096 };
const CLOUD_CONTEXT = 65536;
const MODELS = ["clef", "clef-flash"];
const MIB = 1024 * 1024;

export const meta = {
  apiVersion: 1,
  key: "clef",
  name: "Cloudflare Clef",
  version: "1.0.0",
  icon: "text:CF",
  author: { name: "camera-2018", url: "https://github.com/camera-2018" },
  website: "https://github.com/camera-2018/new-api-plugin-clef",
  description: {
    en: "Clef and Clef-flash decisions through Workers AI or a self-hosted System One endpoint",
    zh: "通过 Workers AI 或自部署 System One 服务调用 Clef 与 Clef-flash",
  },
  auth: "api_key",
  models: MODELS,
  upstreams: ["vendor", "new_api"],
  requiredCapabilities: ["json-order@1"],
  fetchMode: "per_task",
  routes: [{
    method: "POST",
    path: "/clef/v1/systemone",
    type: "submit",
    decode: "decodeSystemOne",
    render: "renderSystemOne",
    retainResult: false,
  }],
  usageSchema: {
    input_tokens: {
      type: "number", unit: "token",
      description: { en: "Input token unit price", zh: "输入 token 单价" },
    },
  },
  usageExamples: [
    { label: "Clef", facts: { input_tokens: 1000 } },
    { label: "Clef-flash", facts: { input_tokens: 1000 } },
  ],
};

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function modelName(value) {
  if (typeof value !== "string") throw new Error("model must be clef or clef-flash");
  const name = value.replace(/^(?:@cf\/cloudflare\/|Cloudflare\/)/, "");
  if (!MODELS.includes(name)) throw new Error("Unsupported model; use clef or clef-flash");
  return name;
}

function imageBytes(image) {
  let mime;
  let data;
  if (typeof image === "string") {
    // No remote URLs: the plugin never fetches arbitrary image locations.
    const comma = image.indexOf(",");
    const header = image.slice(0, comma);
    const match = /^data:(image\/(?:png|jpeg|webp));base64$/i.exec(header);
    if (comma < 0 || !match) throw new Error("images must contain embedded PNG, JPEG or WebP base64 data, not remote URLs");
    mime = match[1].toLowerCase();
    data = image.slice(comma + 1);
  } else if (object(image)) {
    if (Object.keys(image).some(key => key !== "content_type" && key !== "base64"))
      throw new Error("Image objects accept only content_type and base64");
    mime = image.content_type;
    data = image.base64;
  } else {
    throw new Error("Each image must be a data URL or a base64 image object");
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime) || typeof data !== "string")
    throw new Error("Image content_type must be image/png, image/jpeg or image/webp with base64 data");
  if (!data.length || data.length > Math.ceil(4 * MIB / 3) * 4 || data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw new Error("Image base64 is invalid or exceeds 4 MiB decoded");
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = data.length / 4 * 3 - padding;
  if (bytes < 1 || bytes > 4 * MIB) throw new Error("Each image must be between 1 byte and 4 MiB decoded");
  return bytes;
}

function validateRequest(body) {
  if (!object(body)) throw new Error("Request body must be a JSON object");
  modelName(body.model);
  if (Object.keys(body).some(key => !["model", "state", "questions", "images", "stream"].includes(key)))
    throw new Error("Supported fields: model, state, questions, images, stream:false; video and chat fields are not supported");
  if (!own(body, "state") || body.state === undefined) throw new Error("state is required (text or JSON, including null)");
  if (body.stream !== undefined && body.stream !== false) throw new Error("Clef System One does not support streaming");
  if (!object(body.questions)) throw new Error("questions must be an object containing 1 to 64 questions");
  const ids = Object.keys(body.questions);
  if (ids.length < 1 || ids.length > 64) throw new Error("questions must contain 1 to 64 questions");
  for (const id of ids) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(id)) throw new Error("Question IDs must be 1–100 letters, digits, underscores, dots or hyphens");
    const q = body.questions[id];
    if (!object(q) || !["choice", "score", "noul"].includes(q.type))
      throw new Error("Each question must have type choice, score or noul");
    if (Object.keys(q).some(key => !["type", "instructions", "criteria"].includes(key)))
      throw new Error("Questions accept only type, instructions and criteria");
    if (q.instructions !== undefined && q.instructions !== null &&
        !((typeof q.instructions === "string" && q.instructions.trim()) || typeof q.instructions === "object"))
      throw new Error("instructions must be nonempty text, an object, an array or null");
    const criteria = q.criteria;
    if (q.type === "choice") {
      if (!object(criteria) || Object.keys(criteria).length < 2 || Object.keys(criteria).length > 255 ||
          Object.keys(criteria).some(key => !key.trim()))
        throw new Error("Choice criteria must contain 2 to 255 nonempty option IDs");
    } else if (q.type === "score") {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10)
        throw new Error("Score criteria must contain 2 to 10 ordered levels");
    } else if (criteria !== undefined && criteria !== null &&
               (!object(criteria) || Object.keys(criteria).some(key => key !== "true" && key !== "false"))) {
      throw new Error("Noul criteria may only describe true and false");
    }
  }
  if (body.images !== undefined) {
    if (!Array.isArray(body.images) || body.images.length > 4) throw new Error("images must be an array of at most 4 embedded images");
    if (body.images.reduce((total, image) => total + imageBytes(image), 0) > 8 * MIB)
      throw new Error("Total decoded image size must not exceed 8 MiB");
  }
  return body;
}

function upstream(ctx) {
  if (typeof ctx.baseUrl !== "string" || !/^https?:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/.test(ctx.baseUrl))
    throw new Error("Set a valid HTTP(S) channel Base URL without credentials, query or fragment");
  const base = ctx.baseUrl.replace(/\/+$/, "");
  if (ctx.upstream && ctx.upstream.kind === "new_api") {
    return { url: base.replace(/(?:\/clef)?\/v1(?:\/systemone)?$/, "").replace(/\/clef$/, "") + "/clef/v1/systemone", cloud: false, gateway: true };
  }
  const cloud = /\/client\/v4\/accounts\/([a-fA-F0-9]{32})\/ai(?:\/run)?$/.exec(base);
  if (cloud) return { url: base.replace(/\/run$/, "") + "/run/@cf/cloudflare/" + modelName(ctx.upstreamModel || ctx.model), cloud: true };
  if (/^https?:\/\/api\.cloudflare\.com(?:\/|$)/i.test(base) || /\/client\/v4\/accounts\//.test(base))
    throw new Error("Workers AI Base URL must end in /client/v4/accounts/<32-character-account-id>/ai");
  return { url: base.replace(/\/v1(?:\/systemone)?$/, "") + "/v1/systemone", cloud: false };
}

function requestBody(ctx) {
  const body = validateRequest(ctx.requestBody);
  const questions = Object.create(null);
  for (const id of Object.keys(body.questions)) {
    const q = body.questions[id];
    const normalized = { type: q.type, instructions: q.instructions == null ? id : q.instructions };
    if (q.criteria !== undefined && q.criteria !== null) normalized.criteria = q.criteria;
    questions[id] = normalized;
  }
  const output = { model: modelName(ctx.upstreamModel || ctx.model), state: body.state, questions: questions };
  if (body.images !== undefined) output.images = body.images;
  return output;
}

export function buildSubmitRequest(ctx) {
  const target = upstream(ctx);
  const key = ctx.apiKey;
  if (typeof key !== "string" || !key.trim() || /[\r\n]/.test(key)) throw new Error("Configure a valid channel API key");
  return {
    url: target.url, method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "application/json" },
    body: requestBody(ctx),
  };
}

function usage(body) {
  const tokens = body && body.usage && body.usage.input_tokens;
  if (!Number.isInteger(tokens) || tokens < 0 || tokens > CLOUD_CONTEXT)
    throw new Error("Clef response usage.input_tokens must be an integer between 0 and 65536");
  return { input_tokens: tokens };
}

function probability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateAnswer(answer, question) {
  if (!object(answer) || answer.type !== question.type) throw new Error("Clef response is missing a matching answer");
  if (question.type === "noul") {
    if (!probability(answer.noul)) throw new Error("Clef noul answer must be a probability between 0 and 1");
    return;
  }
  const keys = Object.keys(question.criteria);
  if (!object(answer.probabilities) || Object.keys(answer.probabilities).length !== keys.length ||
      !keys.every(key => own(answer.probabilities, key) && probability(answer.probabilities[key])) ||
      !probability(answer.confidence)) throw new Error("Clef response has invalid probabilities or confidence");
  const sum = keys.reduce((total, key) => total + answer.probabilities[key], 0);
  if (Math.abs(sum - 1) > 0.001) throw new Error("Clef answer probabilities must sum to 1");
  if (question.type === "choice") {
    if (typeof answer.choice !== "string" || !own(question.criteria, answer.choice))
      throw new Error("Clef choice is not one of the requested options");
  } else if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > keys.length - 1 ||
             !object(answer.legend) || !keys.every(key => own(answer.legend, key))) {
    throw new Error("Clef score or legend is outside the requested rubric");
  }
}

export function parseSubmitResponse(ctx, response) {
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error("Clef upstream returned HTTP " + response.statusCode);
  let body = response.body;
  // Workers AI REST wraps results; local System One and New API return them raw.
  if (object(body) && own(body, "success")) {
    if (body.success !== true || !object(body.result)) throw new Error("Cloudflare Workers AI reported an unsuccessful response");
    body = body.result;
  }
  if (!object(body) || typeof body.model !== "string" || !object(body.answers))
    throw new Error("Clef response is missing model or answers");
  if (modelName(body.model) !== modelName(ctx.upstreamModel || ctx.model))
    throw new Error("The upstream served a different model; check the channel and server model alias");
  const questions = validateRequest(ctx.requestBody).questions;
  for (const id of Object.keys(questions)) validateAnswer(own(body.answers, id) ? body.answers[id] : null, questions[id]);
  // Fail malformed successful responses before marking success, instead of
  // retaining a guessed charge when real input usage is missing.
  usage(body);
  if (!ctx.publicTaskId) throw new Error("Missing gateway request ID");
  return { taskId: ctx.publicTaskId, taskData: body, immediate: { status: "SUCCESS", progress: "100%" } };
}

export function extractUsage(ctx) {
  validateRequest(ctx.requestBody);
  const model = modelName(ctx.upstreamModel || ctx.model);
  if (ctx.usagePurpose === "billing_ratios") return null;
  const target = upstream(ctx);
  // A downstream gateway's context is unknown; reserve the published ceiling.
  return { input_tokens: target.cloud || target.gateway ? CLOUD_CONTEXT : SELF_HOSTED_RESERVE[model] };
}

export function extractUsageOnComplete(ctx, result, body) {
  return usage(body);
}

export function buildQueryRequest() {
  throw new Error("Clef System One completes synchronously and has no task retrieval endpoint");
}

export function parseTaskResult() {
  return { status: "UNKNOWN", reason: "Clef System One has no asynchronous tasks" };
}

export const native = {
  decodeSystemOne: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON request body required");
    const body = validateRequest(ctx.body.value);
    return { kind: "submit", model: body.model, action: "systemone", requestBody: body };
  },
  renderSystemOne: function (ctx, task) { return task.data; },
  error: function (ctx, error) { return { detail: error.message, code: error.code }; },
};
