import apify from "../../apify.app.mjs";
import { WCC_ACTOR_ID } from "../../common/constants.mjs";
import { ACTOR_JOB_STATUSES } from "@apify/consts";
import { validateUrl } from "../../common/utils.mjs";

export default {
  key: "apify-scrape-single-url",
  name: "Scrape single URL",
  description: "**Deprecated:** use the **Web Fetch** action instead. This action will be removed in a future release. Executes a scraper on a specific website and returns its content as HTML. This action is perfect for extracting content from a single page. [See the documentation](https://docs.apify.com/sdk/js/docs/examples/crawl-single-url)",
  version: "0.1.6",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  },
  type: "action",
  props: {
    apify,
    // The description is only shown in the action picker, so repeat the note in the step form.
    // eslint-disable-next-line pipedream/props-label, pipedream/props-description
    deprecationNotice: {
      type: "alert",
      alertType: "warning",
      content: "**Deprecated:** use the **Web Fetch** action instead. This action will be removed in a future release.",
    },
    url: {
      type: "string",
      label: "URL",
      description: "The URL of the web page to scrape.",
      optional: false,
    },
    crawlerType: {
      type: "string",
      label: "Crawler Type",
      description: "Select the crawling engine:\n- **Adaptive** - Automatically switches between raw HTTP for static pages and a headless browser for dynamic pages to get the maximum performance wherever possible.\n- **Firefox (Headless Browser)** (default) - Headless Firefox with Playwright and anti-blocking measures enabled. Reliable, renders JavaScript content, and best at avoiding blocking, but might be slow. For best performance, use with Apify Proxy residential IPs.\n- **Cheerio (Raw HTTP)** - High-performance crawling mode that uses raw HTTP requests to fetch the pages. Fastest and cheapest, but doesn't render JavaScript content.",
      options: [
        {
          label: "Adaptive",
          value: "playwright:adaptive",
        },
        {
          label: "Firefox (Headless Browser)",
          value: "playwright:firefox",
        },
        {
          label: "Cheerio (Raw HTTP)",
          value: "cheerio",
        },
      ],
      default: "playwright:firefox",
    },
  },
  async run({ $ }) {
    const url = this.url?.trim();
    validateUrl(url);

    const {
      status,
      defaultDatasetId,
      consoleUrl,
    } = await this.apify.runActor({
      actorId: WCC_ACTOR_ID,
      input: {
        crawlerType: this.crawlerType,
        maxCrawlDepth: 0,
        maxCrawlPages: 1,
        maxResults: 1,
        startUrls: [
          {
            url,
          },
        ],
      },
    });

    if (status !== ACTOR_JOB_STATUSES.SUCCEEDED) {
      throw new Error(`Run has finished with status: ${status}. Inspect it here: ${consoleUrl}.`);
    }

    const { items } = await this.apify.listDatasetItems({
      datasetId: defaultDatasetId,
    });

    $.export("$summary", "Scraped the URL successfully.");
    return items[0];
  },
};
