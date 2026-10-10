import test from "node:test";
import assert from "node:assert/strict";
import * as plugin from "../plugins/tasks/clef/1.0.1/plugin.js";

const account = "a".repeat(32);
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const ctx = (model = "clef-flash") => ({
  model, upstreamModel: model, baseUrl: "http://localhost:8080", apiKey: "test-only-placeholder",
  publicTaskId: "task_example", upstream: { kind: "vendor" },
  requestBody: { model, state: { z: "Need a refund", a: "Charged twice" }, questions: {
    route: { type: "choice", instructions: "Who should handle this?", criteria: { billing: "Refunds", support: "Software" } },
    reply: { type: "noul", instructions: "Does this need a reply?" },
    urgency: { type: "score", instructions: "How urgent?", criteria: ["Can wait", "Today", "Now"] },
  } },
});
const response = (model = "clef-flash", tokens = 353) => ({ statusCode: 200, body: {
  model, answers: {
    route: { type: "choice", choice: "billing", confidence: 0.8, probabilities: { billing: 0.9, support: 0.1 } },
    reply: { type: "noul", noul: 0.8 },
    urgency: { type: "score", score: 1.1, confidence: 0.5, legend: { 0: "Can wait", 1: "Today", 2: "Now" }, probabilities: { 0: 0.1, 1: 0.7, 2: 0.2 } },
  }, usage: { input_tokens: tokens, output_tokens: 0 },
} });

test("manifest uses independent identity, exact models and non-retained sync results", () => {
  assert.equal(plugin.meta.key, "clef");
  assert.deepEqual(plugin.meta.models, ["clef", "clef-flash"]);
  assert.equal(plugin.meta.routes[0].path, "/clef/v1/systemone");
  assert.equal(plugin.meta.routes[0].retainResult, false);
  assert.deepEqual(plugin.meta.requiredCapabilities, ["json-order@1"]);
});

