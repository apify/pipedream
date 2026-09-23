import { ConfigurationError } from "@pipedream/platform";

// new URL() accepts hosts with empty labels (e.g. "google..com"), so check explicitly
export function validateUrl(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ConfigurationError(`Invalid URL "${url}": could not be parsed. Use a valid absolute URL like https://example.com.`);
  }

  if (![
    "http:",
    "https:",
  ].includes(parsedUrl.protocol)) {
    throw new ConfigurationError(`Invalid URL "${url}": only http and https protocols are supported. Use a valid absolute URL like https://example.com.`);
  }

  if (parsedUrl.hostname.split(".").some((label) => label.length === 0)) {
    throw new ConfigurationError(`Invalid URL "${url}": host contains an empty label. Use a valid absolute URL like https://example.com.`);
  }
}

// Object props arrive as a JSON string when set through an expression.
export function parseObject(value, label) {
  if (!value) {
    return undefined;
  }
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ConfigurationError(`Invalid ${label}: provide a JSON object, e.g. {"Accept-Language": "fr-FR"}.`);
    }
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigurationError(`Invalid ${label}: provide a JSON object, e.g. {"Accept-Language": "fr-FR"}.`);
  }
  return parsed;
}
