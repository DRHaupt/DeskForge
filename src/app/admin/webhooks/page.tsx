import type { Metadata } from "next";
import { PageHeader } from "@/components/console/console-shell";
import { requirePagePermission } from "@/server/session";
import { listWebhooks, WEBHOOK_EVENTS } from "@/server/webhooks";
import { WebhooksAdmin } from "./webhooks-admin";

export const metadata: Metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const actor = await requirePagePermission("webhook.manage", "/admin/webhooks");
  const hooks = await listWebhooks(actor);
  return (
    <>
      <PageHeader title="Webhooks" description="Send signed JSON to other systems when tickets change. Failed deliveries retry with backoff for about a day." />
      <WebhooksAdmin hooks={JSON.parse(JSON.stringify(hooks))} events={[...WEBHOOK_EVENTS].filter((e) => e !== "webhook.test")} />
    </>
  );
}
