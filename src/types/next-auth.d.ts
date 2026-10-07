import type { DefaultSession } from "next-auth";

import type { AppRole } from "@ffpf-zhuelog/core/domain/identity/entities/authenticated-user";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      githubLogin: string;
      githubId?: string;
      role: AppRole;
      accountId?: string;
      sessionVersion?: number;
    };
  }

  interface User {
    githubLogin: string;
    role: AppRole;
    accountId?: string;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    githubLogin: string;
    githubId?: string;
    role: AppRole;
    accountId?: string;
    sessionVersion?: number;
  }
}
