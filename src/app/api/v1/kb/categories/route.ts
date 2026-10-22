import { apiRoute } from "@/server/api";
import { createKbCategory, kbCategorySchema, listKbCategories } from "@/server/services/kb";

export const GET = apiRoute({ public: true, optionalAuth: true }, ({ viewer }) => listKbCategories(viewer));
export const POST = apiRoute({ permission: "kb.publish", body: kbCategorySchema, skipAudit: true }, ({ actor, body, audit }) => createKbCategory(actor, body, audit));
