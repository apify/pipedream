import component from "./run-actor.mjs";

const { methods } = component;

// Build a `this` context for methods/additionalProps. `getSchema` is mocked so
// the tests never touch a live Apify client; everything else uses the real code.
function makeCtx(overrides = {}) {
  return {
    ...methods,
    actorId: "user/actor",
    buildTag: undefined,
    runAsynchronously: true,
    webhook: undefined,
    ...overrides,
  };
}

describe("getType", () => {
  const { getType } = methods;

  it("maps Apify \"number\" to Pipedream \"string\" (no float type)", () => {
    expect(getType("number")).toBe("string");
  });

  it("passes through supported primitive types", () => {
    expect(getType("string")).toBe("string");
    expect(getType("integer")).toBe("integer");
    expect(getType("object")).toBe("object");
    expect(getType("boolean")).toBe("boolean");
  });

  it("falls back to \"string[]\" for unknown types", () => {
    expect(getType("array")).toBe("string[]");
    expect(getType(undefined)).toBe("string[]");
  });
});

describe("prepareData", () => {
  const { prepareData } = methods;

  it("returns the raw input unchanged when the Actor has no schema", async () => {
    const ctx = makeCtx({
      getSchema: async () => {
        throw new Error("No input schema found for actor");
      },
    });
    const raw = {
      foo: "bar",
    };
    await expect(prepareData.call(ctx, raw)).resolves.toEqual(raw);
    await expect(prepareData.call(ctx, {})).resolves.toEqual({});
  });

  it("coerces numeric fields to numbers", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          count: {
            type: "number",
          },
          length: {
            type: "integer",
          },
        },
        required: [],
      }),
    });
    const result = await prepareData.call(ctx, {
      count: "12",
      length: "8",
    });
    expect(result).toEqual({
      count: 12,
      length: 8,
    });
    expect(typeof result.count).toBe("number");
    expect(typeof result.length).toBe("number");
  });

  it("coerces fractional \"number\" values (string fallback) to floats", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          ratio: {
            type: "number",
          },
        },
        required: [],
      }),
    });
    const result = await prepareData.call(ctx, {
      ratio: "3.5",
    });
    expect(result.ratio).toBe(3.5);
  });

  it("coerces arrays of numeric values element-wise", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          sizes: {
            type: "integer",
          },
        },
        required: [],
      }),
    });
    const result = await prepareData.call(ctx, {
      sizes: [
        "1",
        "2",
        "3",
      ],
    });
    expect(result.sizes).toEqual([
      1,
      2,
      3,
    ]);
  });

  it("routes non-numeric fields through setValue and skips undefined values", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          name: {
            type: "string",
          },
          startUrls: {
            type: "array",
            editor: "requestListSources",
          },
          missing: {
            type: "string",
          },
        },
        required: [],
      }),
    });
    const result = await prepareData.call(ctx, {
      name: "hello",
      startUrls: [
        "https://a.com",
      ],
      // `missing` intentionally absent
    });
    expect(result).toEqual({
      name: "hello",
      startUrls: [
        {
          url: "https://a.com",
        },
      ],
    });
    expect(result).not.toHaveProperty("missing");
  });

  it("drops user-supplied fields that are not in the schema", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          name: {
            type: "string",
          },
        },
        required: [],
      }),
    });
    const result = await prepareData.call(ctx, {
      name: "hi",
      extra: "gone",
    });
    expect(result).toEqual({
      name: "hi",
    });
    expect(result).not.toHaveProperty("extra");
  });
});

describe("setValue", () => {
  const { setValue } = methods;

  it("wraps pseudoUrls editor values", () => {
    expect(setValue("pseudoUrls", "http://x.com/*")).toEqual({
      purl: "http://x.com/*",
    });
  });

  it("wraps globs editor values", () => {
    expect(setValue("globs", "**/*.html")).toEqual({
      glob: "**/*.html",
    });
  });

  it("parses JSON strings for the json editor", () => {
    expect(setValue("json", "{\"a\":1}")).toEqual({
      a: 1,
    });
  });

  it("parses JSON strings for the schemaBased editor", () => {
    expect(setValue("schemaBased", "{\"b\":2}")).toEqual({
      b: 2,
    });
  });

  it("throws on malformed JSON for the json editor", () => {
    expect(() => setValue("json", "not-json")).toThrow();
  });

  it("returns the value unchanged for an unknown editor", () => {
    expect(setValue("hidden", "plain")).toBe("plain");
  });
});

