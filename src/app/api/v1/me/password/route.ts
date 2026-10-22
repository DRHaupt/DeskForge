import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { checkPassword } from "@/core/auth/password";
import { ValidationError } from "@/core/errors";
import { apiRoute, HttpError } from "@/server/api";
import { db } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/passwords";

/** Change your own password. */
export const POST = apiRoute(
  { authOnly: true, status: 200, rateLimit: 10, auditAction: "user.password_change", body: z.object({ currentPassword: z.string().max(256).optional(), newPassword: z.string().max(256) }) },
  async ({ actor, body }) => {
    if (actor.kind !== "user") throw new HttpError(403, "Only users can change passwords");
    const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (user.passwordHash && !(body.currentPassword && (await verifyPassword(body.currentPassword, user.passwordHash)))) {
      throw new ValidationError("Current password is incorrect", { currentPassword: "incorrect" });
    }
    const problems = checkPassword(body.newPassword, getConfig().auth.local.passwordPolicy);
    if (problems.length) throw new ValidationError(`Password ${problems.join(", ")}`, { newPassword: problems.join(", ") });
    await db.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(body.newPassword), passwordChangedAt: new Date() } });
    return { ok: true };
  },
);
