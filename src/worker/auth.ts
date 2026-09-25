import { betterAuth } from "better-auth";
import { createAccessControl } from "better-auth/plugins/access";
import { organization } from "better-auth/plugins";

export type AuthEnv = {
  CONTROL_DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
};

const statement = {
  catalogue: ["read", "create", "update", "delete"],
  inventory: ["read", "create", "update", "delete"],
  purchasing: ["read", "create", "update", "delete"],
  orders: ["read", "create", "update", "delete"],
  customers: ["read", "create", "update", "delete"],
  reports: ["read"],
  settings: ["read", "update"],
} as const;

const ac = createAccessControl(statement);
const all = { catalogue: ["read", "create", "update", "delete"], inventory: ["read", "create", "update", "delete"], purchasing: ["read", "create", "update", "delete"], orders: ["read", "create", "update", "delete"], customers: ["read", "create", "update", "delete"], reports: ["read"], settings: ["read", "update"] } as const;

const roles = {
  owner: ac.newRole(all),
  admin: ac.newRole(all),
  manager: ac.newRole({ ...all, inventory: ["read", "update"], settings: ["read", "update"] }),
  inventory: ac.newRole({ catalogue: ["read"], inventory: ["read", "create", "update", "delete"], purchasing: ["read", "create", "update", "delete"], orders: ["read"], customers: ["read"], reports: ["read"] }),
  fulfilment: ac.newRole({ catalogue: ["read"], inventory: ["read", "update"], orders: ["read", "update"], customers: ["read"] }),
  viewer: ac.newRole({ catalogue: ["read"], inventory: ["read"], purchasing: ["read"], orders: ["read"], customers: ["read"], reports: ["read"], settings: ["read"] }),
};

export function createAuth(env: AuthEnv, request: Request) {
  const origin = new URL(request.url).origin;
  return betterAuth({
    database: env.CONTROL_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: `${origin}/api/auth`,
    trustedOrigins: [origin],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: origin.startsWith("https://"),
    },
    plugins: [organization({ ac, roles })],
  });
}