for (const model of ["clef", "clef-flash"]) {
  test(`${model}: direct route and all three answers`, () => {
    const context = ctx(model);
    const request = plugin.buildSubmitRequest(context);
    assert.equal(request.url, "http://localhost:8080/v1/systemone");
    assert.equal(request.body.model, model);
    const result = plugin.parseSubmitResponse(context, response(model));
    assert.equal(result.immediate.status, "SUCCESS");
    assert.equal(result.taskId, "task_example");
    assert.deepEqual(plugin.extractUsageOnComplete({}, {}, result.taskData), { input_tokens: 353 });
  });
  test(`${model}: Workers AI URL, envelope, images and zero submission reservation`, () => {
    const context = ctx(model);
    context.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${account}/ai`;
    context.requestBody.images = [png];
    const request = plugin.buildSubmitRequest(context);
    assert.equal(request.url, `${context.baseUrl}/run/@cf/cloudflare/${model}`);
    assert.deepEqual(request.body.images, [png]);
    assert.equal(plugin.extractUsage(context).input_tokens, 0);
    const wrapped = { statusCode: 200, body: { success: true, errors: [], result: response(model).body } };
    assert.deepEqual(plugin.parseSubmitResponse(context, wrapped).taskData, response(model).body);
  });
}

for (const suffix of ["", "/", "/v1", "/v1/", "/v1/systemone"]) {
  test(`direct Base URL suffix ${suffix || "root"}`, () => {
    const context = ctx();
    context.baseUrl += suffix;
    assert.equal(plugin.buildSubmitRequest(context).url, "http://localhost:8080/v1/systemone");
  });
}
for (const suffix of ["", "/v1", "/clef", "/clef/v1", "/clef/v1/systemone"]) {
  test(`New API chain suffix ${suffix || "root"}`, () => {
    const context = ctx();
    context.baseUrl += suffix;
    context.upstream.kind = "new_api";
    assert.equal(plugin.buildSubmitRequest(context).url, "http://localhost:8080/clef/v1/systemone");
    assert.equal(plugin.extractUsage(context).input_tokens, 0);
  });
}
test("Workers AI accepts /ai/run and honors mapped model", () => {
  const context = ctx("clef");
  context.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/`;
  context.upstreamModel = "@cf/cloudflare/clef-flash";
  assert.equal(plugin.buildSubmitRequest(context).body.model, "clef-flash");
  assert.match(plugin.buildSubmitRequest(context).url, /\/run\/@cf\/cloudflare\/clef-flash$/);
  assert.equal(plugin.parseSubmitResponse(context, response()).immediate.status, "SUCCESS");
});
test("decoder and driver preserve input/order and do not mutate shared objects", () => {
  const context = ctx();
  const original = JSON.stringify(context);
  const decoded = plugin.native.decodeSystemOne({ body: { kind: "json", value: context.requestBody } });
  assert.equal(decoded.model, "clef-flash");
  const request = plugin.buildSubmitRequest(context);
  assert.deepEqual(Object.keys(request.body.state), ["z", "a"]);
  assert.deepEqual(Object.keys(request.body.questions), ["route", "reply", "urgency"]);
  assert.equal(JSON.stringify(context), original);
});
test("omitted instructions use question ID and explicit zero/null state is retained", () => {
  for (const value of [null, false, 0, "", [], {}]) {
    const context = ctx();
    context.requestBody.state = value;
    delete context.requestBody.questions.reply.instructions;
    assert.equal(plugin.buildSubmitRequest(context).body.questions.reply.instructions, "reply");
    assert.equal(plugin.buildSubmitRequest(context).body.state, value);
  }
});
test("special own-property keys stay data, not prototypes", () => {
  const context = ctx();
  context.requestBody.questions = JSON.parse('{"__proto__":{"type":"choice","criteria":{"__proto__":null,"constructor":null}}}');
  const q = plugin.buildSubmitRequest(context).body.questions;
  assert.ok(Object.hasOwn(q, "__proto__"));
  assert.ok(Object.hasOwn(q.__proto__.criteria, "__proto__"));
});

const requestFailures = [
  ["missing state", c => delete c.requestBody.state, /state is required/],
  ["streaming", c => c.requestBody.stream = true, /streaming/],
  ["chat fields", c => c.requestBody.messages = [], /Supported fields/],
  ["video", c => c.requestBody.videos = [], /video/],
  ["empty questions", c => c.requestBody.questions = {}, /1 to 64/],
  ["65 questions", c => c.requestBody.questions = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i), { type: "noul" }])), /1 to 64/],
  ["unsafe question ID", c => c.requestBody.questions["bad/id"] = { type: "noul" }, /Question IDs/],
  ["question type", c => c.requestBody.questions.reply.type = "text", /type choice/],
  ["unknown question field", c => c.requestBody.questions.reply.temperature = 1, /only type/],
  ["blank instructions", c => c.requestBody.questions.reply.instructions = " ", /instructions/],
  ["one option", c => c.requestBody.questions.route.criteria = { only: null }, /2 to 255/],
  ["empty option ID", c => c.requestBody.questions.route.criteria = { "": "bad", ok: null }, /2 to 255/],
  ["256 options", c => c.requestBody.questions.route.criteria = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), null])), /2 to 255/],
  ["one score level", c => c.requestBody.questions.urgency.criteria = ["a"], /2 to 10/],
  ["11 score levels", c => c.requestBody.questions.urgency.criteria = Array(11).fill(null), /2 to 10/],
  ["invalid noul", c => c.requestBody.questions.reply.criteria = { maybe: null }, /true and false/],
  ["remote image", c => c.requestBody.images = ["https://example.com/secret.png"], /embedded/],
  ["five images", c => c.requestBody.images = Array(5).fill(png), /at most 4/],
  ["image mime", c => c.requestBody.images = [{ content_type: "image/gif", base64: "AAAA" }], /content_type/],
  ["base64 syntax", c => c.requestBody.images = ["data:image/png;base64,!!!="], /base64/],
  ["extra image field", c => c.requestBody.images = [{ content_type: "image/png", base64: "AAAA", url: "http://example.com" }], /only content_type/],
  ["single large image", c => c.requestBody.images = ["data:image/png;base64," + "A".repeat(5592408)], /4 MiB/],
  ["images total size", c => c.requestBody.images = Array(3).fill("data:image/png;base64," + "A".repeat(4194304)), /8 MiB/],
  ["unknown model", c => c.upstreamModel = "not-clef", /Unsupported model/],
  ["invalid base URL", c => c.baseUrl = "file:///etc/passwd", /Base URL/],
  ["base credentials", c => c.baseUrl = "https://name:pass@example.com", /Base URL/],
  ["missing account", c => c.baseUrl = "https://api.cloudflare.com", /account-id/],
  ["bad account", c => c.baseUrl = "https://api.cloudflare.com/client/v4/accounts/invalid/ai", /account-id/],
  ["missing key", c => c.apiKey = "", /API key/],
  ["key newline", c => c.apiKey = "abc\nX: bad", /API key/],
];
for (const [name, mutate, pattern] of requestFailures) {
  test(`reject request: ${name}`, () => {
    const context = ctx();
    mutate(context);
    assert.throws(() => plugin.buildSubmitRequest(context), pattern);
  });
}

