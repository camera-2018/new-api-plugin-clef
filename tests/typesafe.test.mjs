import test from "node:test";
import assert from "node:assert/strict";
import * as plugin from "../plugins/tasks/typesafe/1.1.1/plugin.js";

const context = (model = "jev-1.13.0") => ({
  model, upstreamModel: model, baseUrl: "https://vendor.example/v1", apiKey: "synthetic-key",
  publicTaskId: "request-test", upstream: { kind: "vendor" },
  requestBody: { model, state: { z: "My order was delivered to the wrong address", a: "Please redeliver" }, questions: {
    route: { type: "choice", instructions: "Department?", criteria: { shipping: "Delivery", billing: "Payments" } },
    reply: { type: "noul", instructions: "Needs a reply?" },
    urgency: { type: "score", instructions: "Urgent?", criteria: ["Can wait", "Today", "Now"] },
  } },
});
const response = (model = "jev-1.13.0") => ({ statusCode: 200, body: {
  model, answers: {
    route: { type: "choice", choice: "shipping", probabilities: { shipping: 0.9, billing: 0.1 }, confidence: 0.8 },
    reply: { type: "noul", noul: 0.9 },
    urgency: { type: "score", score: 1.1, confidence: 0.7, legend: { 0: "Can wait", 1: "Today", 2: "Now" }, probabilities: { 0: 0.1, 1: 0.7, 2: 0.2 } },
  }, usage: { input_tokens: 321, output_tokens: 31 },
} });

test("Jev manifest is separate from Clef and does not retain response data", () => {
  assert.equal(plugin.meta.key, "typesafe");
  assert.equal(plugin.meta.version, "1.1.1");
  assert.equal(plugin.meta.routes[0].path, "/typesafe/v1/systemone");
  assert.equal(plugin.meta.routes[0].retainResult, false);
  assert.deepEqual(plugin.meta.requiredCapabilities, ["json-order@1"]);
});
for (const model of plugin.meta.models) {
  test(`${model}: zero submission reservation and measured completion billing`, () => {
    const ctx = context(model);
    const parsed = plugin.parseSubmitResponse(ctx, response());
    assert.equal(parsed.immediate.status, "SUCCESS");
    assert.deepEqual(plugin.extractUsage(ctx), { input_tokens: 0 });
    assert.equal(plugin.extractUsage({ ...ctx, usagePurpose: "billing_ratios" }), null);
    assert.deepEqual(plugin.extractUsageOnComplete(ctx, parsed, parsed.taskData), { input_tokens: 321 });
    assert.equal(plugin.native.renderSystemOne({}, { data: parsed.taskData }), parsed.taskData);
  });
}
for (const kind of ["vendor", "new_api"]) {
  for (const suffix of ["", "/", "/v1", "/v1/systemone", "/typesafe", "/typesafe/v1"]) {
    test(`${kind}: normalize ${suffix || "root"} and preserve state order`, () => {
      const ctx = context();
      ctx.baseUrl = "https://vendor.example" + suffix;
      ctx.upstream.kind = kind;
      const request = plugin.buildSubmitRequest(ctx);
      assert.equal(request.url, `https://vendor.example${kind === "new_api" ? "/typesafe" : ""}/v1/systemone`);
      assert.deepEqual(Object.keys(request.body.state), ["z", "a"]);
      assert.deepEqual(Object.keys(request.body.questions), ["route", "reply", "urgency"]);
      assert.equal(request.headers.Authorization, "Bearer synthetic-key");
    });
  }
}
for (const [name, change] of [
  ["missing state", b => delete b.state],
  ["numeric state", b => b.state = 3],
  ["unsupported model", b => b.model = "clef-flash"],
  ["chat payload", b => b.messages = []],
  ["images", b => b.images = []],
  ["stream", b => b.stream = true],
  ["empty questions", b => b.questions = {}],
  ["bad type", b => b.questions.route.type = "text"],
  ["no choice options", b => b.questions.route.criteria = {}],
  ["one score level", b => b.questions.urgency.criteria = ["one"]],
  ["bad noul rubric", b => b.questions.reply.criteria = { yes: "yes" }],
  ["invalid instructions", b => b.questions.route.instructions = 3],
  ["invalid criteria description", b => b.questions.route.criteria.shipping = 3],
]) {
  test(`reject request: ${name}`, () => {
    const ctx = context(); change(ctx.requestBody);
    assert.throws(() => plugin.native.decodeSystemOne({ body: { kind: "json", value: ctx.requestBody } }));
    assert.throws(() => plugin.extractUsage(ctx));
  });
}
for (const [name, change] of [
  ["HTML success", r => r.body = "<html>not an API</html>"],
  ["upstream 429", r => r.statusCode = 429],
  ["wrong pin", r => r.body.model = "jev-0.0.1"],
  ["missing answer", r => delete r.body.answers.reply],
  ["extra answer", r => r.body.answers.other = {}],
  ["wrong type", r => r.body.answers.route.type = "noul"],
  ["bogus choice", r => r.body.answers.route.choice = "unknown"],
  ["non-argmax choice", r => r.body.answers.route.choice = "billing"],
  ["NaN probability", r => r.body.answers.route.probabilities.shipping = NaN],
  ["wrong probability sum", r => r.body.answers.route.probabilities.shipping = 0.1],
  ["extra probability", r => r.body.answers.route.probabilities.other = 0],
  ["bad confidence", r => r.body.answers.route.confidence = -1],
  ["bad noul", r => r.body.answers.reply.noul = true],
  ["wrong score expectation", r => r.body.answers.urgency.score = 0],
  ["bad legend", r => delete r.body.answers.urgency.legend["1"]],
  ["missing usage", r => delete r.body.usage],
  ["fractional usage", r => r.body.usage.input_tokens = 0.5],
  ["negative usage", r => r.body.usage.input_tokens = -1],
  ["over context", r => r.body.usage.input_tokens = 65537],
]) {
  test(`fail before successful settlement: ${name}`, () => {
    const r = response(); change(r);
    assert.throws(() => plugin.parseSubmitResponse(context(), r));
    assert.deepEqual(plugin.extractUsage(context()), { input_tokens: 0 });
  });
}
for (const tokens of [undefined, null, -1, 0.5, NaN, Infinity, "321", true, 65537]) {
  test(`completion never substitutes guessed usage: ${String(tokens)}`, () => {
    assert.throws(() => plugin.extractUsageOnComplete({}, {}, { usage: { input_tokens: tokens } }));
  });
}
for (const base of ["file:///tmp/x", "https://user:secret@vendor.example", "https://vendor.example?key=x", "https://vendor.example#x"]) {
  test(`reject invalid channel URL: ${base}`, () => {
    assert.throws(() => plugin.buildSubmitRequest({ ...context(), baseUrl: base }));
  });
}
