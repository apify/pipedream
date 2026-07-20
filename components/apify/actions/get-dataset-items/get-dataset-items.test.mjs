import getDatasetItems from "./get-dataset-items.mjs";
import apify from "../../apify.app.mjs";
import { LIMIT } from "../../common/constants.mjs";

// Hand-rolled spy: jest.fn is not available under the ESM vm-modules runner.
// Models the real Apify endpoint — honors the offset/limit paging params — so
// the pagination loop is exercised the same way it runs live.
function makeApify(dataset, { maxCalls = 100 } = {}) {
  const calls = [];
  return {
    calls,
    listDatasetItems({
      datasetId, params,
    }) {
      calls.push({
        datasetId,
        params,
      });
      if (calls.length > maxCalls) {
        throw new Error(`listDatasetItems called ${calls.length} times — likely infinite loop`);
      }
      const {
        offset = 0, limit,
      } = params;
      const end = limit === undefined
        ? undefined
        : offset + limit;
      return Promise.resolve({
        items: dataset.slice(offset, end),
      });
    },
  };
}

function makeContext(dataset, props, opts) {
  const spy = makeApify(dataset, opts);
  const exported = {};
  const ctx = {
    ...getDatasetItems,
    apify: spy,
    datasetId: "ds_test",
    clean: undefined,
    fields: undefined,
    omit: undefined,
    offset: undefined,
    limit: undefined,
    ...props,
  };
  const $ = {
    export: (key, value) => {
      exported[key] = value;
    },
  };
  return {
    ctx,
    spy,
    exported,
    run: () => getDatasetItems.run.call(ctx, {
      $,
    }),
  };
}

const dataset = (n) => Array.from({
  length: n,
}, (_, i) => ({
  i,
}));

test("limit caps the number of returned items across a large dataset", async () => {
  const {
    run, spy, exported,
  } = makeContext(dataset(150), {
    limit: 2,
  });
  const results = await run();
  expect(results).toHaveLength(2);
  // Only the needed page is fetched, sized to the limit.
  expect(spy.calls).toHaveLength(1);
  expect(spy.calls[0].params.limit).toBe(2);
  // Summary reports the count (plural form here).
  expect(exported["$summary"]).toMatch(/retrieved 2 items/);
});

test("limit larger than the dataset returns everything and stops on the short page", async () => {
  const {
    run, spy,
  } = makeContext(dataset(50), {
    limit: 500,
  });
  const results = await run();
  expect(results).toHaveLength(50);
  expect(spy.calls).toHaveLength(1);
});

test("empty dataset returns [] with a single request and no summary", async () => {
  const {
    run, spy, exported,
  } = makeContext(dataset(0), {
    limit: undefined,
  });
  const results = await run();
  expect(results).toEqual([]);
  expect(spy.calls).toHaveLength(1);
  expect(exported["$summary"]).toBeUndefined();
});

test("username/dataset-name is normalized to the tilde form the API expects", async () => {
  const {
    run, spy,
  } = makeContext(dataset(10), {
    datasetId: "myuser/my-dataset",
    limit: 1,
  });
  await run();
  expect(spy.calls[0].datasetId).toBe("myuser~my-dataset");
});

test("a raw dataset ID or tilde form is passed through unchanged", async () => {
  const idCase = makeContext(dataset(10), {
    datasetId: "WkzbQMuFYuamGv3YF",
    limit: 1,
  });
  await idCase.run();
  expect(idCase.spy.calls[0].datasetId).toBe("WkzbQMuFYuamGv3YF");

  const tildeCase = makeContext(dataset(10), {
    datasetId: "myuser~my-dataset",
    limit: 1,
  });
  await tildeCase.run();
  expect(tildeCase.spy.calls[0].datasetId).toBe("myuser~my-dataset");
});

test("clean, fields and omit are forwarded to listDatasetItems", async () => {
  const {
    run, spy,
  } = makeContext(dataset(10), {
    limit: 1,
    clean: true,
    fields: [
      "a",
    ],
    omit: [
      "b",
    ],
  });
  await run();
  expect(spy.calls[0].params).toMatchObject({
    clean: true,
    fields: [
      "a",
    ],
    omit: [
      "b",
    ],
  });
});

test("empty limit paginates and returns all items, stopping on a short page", async () => {
  const {
    run, spy,
  } = makeContext(dataset(150), {
    limit: undefined,
  });
  const results = await run();
  expect(results).toHaveLength(150);
  // 100 + 50 (short page terminates), no gratuitous extra fetch.
  expect(spy.calls).toHaveLength(2);
  expect(spy.calls[0].params.limit).toBe(LIMIT);
});

test("empty limit terminates on an empty page for an exact multiple (no infinite loop)", async () => {
  const {
    run, spy,
  } = makeContext(dataset(200), {
    limit: undefined,
  }, {
    maxCalls: 5,
  });
  const results = await run();
  expect(results).toHaveLength(200);
  // 100 + 100 + empty terminal fetch.
  expect(spy.calls).toHaveLength(3);
});

test("offset is passed through to the first request", async () => {
  const {
    run, spy,
  } = makeContext(dataset(150), {
    offset: 25,
    limit: 2,
  });
  const results = await run();
  expect(results).toHaveLength(2);
  expect(spy.calls[0].params.offset).toBe(25);
});

test("empty offset defaults to 0", async () => {
  const {
    run, spy,
  } = makeContext(dataset(10), {
    offset: undefined,
    limit: 5,
  });
  await run();
  expect(spy.calls[0].params.offset).toBe(0);
});

test("limit propDefinition enforces a minimum of 1 and has no default", () => {
  expect(apify.propDefinitions.limit.min).toBe(1);
  expect("default" in apify.propDefinitions.limit).toBe(false);
});

test("offset propDefinition enforces a minimum of 0 and has no default", () => {
  expect(apify.propDefinitions.offset.min).toBe(0);
  expect("default" in apify.propDefinitions.offset).toBe(false);
});
