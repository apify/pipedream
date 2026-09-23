export const WCC_ACTOR_ID = "aYG0l9s7dbB7j3gbS";
export const LIMIT = 100;

// Web Fetch (https://apify.com/apify/web-fetch) runs in Standby mode: one POST to its own
// host returns the page content, so there is no run to wait for and no dataset to read.
export const WEB_FETCH_STANDBY_URL = "https://web-fetch.apify.actor/";
// A single fetch may take up to 2 minutes on the Actor side. Wait a bit longer, so a Standby
// cold start does not cut off the Actor's own FETCH_TIMEOUT error before it reaches the user.
export const WEB_FETCH_TIMEOUT_MS = 180 * 1000;
export const WEB_FETCH_FORMATS = [
  {
    label: "Markdown",
    value: "markdown",
  },
  {
    label: "HTML",
    value: "html",
  },
  {
    label: "Plain text",
    value: "text",
  },
  {
    label: "Links",
    value: "links",
  },
  {
    label: "Raw",
    value: "raw",
  },
];

// Apify platform memory limits: memory must be a power of two, from 128 MB to 32 GB.
// See https://docs.apify.com/actors/running/usage-and-resources#memory
export const MIN_MEMORY_MBYTES = 128;
export const MAX_MEMORY_MBYTES = 32768;

function memoryLabel(mb) {
  return mb >= 1024
    ? `${mb / 1024} GB`
    : `${mb} MB`;
}

// Ordered dropdown options for the run memory limit (128 MB -> 32 GB).
export const MEMORY_MBYTES_OPTIONS = (() => {
  const options = [];
  for (let mb = MIN_MEMORY_MBYTES; mb <= MAX_MEMORY_MBYTES; mb *= 2) {
    options.push({
      label: memoryLabel(mb),
      value: mb,
    });
  }
  return options;
})();
