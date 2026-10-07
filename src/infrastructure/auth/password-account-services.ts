import { PrismaPasswordAccountRepository } from "@/infrastructure/persistence/prisma/repositories/prisma-password-account-repository";
import { ScryptPasswordHasher } from "./scrypt-password-hasher";

// Shared by the Auth.js config and the composition root (which cannot be
// imported from the config without a cycle). The hasher must be a single
// instance: its dummy hash is cached per instance, and a fresh one per request
// would make unknown-ID logins measurably slower than wrong-password ones.
export const passwordHasher = new ScryptPasswordHasher();
export const passwordAccountRepository = new PrismaPasswordAccountRepository();
