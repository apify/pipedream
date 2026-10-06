import apify from "../../apify.app.mjs";
import {
  WEB_FETCH_FORMATS, WEB_FETCH_TRUNCATABLE_FORMATS,
} from "../../common/constants.mjs";
import {
  MAX_OUTPUT_BYTES, outputByteSize, truncateToBytes,
} from "../../common/output.mjs";
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
      description: `Which formats to return. Markdown is recommended for AI agents and LLMs. A format that does not apply to the fetched content is returned empty, for example **Links** for an image. **Raw** works for any content type and is base64-encoded for binary content. To fit the step output limit, the returned content is capped at ${MAX_OUTPUT_BYTES / 1024} KB in total, split evenly between the selected formats: longer **Markdown**, **HTML** and **Plain text** are truncated, and larger **Links** and **Raw** are left out.`,
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
  methods: {
    // Caps each returned format to an equal share of MAX_OUTPUT_BYTES. Text formats
    // are truncated; links and raw (possibly base64) are dropped, as a partial value is unusable.
    capOutput(response) {
      const present = WEB_FETCH_FORMATS
        .map(({ value }) => value)
        .filter((format) => response[format] != null);
      const maxBytes = Math.floor(MAX_OUTPUT_BYTES / (present.length || 1));

      const output = {
        ...response,
      };
      const truncatedFormats = [];
      for (const format of present) {
        const originalBytes = outputByteSize(response[format]);
        if (originalBytes <= maxBytes) {
          continue;
        }
        const truncatable = WEB_FETCH_TRUNCATABLE_FORMATS.includes(format)
          && typeof response[format] === "string";
        if (truncatable) {
          output[format] = truncateToBytes(response[format], maxBytes);
        } else {
          delete output[format];
        }
        truncatedFormats.push({
          format,
          action: truncatable
            ? "truncated"
            : "omitted",
          originalBytes,
          maxBytes,
        });
      }

      if (truncatedFormats.length) {
        output.truncated = true;
        output.truncatedFormats = truncatedFormats;
      }
      return output;
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
    const output = this.capOutput(response);

    const status = output.fetch?.httpStatusCode;
    let summary = status
      ? `Fetched ${url} (HTTP ${status})`
      : `Fetched ${url}`;
    if (output.truncated) {
      const capped = output.truncatedFormats
        .map(({
          format, action,
        }) => `${format} ${action}`)
        .join(", ");
      summary += `. Content over the ${MAX_OUTPUT_BYTES / 1024} KB limit: ${capped}`;
    }
    $.export("$summary", summary);
    return output;
  },
};