describe("additionalProps", () => {
  it("renders an Apify \"number\" field as a string prop (no float type in Pipedream)", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          ratio: {
            type: "number",
            title: "Ratio",
            description: "A decimal value",
            minimum: 0.5,
            maximum: 10,
          },
        },
        required: [
          "ratio",
        ],
      }),
    });
    const props = await component.additionalProps.call(ctx);
    expect(props.ratio.type).toBe("string");
    expect(props.ratio.optional).toBe(false);
    expect(props.ratio.min).toBeUndefined();
    expect(props.ratio.max).toBeUndefined();
  });

  it("renders an Apify \"integer\" field with min/max as an integer prop", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          count: {
            type: "integer",
            title: "Count",
            description: "How many",
            minimum: 1,
            maximum: 10,
          },
        },
        required: [
          "count",
        ],
      }),
    });
    const props = await component.additionalProps.call(ctx);
    expect(props.count.type).toBe("integer");
    expect(props.count.min).toBe(1);
    expect(props.count.max).toBe(10);
    expect(props.count.optional).toBe(false);
  });

  it("produces a friendly, usable fallback prop when the Actor has no schema", async () => {
    const ctx = makeCtx({
      getSchema: async () => {
        throw new Error("No input schema found for actor");
      },
    });
    const props = await component.additionalProps.call(ctx);
    expect(props.properties).toBeDefined();
    expect(props.properties.type).toBe("object");
    expect(props.properties.optional).toBe(true);
    expect(props.properties.default).toEqual({});
    expect(props.properties.description).toMatch(/no input schema/i);
  });

  it("builds options from enum/enumTitles", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          mode: {
            type: "string",
            title: "Mode",
            enum: [
              "fast",
              "slow",
            ],
            enumTitles: [
              "Fast",
              "Slow",
            ],
          },
        },
        required: [],
      }),
    });
    const props = await component.additionalProps.call(ctx);
    expect(props.mode.options).toEqual([
      {
        value: "fast",
        label: "Fast",
      },
      {
        value: "slow",
        label: "Slow",
      },
    ]);
  });

  it("maps a requestListSources prefill to its default URLs", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          startUrls: {
            type: "array",
            title: "Start URLs",
            editor: "requestListSources",
            prefill: [
              {
                url: "https://a.com",
              },
              {
                url: "https://b.com",
              },
            ],
          },
        },
        required: [],
      }),
    });
    const props = await component.additionalProps.call(ctx);
    expect(props.startUrls.type).toBe("string[]");
    expect(props.startUrls.default).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("JSON-stringifies prefill items for a json-editor array field", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          configs: {
            type: "array",
            title: "Configs",
            editor: "json",
            prefill: [
              {
                a: 1,
              },
              {
                b: 2,
              },
            ],
          },
        },
        required: [],
      }),
    });
    const props = await component.additionalProps.call(ctx);
    expect(props.configs.default).toEqual([
      "{\"a\":1}",
      "{\"b\":2}",
    ]);
  });

  it("marks secret string fields", async () => {
    const ctx = makeCtx({
      getSchema: async () => ({
        properties: {
          apiKey: {
            type: "string",
            title: "Key",
            isSecret: true,
          },
        },
        required: [],
      }),
    });
    const props = await component.additionalProps.call(ctx);
    expect(props.apiKey.secret).toBe(true);
  });

  it("includes outputRecordKey when runAsynchronously is false", async () => {
    const ctx = makeCtx({
      runAsynchronously: false,
      getSchema: async () => ({
        properties: {},
        required: [],
      }),
    });
    const props = await component.additionalProps.call(ctx);
    expect(props.outputRecordKey).toBeDefined();
    expect(props.outputRecordKey.default).toBe("OUTPUT");
  });

  it("includes eventTypes when a webhook is set", async () => {
    const ctx = makeCtx({
      webhook: "https://example.com/hook",
      getSchema: async () => ({
        properties: {},
        required: [],
      }),
    });
    const props = await component.additionalProps.call(ctx);
    expect(props.eventTypes).toBeDefined();
    expect(props.eventTypes.type).toBe("string[]");
  });
});
