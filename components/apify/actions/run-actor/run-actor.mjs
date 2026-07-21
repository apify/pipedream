/* eslint-disable no-unused-vars */
import apify from "../../apify.app.mjs";
import { parseObject } from "../../common/utils.mjs";
import {
  MEMORY_MBYTES_OPTIONS, MIN_MEMORY_MBYTES, MAX_MEMORY_MBYTES,
} from "../../common/constants.mjs";
import { WEBHOOK_EVENT_TYPES } from "@apify/consts";

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
      description: "Where to search for Actors. Valid options are Store and Recently used Actors.",
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
    runAsynchronously: {
      type: "boolean",
      label: "Run Asynchronously",
      description: "Set to `true` to run the Actor asynchronously",
      reloadProps: true,
      default: true,
    },
    timeout: {
      type: "string",
      label: "Timeout (seconds)",
      description: "Optional timeout for the run, in seconds. By default, the run uses a timeout specified in the default run configuration for the Actor.",
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
    getType(type) {
      return [
        "string",
        "object",
        "integer",
        "boolean",
      ].includes(type)
        ? type
        : "string[]";
    },
    async getBuildOrThrow(actorId, buildTag) {
      const build = await this.apify.getBuild(actorId, buildTag);
      if (!build) {
        throw new Error(`No build found for actor ${actorId}`);
      }
      return build;
    },
    extractInputSchema(build, actorId) {
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
            `Failed to parse inputSchema for actor ${actorId}: ${err.message}`,
          );
        }
      }

      // Case 3: no schema at all
      throw new Error(
        `No input schema found for actor ${actorId}. Has it been built successfully?`,
      );
    },
    async getSchema(actorId, buildTag) {
      const build = await this.getBuildOrThrow(actorId, buildTag);
      return this.extractInputSchema(build, actorId);
    },
    // Reads the Actor's declared memory limits from an already-fetched build,
    // falling back to the platform limits (128 MB - 32 GB) when not declared.
    getMemoryLimits(build) {
      const {
        minMemoryMbytes, maxMemoryMbytes,
      } = build?.actorDefinition ?? {};
      return {
        min: Number.isInteger(minMemoryMbytes)
          ? minMemoryMbytes
          : MIN_MEMORY_MBYTES,
        max: Number.isInteger(maxMemoryMbytes)
          ? maxMemoryMbytes
          : MAX_MEMORY_MBYTES,
      };
    },
    buildMemoryProp({
      min, max,
    }) {
      const options = MEMORY_MBYTES_OPTIONS.filter(({ value }) => value >= min && value <= max);
      return {
        type: "integer",
        label: "Memory (MB)",
        description: "Memory limit for the run, in megabytes. Must be a power of two between 128 MB and 32 GB. By default, the run uses the memory limit specified in the Actor's default run configuration.",
        optional: true,
        options: options.length
          ? options
          : MEMORY_MBYTES_OPTIONS,
      };
    },
    async prepareData(data, schema) {
      const newData = {};
      const { properties } = schema ?? await this.getSchema(this.actorId, this.buildTag);

      // Iterate over properties from the schema because newData might contain additional fields
      for (const [
        key,
        value,
      ] of Object.entries(properties)) {
        const propValue = data[key];
        if (propValue === undefined) continue;

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
    let memoryLimits = {
      min: MIN_MEMORY_MBYTES,
      max: MAX_MEMORY_MBYTES,
    };
    try {
      const build = await this.getBuildOrThrow(this.actorId, this.buildTag);
      memoryLimits = this.getMemoryLimits(build);
      const schema = this.extractInputSchema(build, this.actorId);
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
      props.properties = {
        type: "object",
        label: "Properties",
        description: e.message || "Schema not available, showing fallback.",
      };
    }

    // Ordered memory dropdown (128 MB - 32 GB), filtered to the Actor's
    // declared min/max memory when present. Declared here (not in static props)
    // so it can honor the per-Actor limits read from the fetched build.
    props.memory = this.buildMemoryProp(memoryLimits);

    if (!this.runAsynchronously) {
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
      runAsynchronously,
      outputRecordKey,
      timeout,
      memory,
      maxItems,
      maxTotalChargeUsd,
      webhook,
      eventTypes,
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
        `Actor "${actorDetails.title || actorDetails.name}" has no builds. Please build it first before running.`,
      );
    }

    if (buildTag) {
      const taggedBuilds = actorDetails.taggedBuilds || {};
      if (!taggedBuilds[buildTag]) {
        throw new Error(
          `Build with tag "${buildTag}" was not found for actor "${actorDetails.title || actorDetails.name}".`,
        );
      }
    }

    // Fetch the build once and reuse it for both the input schema and the
    // Actor's declared memory limits (avoids adding a second build fetch).
    const build = await this.getBuildOrThrow(actorId, buildTag);
    const schema = this.extractInputSchema(build, actorId);
    const {
      min: minMemory, max: maxMemory,
    } = this.getMemoryLimits(build);

    // Defensive memory validation. The dropdown already filters valid options
    // at configuration time; this guards against stale or injected values.
    if (memory !== undefined && memory !== null && memory !== "") {
      const mem = Number(memory);
      const isValidStep = MEMORY_MBYTES_OPTIONS.some(({ value }) => value === mem);
      if (!isValidStep || mem < minMemory || mem > maxMemory) {
        throw new Error(
          `Memory ${memory} MB is not valid for Actor "${actorDetails.title || actorDetails.name}". It must be a power of two between ${minMemory} and ${maxMemory} MB.`,
        );
      }
    }

    // Prepare input
    // Use data (dynamic props from schema) if it has any keys,
    // otherwise fall back to this.properties (fallback object prop)
    const rawInput = Object.keys(data).length > 0
      ? data
      : (this.properties
        ? parseObject(this.properties)
        : {});
    const input = await this.prepareData(rawInput, schema);

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

    if (runAsynchronously) {
      // async run
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

      // Fetch OUTPUT record manually
      let output;
      if (run.defaultKeyValueStoreId) {
        const record = await apify
          ._client()
          .keyValueStore(run.defaultKeyValueStoreId)
          .getRecord(outputRecordKey);

        output = record?.value;
      }

      $.export(
        "$summary",
        `The run of an Actor with ID: ${actorId} has finished with status "${run.status}".`,
      );

      return {
        run,
        output,
      };
    }
  },
};
