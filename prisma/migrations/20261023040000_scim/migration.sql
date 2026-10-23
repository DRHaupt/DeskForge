-- SCIM provisioning (e.g. Microsoft Entra): link users to the identity provider.
ALTER TABLE "users" ADD COLUMN "provisioned_via" TEXT,
ADD COLUMN "scim_external_id" TEXT,
ADD COLUMN "scim_user_name" TEXT;

CREATE INDEX "users_scim_external_id_idx" ON "users"("scim_external_id");
CREATE INDEX "users_scim_user_name_idx" ON "users"("scim_user_name");
