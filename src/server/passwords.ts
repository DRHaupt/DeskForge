import bcrypt from "bcryptjs";

const ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Constant-ish time dummy compare so unknown emails take as long as wrong passwords. */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO0pM3PFDdRKv6Vd5sQ5yJ0oS4h1Z5yG2";
export async function dummyVerify(): Promise<void> {
  await bcrypt.compare("not-the-password", DUMMY_HASH);
}
