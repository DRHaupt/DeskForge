/** Password policy check, driven by auth.local.passwordPolicy in config. */
import type { BusinessConfig } from "../config/schema";

export type PasswordPolicy = BusinessConfig["auth"]["local"]["passwordPolicy"];

export function checkPassword(password: string, policy: PasswordPolicy): string[] {
  const problems: string[] = [];
  if (password.length < policy.minLength) problems.push(`must be at least ${policy.minLength} characters`);
  if (password.length > 256) problems.push("must be at most 256 characters");
  if (policy.requireUppercase && !/[A-Z]/.test(password)) problems.push("must contain an uppercase letter");
  if (policy.requireLowercase && !/[a-z]/.test(password)) problems.push("must contain a lowercase letter");
  if (policy.requireNumber && !/\d/.test(password)) problems.push("must contain a number");
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) problems.push("must contain a symbol");
  return problems;
}

export function describePolicy(policy: PasswordPolicy): string {
  const parts = [`at least ${policy.minLength} characters`];
  if (policy.requireUppercase) parts.push("an uppercase letter");
  if (policy.requireLowercase) parts.push("a lowercase letter");
  if (policy.requireNumber) parts.push("a number");
  if (policy.requireSymbol) parts.push("a symbol");
  return `Use ${parts.join(", ")}.`;
}
