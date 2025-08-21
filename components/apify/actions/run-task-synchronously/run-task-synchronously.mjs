import apify from "../../apify.app.mjs";
import {
  ACTOR_JOB_STATUSES, ACTOR_JOB_TERMINAL_STATUSES,
} from "@apify/consts";

export default {
  key: "apify-run-task-synchronously",
  name: "Run Task Synchronously",
  description: "Run a specific task and return its dataset items. [See the documentation](https://docs.apify.com/api/v2/actor-task-run-sync-get-dataset-items-get)",
  version: "0.0.3",
  type: "action",
  props: {
    apify,
    taskId: {
      propDefinition: [
        apify,
        "taskId",
      ],
      description: "The ID of the task to run",
    },
    // Start task run options
    paidPlan: {
      type: "boolean",
      label: "Paid plan",
      description: "Indicates whether the current user is on a paid plan. Paid plans allow longer execution times for this step. If set to true but the user is actually on a Free plan, the step will fail.",
      optional: false,
      default: false,
      reloadProps: true,
    },
    timeout: {
      type: "integer",
      label: "Timeout",
      description: "Optional timeout for the run, in seconds. By default, the run uses a timeout specified in the task settings.",
      optional: true,
    },
    memory: {
      type: "integer",
      label: "Memory",
      description: "Memory limit for the run, in megabytes. The amount of memory can be set to a power of 2 with a minimum of 128. By default, the run uses a memory limit specified in the task settings.",
      optional: true,
    },
    build: {
      type: "string",
      label: "Build",
      description: "Specifies the Actor build to run. It can be either a build tag or build number. By default, the run uses the build specified in the task settings (typically latest).",
      optional: true,
    },
    // Retrieve dataset output option
    clean: {
      propDefinition: [
        apify,
        "clean",
      ],
    },
    fields: {
      propDefinition: [
        apify,
        "fields",
      ],
    },
    omit: {
      propDefinition: [
        apify,
        "omit",
      ],
    },
    flatten: {
      propDefinition: [
        apify,
        "flatten",
      ],
    },
    limit: {
      propDefinition: [
        apify,
        "limit",
      ],
    },
  },
  async additionalProps() {
    const props = {};
    if (this.paidPlan) {
      props.waitSecs = {
        type: "integer",
        label: "Waiting time (seconds)",
        description: "Specifies how long to wait for the run to complete. If not set, the wait time defaults to the Pipedream’s platform limits (up to 300 seconds for the whole step execution).",
        optional: true,
        default: 280,
      };
    }
    return props;
  },
  async run({ $ }) {
    const {
      status,
      id,
      actId,
      startedAt,
      finishedAt,
      options: { build },
      buildId,
      defaultKeyValueStoreId,
      defaultDatasetId,
      defaultRequestQueueId,
      consoleUrl,
    } = await this.apify.runTaskSynchronously({
      taskId: this.taskId,
      params: {
        timeout: this.timeout,
        memory: this.memory,
        build: this.build,
        waitSecs: this.waitSecs ?? 28, // up to 30 seconds for a whole step execution if not on a paid plan
      },
    });

    const datasetItems = [];

    if (ACTOR_JOB_TERMINAL_STATUSES.includes(status)) {
      if (status !== ACTOR_JOB_STATUSES.SUCCEEDED) {
        throw new Error(`Run has finished with status: ${status}. Inspect it here: ${consoleUrl}`);
      }
      const { items } = await this.apify.listDatasetItems({
        datasetId: defaultDatasetId,
        params: {
          clean: this.clean,
          fields: this.fields && this.fields.join(),
          omit: this.omit && this.omit.join(),
          flatten: this.flatten && this.flatten.join(),
          limit: this.limit,
        },
      });
      datasetItems.push(...items);
    } else {
      throw new Error(`The run did not finish in time (${status}): waiting for run to finish timed out or Pipedream platform limitation were reached. To retrieve the items reliably, chain this step with a Get Dataset Items step.`);
    }

    $.export("$summary", `Run with task id ${this.taskId} finished successfully. Retrieved ${datasetItems.length} dataset items.`);
    return {
      runId: id,
      actId,
      startedAt,
      finishedAt,
      build,
      buildId,
      defaultKeyValueStoreId,
      defaultDatasetId,
      defaultRequestQueueId,
      datasetItems,
    };
  },
};
