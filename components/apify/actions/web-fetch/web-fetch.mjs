import apify from "../../apify.app.mjs";
import { WEB_FETCH_FORMATS } from "../../common/constants.mjs";
import {
  parseObject, validateUrl,
} from "../../common/utils.mjs";

export default {
  key: "apify-web-fetch",
  name: "Web Fetch",
  description: "Fetches the content of a web page, PDF or file and returns it as markdown, HTML, plain text, links or raw content. It gets past bot protection and returns the content in a single step, which makes it a good fit for large language model (LLM) flows. To crawl multiple URLs or a whole website, use **Run Actor** with [Website Content Crawler](https://apify.com/apify/website-content-crawler) instead. [See the documentation](https://apify.com/apify/web-fetch)",
  version: "0.0.1",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: true,
  },
  type: "action",
  props: {
    apify,
    url: {
      type: "string",
      label: "URL",
      description: "The URL of a web page, PDF, image or other file to fetch. Only `http://` and `https://` URLs are supported.",
    },
    formats: {
      type: "string[]",
      label: "Formats",
      description: "Which formats to return. Markdown is recommended for AI agents and LLMs. A format that does not apply to the fetched content is returned empty, for example **Links** for an image. **Raw** works for any content type and is base64-encoded for binary content.",
      options: WEB_FETCH_FORMATS,
      default: [
        "markdown",
      ],
    },
    headers: {
      type: "object",
      label: "Headers",
      description: "Additional HTTP headers to send to the target URL, for example `Accept-Language` for localized content or a session cookie the website expects.",
      optional: true,
    },
  },
  async run({ $ }) {
    const url = this.url?.trim();
    validateUrl(url);

    const response = await this.apify.webFetch({
      $,
      url,
      formats: this.formats?.length
        ? this.formats
        : [
          "markdown",
        ],
      headers: parseObject(this.headers, "Headers"),
    });

    const status = response.fetch?.httpStatusCode;
    $.export("$summary", status
      ? `Fetched ${url} (HTTP ${status})`
      : `Fetched ${url}`);
    return response;
  },
};
