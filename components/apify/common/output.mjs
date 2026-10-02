// Max size (bytes) of content returned inline in a step's output. Larger values are replaced
// by a reference (Run Actor) or truncated (Web Fetch) to stay within Pipedream's limits.
export const MAX_OUTPUT_BYTES = 256 * 1024;

// Size of a value as it is serialized into the step output.
export function outputByteSize(value) {
  if (value == null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === "string") return Buffer.byteLength(value);
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    // Unserializable (e.g. circular) -> treat as oversized so we never return it inline.
    return Infinity;
  }
}

// Cuts a string to at most maxBytes of UTF-8 without leaving a split character at the end.
export function truncateToBytes(value, maxBytes) {
  return Buffer.from(value).subarray(0, maxBytes)
    .toString()
    .replace(/\uFFFD+$/, "");
}
