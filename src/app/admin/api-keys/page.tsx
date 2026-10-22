import type { Metadata } from "next";
import { ALL_PERMISSIONS, PERMISSIONS } from "@/core/rbac/permissions";
import { PageHeader } from "@/components/console/console-shell";
import { requirePagePermission } from "@/server/session";
import { listApiKeys } from "@/server/services/api-key-admin";
import { ApiKeysAdmin } from "./api-keys-admin";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const actor = await requirePagePermission("apikey.manage", "/admin/api-keys");
  const keys = await listApiKeys(actor);
  return (
    <>
      <PageHeader title="API keys" description="For integrations calling /api/v1. A key can never do more than the person who created it can do right now." />
      <ApiKeysAdmin keys={JSON.parse(JSON.stringify(keys))} grantable={ALL_PERMISSIONS.filter((p) => actor.permissions.has(p)).map((p) => ({ key: p, label: PERMISSIONS[p] }))} />
    </>
  );
}
