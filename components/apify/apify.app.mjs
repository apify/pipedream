import { ACTOR_JOB_STATUSES } from "@apify/consts";
import { LIMIT } from "./common/constants.mjs";
import { ApifyClient } from "apify-client";

export default {
  type: "app",
  app: "apify",
  propDefinitions: {
    keyValueStoreId: {
      type: "string",
      label: "Key-Value Store Id",
      description: "The Id of the key-value store.",
      async options({
        page, unnamed = true,
      }) {
        const { items } = await this.listKeyValueStores({
          offset: LIMIT * page,
          limit: LIMIT,
          unnamed,
        });

        return items.map(({
          name: label, id: value,
        }) => ({
          label,
          value,
        }));
      },
    },
    actorId: {
      type: "string",
      label: "Actor",
      description: "Select the Actor, enter the Actor ID, or use a tilde-separated combination of the owner's username and the Actor name.",
      async options({
        page, actorSource,
      }) {
        actorSource ??= "recently-used";
        return await this.getActorOptions({
          page,
          actorSource,
        });
      },
    },
    taskId: {
      type: "string",
      label: "Task ID",
      description: "The ID of the task to monitor.",
      async options({
        page, desc = false,
      }) {
        const { items } = await this.listTasks({
          offset: LIMIT * page,
          limit: LIMIT,
          desc,
        });

        return items.map((task) => ({
          label: this.formatActorOrTaskLabel(task),
          value: task.id,
        }));
      },
    },
    datasetId: {
      type: "string",
      label: "Dataset ID",
      description: "The ID of the dataset to retrieve items within",
      async options({ page }) {
        const { items } = await this.listDatasets({
          offset: LIMIT * page,
          limit: LIMIT,
          desc: true,
          unnamed: true,
        });
        return items?.map(({
          id: value, name,
        }) => ({
          label: name || "unnamed",
          value,
        })) || [];
      },
    },
    buildTag: {
      type: "string",
      label: "Build",
      description: "Actor build to run. Accepts a build tag (e.g. `latest`) or build number (e.g. `0.1.2`). Defaults to the Actor's default build.",
      async options({ actorId }) {
        if (!actorId) {
          return [];
        }

        const [
          buildsResult,
          actor,
        ] = await Promise.all([
          this.listBuilds({
            actorId,
          }),
          this.getActor({
            actorId,
          }),
        ]);

        const builds = buildsResult?.items ?? [];
        const taggedBuilds = actor?.taggedBuilds ?? {};

        // Map build number -> tag names pointing at it (e.g. "latest", "beta").
        const tagsByBuildNumber = {};
        for (const [
          tag,
          info,
        ] of Object.entries(taggedBuilds)) {
          if (info?.buildNumber) {
            tagsByBuildNumber[info.buildNumber] ??= [];
            tagsByBuildNumber[info.buildNumber].push(tag);
          }
        }

        // Newest first. `buildNumberInt` is returned by the REST API for reliable
        // ordering even though the apify-client type omits it.
        return builds
          .filter((build) => build.status === ACTOR_JOB_STATUSES.SUCCEEDED)
          .sort((a, b) => (b.buildNumberInt ?? 0) - (a.buildNumberInt ?? 0))
          .map((build) => {
            const tags = tagsByBuildNumber[build.buildNumber];
            const tagLabel = tags?.length
              ? ` (${tags.join(", ")})`
              : "";
            return {
              label: `${build.buildNumber}${tagLabel}`,
              value: build.buildNumber,
            };
          });
      },
    },
    clean: {
      type: "boolean",
      label: "Clean",
      description: "Return only non-empty items and skips hidden fields (i.e. fields starting with the # character)",
      optional: true,
    },
    fields: {
      type: "string[]",
      label: "Fields",
      description: "An array of fields which should be picked from the items, only these fields will remain in the resulting record objects.",
      optional: true,
    },
    omit: {
      type: "string[]",
      label: "Omit",
      description: "An array of fields which should be omitted from the items",
      optional: true,
    },
    flatten: {
      type: "string[]",
      label: "Flatten",
      description: "An array of fields which should transform nested objects into flat structures. For example, with `flatten=\"foo\"` the object `{\"foo\":{\"bar\": \"hello\"}}` is turned into `{\"foo.bar\": \"hello\"}`",
      optional: true,
    },
    limit: {
      type: "integer",
      label: "Limit",
      description: "The maximum number of items to return",
      default: LIMIT,
      optional: true,
    },
    offset: {
      type: "integer",
      label: "Offset",
      description: "The number records to skip before returning results",
      default: 0,
      optional: true,
    },
  },
  methods: {
    _client() {
      return new ApifyClient({
        token: this.$auth.api_token,
        requestInterceptors: [
          (config) => ({
            ...config,
            headers: {
              ...(config.headers || {}),
              "x-apify-integration-platform": "pipedream",
            },
          }),
        ],
      });
    },
    async getActorOptions({
      page = 0, actorSource = "recently-used",
    }) {
      const listFn = actorSource === "store"
        ? this.listActors
        : this.listUserActors;

      const { items } = await listFn({
        offset: LIMIT * page,
        limit: LIMIT,
      });

      return items.map((actor) => ({
        label: this.formatActorOrTaskLabel(actor),
        value: actor.id,
      }));
    },
    getAuthToken() {
      return this.$auth.api_token;
    },
    createHook(opts = {}) {
      return this._client().webhooks()
        .create(opts);
    },
    deleteHook(hookId) {
      return this._client().webhook(hookId)
        .delete();
    },
    runActor({
      actorId, input, options,
    }) {
      return this._client().actor(actorId)
        .call(input, options);
    },
    getRun({ runId }) {
      return this._client().run(runId)
        .get();
    },
    runActorAsynchronously({
      actorId, data, params,
    }) {
      return this._client().actor(actorId)
        .start(data, params);
    },
    runTask({
      taskId, params, input,
    }) {
      return this._client().task(taskId)
        .start(input, params);
    },
    getActor({ actorId }) {
      return this._client().actor(actorId)
        .get();
    },
    async getBuild(actorId, buildRef) {
      // Get actor details
      const actor = await this._client().actor(actorId)
        .get();

      if (!actor) {
        throw new Error(`Actor ${actorId} not found.`);
      }

      if (!buildRef) {
        buildRef = actor.defaultRunOptions.build;
      }

      const taggedBuilds = actor.taggedBuilds ?? {};

      // Resolve by build tag (e.g. `latest`).
      if (taggedBuilds[buildRef]?.buildId) {
        return this._client().build(taggedBuilds[buildRef].buildId)
          .get();
      }

      // Fallback: resolve by build number (e.g. `0.1.2`) from the builds list.
      const { items: builds = [] } = await this.listBuilds({
        actorId,
      });
      const build = builds.find(({ buildNumber }) => buildNumber === buildRef);

      if (build) {
        return this._client().build(build.id)
          .get();
      }

      throw new Error(
        `Actor ${actorId} has no build tagged or numbered "${buildRef}". Please build the actor first or pick an existing build.`,
      );
    },
    listActors(opts = {}) {
      return this._client().store()
        .list(opts);
    },
    listUserActors(opts = {}) {
      return this._client().actors()
        .list({
          sortBy: "stats.lastRunStartedAt",
          desc: true,
          ...opts,
        });
    },
    listTasks(opts = {}) {
      return this._client().tasks()
        .list(opts);
    },
    listBuilds({ actorId }) {
      return this._client().actor(actorId)
        .builds()
        .list();
    },
    listKeyValueStores(opts = {}) {
      return this._client().keyValueStores()
        .list(opts);
    },
    listDatasets(opts = {}) {
      return this._client().datasets()
        .list(opts);
    },
    listDatasetItems({
      datasetId, params,
    }) {
      return this._client().dataset(datasetId)
        .listItems(params);
    },
    getKVSRecord(kvsId, recordKey) {
      return this._client().keyValueStore(kvsId)
        .getRecord(recordKey);
    },
    getKVSRecordUrl(kvsId, recordKey) {
      return this._client().keyValueStore(kvsId)
        .getRecordPublicUrl(recordKey);
    },
    runTaskSynchronously({
      taskId, params, input,
    }) {
      return this._client().task(taskId)
        .call(input, params);
    },
    setKeyValueStoreRecord({
      storeId, key, value, contentType,
    }) {
      return this._client().keyValueStore(storeId)
        .setRecord({
          key,
          value,
          contentType,
        });
    },
    formatActorOrTaskLabel({
      title, username, name,
    }) {
      if (title) {
        return `${title} (${username}/${name})`;
      }
      return `${username}/${name}`;
    },
  },
};
