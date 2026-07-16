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

describe("outputByteSize", () => {
  const { outputByteSize } = methods;

  it("treats null/undefined as zero", () => {
    expect(outputByteSize(null)).toBe(0);
    expect(outputByteSize(undefined)).toBe(0);
  });

  it("sizes a Buffer by its byte length", () => {
    const buf = Buffer.from("héllo"); // multi-byte char -> 6 bytes, 5 chars
    expect(outputByteSize(buf)).toBe(buf.length);
    expect(outputByteSize(buf)).toBe(6);
  });

  it("sizes a string by its UTF-8 byte length", () => {
    expect(outputByteSize("abc")).toBe(3);
    expect(outputByteSize("héllo")).toBe(6);
  });

  it("sizes an object by its serialized JSON byte length", () => {
    const obj = {
      a: 1,
    };
    expect(outputByteSize(obj)).toBe(Buffer.byteLength(JSON.stringify(obj)));
  });

  it("treats unserializable values as oversized (Infinity)", () => {
    const circular = {};
    circular.self = circular;
    expect(outputByteSize(circular)).toBe(Infinity);
  });
});

describe("capOutputRecord", () => {
  const KVS_ID = "store123";
  const KEY = "OUTPUT";
  const RECORD_URL = `https://api.apify.com/v2/key-value-stores/${KVS_ID}/records/${KEY}`;

  // Plain spy — `jest` is not injected as a global under the ESM VM-modules runner.
  function ctxWithUrl() {
    const calls = [];
    const getKVSRecordUrl = (...args) => {
      calls.push(args);
      return RECORD_URL;
    };
    getKVSRecordUrl.calls = calls;
    return makeCtx({
      apify: {
        getKVSRecordUrl,
      },
    });
  }

  it("returns undefined for a missing record", () => {
    const ctx = ctxWithUrl();
    expect(ctx.capOutputRecord(undefined, KVS_ID, KEY)).toBeUndefined();
    expect(ctx.capOutputRecord(null, KVS_ID, KEY)).toBeUndefined();
  });

  it("returns undefined when the record value is null", () => {
    const ctx = ctxWithUrl();
    expect(ctx.capOutputRecord({
      value: null,
    }, KVS_ID, KEY)).toBeUndefined();
  });

  it("returns a small string value unchanged", () => {
    const ctx = ctxWithUrl();
    const value = "small output";
    expect(ctx.capOutputRecord({
      value,
      contentType: "text/plain",
    }, KVS_ID, KEY)).toBe(value);
    expect(ctx.apify.getKVSRecordUrl.calls).toHaveLength(0);
  });

  it("returns a small object value unchanged", () => {
    const ctx = ctxWithUrl();
    const value = {
      hello: "world",
    };
    expect(ctx.capOutputRecord({
      value,
      contentType: "application/json",
    }, KVS_ID, KEY)).toBe(value);
  });

  it("returns a value that is exactly MAX_OUTPUT_BYTES inline (<= boundary)", () => {
    const ctx = ctxWithUrl();
    const value = "x".repeat(256 * 1024); // exactly the limit; 1 byte/char
    expect(ctx.capOutputRecord({
      value,
      contentType: "text/plain",
    }, KVS_ID, KEY)).toBe(value);
    expect(ctx.apify.getKVSRecordUrl.calls).toHaveLength(0);
  });

  it("caps a value that is one byte over MAX_OUTPUT_BYTES", () => {
    const ctx = ctxWithUrl();
    const value = "x".repeat(256 * 1024 + 1);
    const result = ctx.capOutputRecord({
      value,
      contentType: "text/plain",
    }, KVS_ID, KEY);
    expect(result.truncated).toBe(true);
    expect(result.size).toBe(Buffer.byteLength(value));
  });

  it("replaces an oversized string value with a reference object", () => {
    const ctx = ctxWithUrl();
    const value = "x".repeat(300 * 1024); // > MAX_OUTPUT_BYTES (256 KiB)
    const result = ctx.capOutputRecord({
      value,
      contentType: "text/html",
    }, KVS_ID, KEY);

    expect(result).toMatchObject({
      truncated: true,
      keyValueStoreId: KVS_ID,
      recordKey: KEY,
      contentType: "text/html",
      recordUrl: RECORD_URL,
    });
    expect(result.size).toBe(Buffer.byteLength(value));
    expect(typeof result.message).toBe("string");
    expect(ctx.apify.getKVSRecordUrl.calls).toEqual([
      [
        KVS_ID,
        KEY,
      ],
    ]);
  });

  it("replaces an oversized object value with a reference object", () => {
    const ctx = ctxWithUrl();
    const value = {
      blob: "y".repeat(300 * 1024),
    };
    const result = ctx.capOutputRecord({
      value,
      contentType: "application/json",
    }, KVS_ID, KEY);

    expect(result.truncated).toBe(true);
    expect(result.size).toBe(Buffer.byteLength(JSON.stringify(value)));
    expect(result.recordUrl).toBe(RECORD_URL);
  });

  it("sizes an oversized Buffer value by its byte length", () => {
    const ctx = ctxWithUrl();
    const value = Buffer.alloc(300 * 1024);
    const result = ctx.capOutputRecord({
      value,
      contentType: "application/octet-stream",
    }, KVS_ID, KEY);

    expect(result.truncated).toBe(true);
    expect(result.size).toBe(value.length);
  });
});
