import { createHash } from "crypto";
import {
  WEBHOOK_EVENT_TYPE_GROUPS, WEBHOOK_EVENT_TYPES,
} from "@apify/consts";
import apify from "../../apify.app.mjs";

export default {
  props: {
    apify,
    db: "$.service.db",
    http: {
      type: "$.interface.http",
      customResponse: true,
    },
    eventTypes: {
      type: "string[]",
      label: "Trigger on run states",
      description: "Which terminal run states should fire this trigger. Leave empty to fire on all of them (the default).",
      optional: true,
      options: WEBHOOK_EVENT_TYPE_GROUPS.ACTOR_RUN_TERMINAL.map((value) => {
        const state = value.split(".").pop()
          .replaceAll("_", " ")
          .toLowerCase();
        return {
          label: state.charAt(0).toUpperCase() + state.slice(1),
          value,
        };
      }),
    },
  },
  methods: {
    // SHA-256(endpoint + condition target) - stable across re-deploys so Apify
    // reuses the same webhook instead of creating duplicates.
    getIdempotencyKey() {
      const target = Object.values(this.getCondition()).join(":");
      return createHash("sha256")
        .update(`${this.http.endpoint}:${target}`)
        .digest("hex");
    },
  },
  hooks: {
    async activate() {
      // Whitelist terminal states only; fall back to all when none are valid.
      const selected = (this.eventTypes ?? [])
        .filter((type) => WEBHOOK_EVENT_TYPE_GROUPS.ACTOR_RUN_TERMINAL.includes(type));

      const response = await this.apify.createHook({
        requestUrl: this.http.endpoint,
        eventTypes: selected.length
          ? selected
          : WEBHOOK_EVENT_TYPE_GROUPS.ACTOR_RUN_TERMINAL,
        condition: this.getCondition(),
        idempotencyKey: this.getIdempotencyKey(),
      });
      this.db.set("webhookId", response.id);
    },
    async deactivate() {
      const webhookId = this.db.get("webhookId");
      if (!webhookId) {
        return;
      }

      // Tolerate already-deleted webhooks so deactivate→activate cycles don't break.
      try {
        await this.apify.deleteHook(webhookId);
      } catch (error) {
        console.warn(`Failed to delete Apify webhook ${webhookId} (it may already be removed): ${error.message}`);
      } finally {
        this.db.set("webhookId", null);
      }
    },
  },
  async run({ body }) {
    this.http.respond({
      status: 200,
    });

    this.$emit(body, {
      summary: body.eventType === WEBHOOK_EVENT_TYPES.TEST
        ? "Webhook test has successfully triggered!"
        : this.getSummary(body),
      id: body.eventData.actorRunId || `${body.userId}-${body.createdAt}`,
      ts: Date.parse(body.createdAt),
    });
  },
};
