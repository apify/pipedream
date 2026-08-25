/* eslint-disable no-unused-vars */
import apify from "../../apify.app.mjs";
import { parseObject } from "../../common/utils.mjs";
import { WEBHOOK_EVENT_TYPES } from "@apify/consts";
import { ConfigurationError } from "@pipedream/platform";

// Max OUTPUT record size (bytes) returned inline; oversized values get a reference object.
const MAX_OUTPUT_BYTES = 256 * 1024;

export default {
  key: "apify-run-actor",
  name: "Run Actor",
  description: "Performs an execution of a selected Actor in Apify. [See the documentation](https://docs.apify.com/api/v2#/reference/actors/run-collection/run-actor)",
  version: "0.0.8",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  },
  type: "action",
  props: {
    apify,
    actorSource: {
      type: "string",
      label: "Search Actors from",
      description: "Where to search for Actors. Choose **Apify Store Actors** to browse the public [Apify Store](https://apify.com/store), or **Recently used Actors** to pick from Actors you've run before.",
      options: [
        {
          label: "Apify Store Actors",
          value: "store",
        },
        {
          label: "Recently used Actors",
          value: "recently-used",
        },
      ],
      reloadProps: true,
      default: "recently-used",
    },
    actorId: {
      propDefinition: [
        apify,
        "actorId",
        (c) => ({
          actorSource: c.actorSource,
        }),
      ],
      reloadProps: true,
    },
    buildTag: {
      propDefinition: [
        apify,
        "buildTag",
        (c) => ({
          actorId: c.actorId,
        }),
      ],
      reloadProps: true,
      optional: true,
    },
    // Renamed from `runAsynchronously` for clarity.
    waitForFinish: {
      type: "boolean",
      label: "Wait for Finish",
      description: "If `true` (default), the step waits for the Actor run to finish and returns its output. If `false`, the step starts the run and returns immediately with the run details, without waiting.",
      reloadProps: true,
      default: true,
    },
    timeout: {
      type: "string",
      label: "Timeout (seconds)",
      description: "Optional timeout for the run, in seconds. By default, the run uses a timeout specified in the default run configuration for the Actor.",
      optional: true,
    },
    memory: {
      type: "string",
      label: "Memory (MB)",
      description: "Memory limit for the run, in megabytes. The amount of memory can be set to a power of 2 with a minimum of 128. By default, the run uses a memory limit specified in the default run configuration for the Actor.",
      optional: true,
    },
    maxItems: {
      type: "string",
      label: "Max Items",
      description: "The maximum number of items that the Actor run should return. This is useful for pay-per-result Actors, as it allows you to limit the number of results that will be charged to your subscription. You can access the maximum number of items in your Actor by using the ACTOR_MAX_PAID_DATASET_ITEMS environment variable.",
      optional: true,
    },
    maxTotalChargeUsd: {
      type: "string",
      label: "Max Total Charge USD",
      description: "Specifies the maximum cost of the Actor run. This parameter is useful for pay-per-event Actors, as it allows you to limit the amount charged to your subscription. You can access the maximum cost in your Actor by using the ACTOR_MAX_TOTAL_CHARGE_USD environment variable.",
      optional: true,
    },
    webhook: {
      type: "string",
      label: "Webhook URL",
      description: "Specifies optional webhook associated with the Actor run, which can be used to receive a notification e.g. when the Actor finished or failed.",
      optional: true,
      reloadProps: true,
    },
  },
  methods: {
    outputByteSize(value) {
      if (value == null) return 0;
      if (Buffer.isBuffer(value)) return value.length;
      if (typeof value === "string") return Buffer.byteLength(value);
      try {
        return Buffer.byteLength(JSON.stringify(value));
      } catch {
        // Unserializable (e.g. circular) -> treat as oversized so we never return it inline.
        return Infinity;
      }
    },
    // Returns { output, capped }: `capped` tells run() explicitly whether the value was
    // replaced by a reference, so it never has to infer capping from the value's own shape
    // (an Actor OUTPUT could legitimately contain a `truncated` field).
    async capOutputRecord(record, keyValueStoreId, recordKey) {
      if (record?.value == null) {
        return {
          output: undefined,
          capped: false,
        };
      }
      const size = this.outputByteSize(record.value);
      if (size <= MAX_OUTPUT_BYTES) {
        return {
          output: record.value,
          capped: false,
        };
      }
      return {
        capped: true,
        output: {
          truncated: true,
          message:
            "The OUTPUT record exceeds the safe step-output size and was not returned inline. " +
            "Retrieve it via `recordUrl`, or use the Get Key-Value Store Record action.",
          keyValueStoreId,
          recordKey,
          contentType: record.contentType,
          size,
          // getKVSRecordUrl -> apify-client getRecordPublicUrl is async; must await or the
          // unresolved Promise serializes to `{}` in the step output.
          recordUrl: await this.apify.getKVSRecordUrl(keyValueStoreId, recordKey),
        },
      };
    },
    getType(type) {
      // Pipedream has no float type, so numbers are input as strings
      if (type === "number") return "string";
      return [
        "string",
        "object",
        "integer",
        "boolean",
      ].includes(type)
        ? type
        : "string[]";
    },
    parseNumericInput(value, key) {
      const num = Number(value);
      if (value == null || value === "" || Number.isNaN(num)) {
        throw new ConfigurationError(
          `Input "${key}" must be a valid number, but received: ${JSON.stringify(value)}.`,
        );
      }
      return num;
    },
    async getSchema(actorId, buildTag) {
      const build = await this.apify.getBuild(actorId, buildTag);
      if (!build) {
        throw new Error(`No build found for Actor ${actorId}`);
      }

      // Case 1: schema is already an object
      if (build.actorDefinition && build.actorDefinition.input) {
        return build.actorDefinition.input;
      }

      // Case 2: schema is a string in inputSchema
      if (build.inputSchema) {
        try {
          return typeof build.inputSchema === "string"
            ? JSON.parse(build.inputSchema)
            : build.inputSchema;
        } catch (err) {
          throw new Error(
            `Failed to parse inputSchema for Actor ${actorId}: ${err.message}`,
          );
        }
      }

      // Case 3: no schema at all (e.g. apify/hello-world)
      const noSchemaError = new Error(
        `No input schema found for Actor ${actorId}. Has it been built successfully?`,
      );
      noSchemaError.noInputSchema = true;
      throw noSchemaError;
    },
    async prepareData(data) {
      let schema;
      try {
        schema = await this.getSchema(this.actorId, this.buildTag);
      } catch (err) {
        // Actor has no input schema: send the raw input (defaults to {}) as-is.
        if (err?.noInputSchema) {
          return data;
        }
        throw err;
      }

      const newData = {};
      const { properties } = schema;

      // Iterate over properties from the schema because newData might contain additional fields
      for (const [
        key,
        value,
      ] of Object.entries(properties)) {
        const propValue = data[key];
        if (propValue === undefined) continue;

        if (value.type === "number" || value.type === "integer") {
          if (Array.isArray(propValue)) {
            newData[key] = propValue.map((item) => this.parseNumericInput(item, key));
          } else if (propValue !== "") {
            newData[key] = this.parseNumericInput(propValue, key);
          }
          continue;
        }

        const editor = value.editor || "hidden";
        newData[key] = Array.isArray(propValue)
          ? propValue.map((item) => this.setValue(editor, item))
          : this.setValue(editor, propValue);
      }
      return newData;
    },
    prepareOptions(value) {
      if (value.enum && value.enumTitles) {
        return value.enum.map((val, i) => ({
          value: val,
          label: value.enumTitles[i],
        }));
      }
    },
    setValue(editor, item) {
      switch (editor) {
      case "requestListSources":
        return {
          url: item,
        };
      case "pseudoUrls":
        return {
          purl: item,
        };
      case "globs":
        return {
          glob: item,
        };
      case "json":
      case "schemaBased":
        if (typeof item === "string") return JSON.parse(item);
        return item;
      default:
        return item;
      }
    },
  },
  async additionalProps() {
    const props = {};

    // Show a hint if user set actorId to sentinel value "".
    // Displayed only when user has no recently-used Actors.
    if (this.actorId === "") {
      return {
        actorHint: {
          type: "alert",
          alertType: "info",
          content: "No Actor selected. Set **Search Actors from** to **Apify Store Actors** above, then choose an Actor to run.",
        },
      };
    }

    // Not picked yet (undefined): show nothing rather than erroring.
    if (!this.actorId) {
      return props;
    }

    try {
      const schema = await this.getSchema(this.actorId, this.buildTag);
      const {
        properties, required: requiredProps = [],
      } = schema;

      for (const [
        key,
        value,
      ] of Object.entries(properties)) {
        if (value.editor === "hidden") continue;

        props[key] = {
          type: this.getType(value.type),
          label: value.title,
          description: value.description,
          optional: !requiredProps.includes(key),
        };

        if (props[key].type === "string" && value.isSecret) {
          props[key].secret = value.isSecret;
        } else if (props[key].type === "integer") {
          props[key].min = value.minimum;
          props[key].max = value.maximum;
          if (value.unit) {
            props[key].description += ` Unit: ${value.unit}.`;
          }
        }

        const options = this.prepareOptions(value);
        if (options) props[key].options = options;

        // We're using prefill here as a suggestion for the user. Using default value would be
        // redundant as the default value is inserted by the Apify platform.
        // More info: https://docs.apify.com/platform/actors/development/actor-definition/input-schema/specification/v1#prefill-vs-default-vs-required
        const defaultValue = value.prefill;

        if (defaultValue !== undefined) {
          props[key].default = defaultValue;

          if (props[key].type === "string[]") {
            if (value.editor === "requestListSources") {
              props[key].default = defaultValue.map((request) => request.url);
            }

            if (value.editor === "json" || value.editor === "schemaBased") {
              props[key].default = defaultValue.map((item) => JSON.stringify(item));
            }
          }

          props[key].description += ` Default: \`${JSON.stringify(defaultValue)}\``;
        }
      }
    } catch (e) {
      if (!e?.noInputSchema) {
        throw e;
      }
      props.properties = {
        type: "object",
        label: "Properties",
        description: "This Actor has no input schema. Provide a raw JSON input object, or leave it empty to run the Actor with its own defaults.",
        optional: true,
        default: {},
      };
    }

    if (this.waitForFinish) {
      props.outputRecordKey = {
        type: "string",
        label: "Output Record Key",
        description:
                  "Key of the record from the run's default key-value store to return. Default is `OUTPUT`.",
        optional: true,
        default: "OUTPUT",
      };
    }

    if (this.webhook) {
      props.eventTypes = {
        type: "string[]",
        label: "Event Types",
        description: "The types of events to send to the webhook",
        options: Object.values(WEBHOOK_EVENT_TYPES),
      };
    }

    return props;
  },
  async run({ $ }) {
    const {
      apify,
      actorId,
      buildTag,
      waitForFinish,
      outputRecordKey,
      timeout,
      memory,
      maxItems,
      maxTotalChargeUsd,
      webhook,
      eventTypes,
      properties,
      ...data
    } = this;

    // --- Validation step ---
    const actorDetails = await apify.getActor({
      actorId,
    });

    if (!actorDetails) {
      throw new Error(`Actor with ID "${actorId}" does not exist.`);
    }

    if (!actorDetails.stats?.totalBuilds || actorDetails.stats.totalBuilds === 0) {
      throw new Error(
        `Actor "${actorDetails.title || actorDetails.name}" has no builds yet and can't be run until it's built. Open the Actor in Apify Console and build it (Source → Code → Build), or trigger a build via the Apify CLI/API, then run this step again.`,
      );
    }

    if (buildTag) {
      await apify.resolveBuildId(actorId, buildTag);
    }

    // Prepare input
    // Use data (dynamic props from schema) if it has any keys,
    // otherwise fall back to this.properties (fallback object prop)
    const fallback = properties
      ? parseObject(properties)
      : {};
    const rawInput = Object.keys(data).length > 0
      ? data
      : fallback;
    const input = await this.prepareData(rawInput);

    // Build params safely
    const params = {
      ...(buildTag && {
        build: buildTag,
      }),
      ...(timeout && {
        timeout: Number(timeout),
      }),
      ...(memory && {
        memory: Number(memory),
      }),
      ...(maxItems && {
        maxItems: Number(maxItems),
      }),
      ...(maxTotalChargeUsd && {
        maxTotalChargeUsd: Number(maxTotalChargeUsd),
      }),
      ...(webhook && {
        webhooks: [
          {
            eventTypes,
            requestUrl: webhook,
          },
        ],
      }),
    };

    let run;

    if (!waitForFinish) {
      // async run — start and return immediately without waiting
      run = await apify.runActorAsynchronously({
        actorId,
        data: input,
        params,
      });

      $.export("$summary", `Successfully started Actor run with ID: ${run.id}`);
      return run;
    } else {
      // sync run
      run = await apify.runActor({
        actorId,
        input,
        options: params,
      });

      // Fetch OUTPUT record and guard its size before returning it inline.
      let output;
      let capped = false;
      if (run.defaultKeyValueStoreId) {
        const record = await apify.getKVSRecord(run.defaultKeyValueStoreId, outputRecordKey);
        ({
          output, capped,
        } = await this.capOutputRecord(record, run.defaultKeyValueStoreId, outputRecordKey));
      }
      $.export(
        "$summary",
        `The run of an Actor with ID: ${actorId} has finished with status "${run.status}".`
          + (capped
            ? " OUTPUT was too large to return inline; a reference URL is included."
            : ""),
      );

      return {
        run,
        output,
      };
    }
  },
};