const responseFailures = [
  ["upstream HTTP error", r => r.statusCode = 429, /HTTP 429/],
  ["CF unsuccessful envelope", r => r.body = { success: false, errors: [] }, /unsuccessful/],
  ["missing body", r => r.body = null, /missing model/],
  ["wrong model", r => r.body.model = "clef", /different model/],
  ["missing question", r => delete r.body.answers.reply, /matching answer/],
  ["wrong type", r => r.body.answers.reply.type = "choice", /matching answer/],
  ["bad noul", r => r.body.answers.reply.noul = 2, /probability/],
  ["unknown choice", r => r.body.answers.route.choice = "nope", /requested options/],
  ["bad confidence", r => r.body.answers.route.confidence = -1, /confidence/],
  ["missing probability", r => delete r.body.answers.route.probabilities.support, /probabilities/],
  ["wrong probability sum", r => r.body.answers.route.probabilities.support = 0.5, /sum to 1/],
  ["score outside rubric", r => r.body.answers.urgency.score = 4, /rubric/],
  ["missing legend", r => delete r.body.answers.urgency.legend, /rubric/],
  ["missing usage", r => delete r.body.usage, /input_tokens/],
  ["string usage", r => r.body.usage.input_tokens = "353", /input_tokens/],
  ["negative usage", r => r.body.usage.input_tokens = -1, /input_tokens/],
  ["excessive usage", r => r.body.usage.input_tokens = 65537, /input_tokens/],
];
for (const [name, mutate, pattern] of responseFailures) {
  test(`reject response: ${name}`, () => {
    const reply = response();
    mutate(reply);
    assert.throws(() => plugin.parseSubmitResponse(ctx(), reply), pattern);
  });
}
test("zero submission reservation still bills measured nonzero and zero completions exactly", () => {
  assert.equal(plugin.extractUsage(ctx()).input_tokens, 0);
  assert.equal(plugin.extractUsage({ ...ctx(), usagePurpose: "billing_ratios" }), null);
  for (const n of [0, 353, 4096, 9000, 65536]) {
    const result = plugin.parseSubmitResponse(ctx(), response("clef-flash", n));
    assert.equal(plugin.extractUsageOnComplete({}, {}, result.taskData).input_tokens, n);
  }
});
test("postpaid mode never treats missing completion usage as free usage", () => {
  for (const model of ["clef", "clef-flash"]) {
    const context = ctx(model);
    assert.deepEqual(plugin.extractUsage(context), { input_tokens: 0 });
    const reply = response(model);
    delete reply.body.usage;
    assert.throws(() => plugin.parseSubmitResponse(context, reply), /input_tokens/);
    assert.throws(() => plugin.extractUsageOnComplete({}, {}, reply.body), /input_tokens/);
  }
});
test("JSON only, no polling, raw rendering and a simple error envelope", () => {
  assert.throws(() => plugin.native.decodeSystemOne({ body: { kind: "form" } }), /JSON/);
  assert.throws(() => plugin.buildQueryRequest(), /synchronously/);
  assert.equal(plugin.parseTaskResult().status, "UNKNOWN");
  const data = response().body;
  assert.equal(plugin.native.renderSystemOne({}, { data }), data);
  assert.deepEqual(plugin.native.error({}, { message: "test", code: "invalid" }), { detail: "test", code: "invalid" });
});
