import { jest } from "@jest/globals";
import { ACTOR_JOB_STATUSES } from "@apify/consts";
import { ConfigurationError } from "@pipedream/platform";
import { WCC_ACTOR_ID } from "../../common/constants.mjs";
import component from "./scrape-single-url.mjs";

describe("apify-scrape-single-url validateUrl()", () => {
  const { validateUrl } = component.methods;

  test.each([
    [
      "a plain https URL",
      "https://example.com",
    ],
    [
      "an http URL with a path and query",
      "http://example.com/path?q=1",
    ],
  ])("accepts %s", (_desc, url) => {
    expect(() => validateUrl(url)).not.toThrow();
  });

  test.each([
    [
      "a host with consecutive dots (the reported bug)",
      "https://google..com",
    ],
    [
      "a host with a leading dot",
      "https://.example.com",
    ],
    [
      "a host with a trailing dot",
      "https://example.com.",
    ],
    [
      "a non-http(s) protocol",
      "ftp://example.com",
    ],
    [
      "an unparseable string",
      "not a url",
    ],
    [
      "an empty string",
      "",
    ],
  ])("rejects %s", (_desc, url) => {
    expect(() => validateUrl(url)).toThrow(ConfigurationError);
  });
});

/**
 * Builds a `this` context plus a fake `$` for calling `component.run`.
 * `apify.runActor` / `apify.listDatasetItems` are mocked so no token or
 * network is needed (mirrors run-actor.test.mjs).
 */
const buildCtx = (overrides = {}) => {
  const runActor = jest.fn().mockResolvedValue({
    status: ACTOR_JOB_STATUSES.SUCCEEDED,
    defaultDatasetId: "dataset_123",
    consoleUrl: "https://console.apify.com/view/runs/run_123",
  });
  const listDatasetItems = jest.fn().mockResolvedValue({
    items: [
      {
        url: "https://example.com",
        text: "hello",
      },
    ],
  });
  const $ = {
    export: jest.fn(),
  };
  const ctx = {
    ...component,
    // Pipedream hoists `methods` onto `this` at runtime; replicate that here.
    ...component.methods,
    apify: {
      runActor,
      listDatasetItems,
    },
    url: "https://example.com",
    crawlerType: "playwright:firefox",
    ...overrides,
  };
  return {
    ctx,
    runActor,
    listDatasetItems,
    $,
  };
};

describe("apify-scrape-single-url run()", () => {
  test("runs the Actor with the expected input and returns the first dataset item", async () => {
    const {
      ctx, runActor, listDatasetItems, $,
    } = buildCtx();

    const result = await component.run.call(ctx, {
      $,
    });

    expect(runActor).toHaveBeenCalledTimes(1);
    const arg = runActor.mock.calls[0][0];
    expect(arg.actorId).toBe(WCC_ACTOR_ID);
    expect(arg.input.crawlerType).toBe("playwright:firefox");
    expect(arg.input.startUrls).toEqual([
      {
        url: "https://example.com",
      },
    ]);
    expect(arg.input).toMatchObject({
      maxCrawlDepth: 0,
      maxCrawlPages: 1,
      maxResults: 1,
    });

    expect(listDatasetItems).toHaveBeenCalledWith({
      datasetId: "dataset_123",
    });
    expect($.export).toHaveBeenCalledWith("$summary", expect.any(String));
    expect(result).toEqual({
      url: "https://example.com",
      text: "hello",
    });
  });

  test("trims surrounding whitespace before sending the URL to the Actor", async () => {
    const {
      ctx, runActor, $,
    } = buildCtx({
      url: "  https://example.com/page  ",
    });

    await component.run.call(ctx, {
      $,
    });

    expect(runActor.mock.calls[0][0].input.startUrls).toEqual([
      {
        url: "https://example.com/page",
      },
    ]);
  });

  test("rejects an invalid URL before calling the Actor", async () => {
    const {
      ctx, runActor, listDatasetItems, $,
    } = buildCtx({
      url: "https://google..com",
    });

    await expect(component.run.call(ctx, {
      $,
    })).rejects.toBeInstanceOf(ConfigurationError);
    expect(runActor).not.toHaveBeenCalled();
    expect(listDatasetItems).not.toHaveBeenCalled();
  });

  test("throws with the run status when the run does not succeed", async () => {
    const {
      ctx, runActor, listDatasetItems, $,
    } = buildCtx();
    runActor.mockResolvedValueOnce({
      status: ACTOR_JOB_STATUSES.FAILED,
      defaultDatasetId: "dataset_123",
      consoleUrl: "https://console.apify.com/view/runs/run_123",
    });

    await expect(component.run.call(ctx, {
      $,
    })).rejects.toThrow(/FAILED/);
    // it should fail before fetching dataset items
    expect(listDatasetItems).not.toHaveBeenCalled();
  });
});

describe("apify-scrape-single-url crawlerType prop", () => {
  const values = component.props.crawlerType.options.map(({ value }) => value);

  test("no longer offers the deprecated playwright:chrome engine", () => {
    expect(values).not.toContain("playwright:chrome");
  });

  test("offers exactly adaptive, firefox and cheerio", () => {
    expect(values).toEqual([
      "playwright:adaptive",
      "playwright:firefox",
      "cheerio",
    ]);
  });

  test("defaults to playwright:firefox", () => {
    expect(component.props.crawlerType.default).toBe("playwright:firefox");
  });
});
