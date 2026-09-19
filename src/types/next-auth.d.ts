import type { DefaultSession } from "next-auth";

import type { AppRole } from "@/domain/identity/entities/authenticated-user";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      githubLogin: string;
      role: AppRole;
    };
  }

  interface User {
    githubLogin: string;
    role: AppRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    githubLogin: string;
    role: AppRole;
  }
}
