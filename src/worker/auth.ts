import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

export type AuthEnv = {
  CONTROL_DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
};

const orderMateStatements = {
  catalogue: ["read", "create", "update", "delete"],
  inventory: ["read", "create", "update", "delete"],
  purchasing: ["read", "create", "update", "delete"],
  orders: ["read", "create", "update", "delete"],
  customers: ["read", "create", "update", "delete"],
  reports: ["read"],
  settings: ["read", "update"],
} as const;

const statement = {
  ...defaultStatements,
  ...orderMateStatements,
} as const;

const ac = createAccessControl(statement);

const allOrderMatePermissions = {
  catalogue: ["read", "create", "update", "delete"],
  inventory: ["read", "create", "update", "delete"],
  purchasing: ["read", "create", "update", "delete"],
  orders: ["read", "create", "update", "delete"],
  customers: ["read", "create", "update", "delete"],
  reports: ["read"],
  settings: ["read", "update"],
} as const;

/**
 * Better Auth replaces the built-in owner/admin/member permissions when custom
 * roles are supplied. Always merge the matching organization baseline back in;
 * otherwise an OrderMate owner could lose member/invitation management rights.
 */
const roles = {
  owner: ac.newRole({
    ...ownerAc.statements,
    ...allOrderMatePermissions,
  }),
  admin: ac.newRole({
    ...adminAc.statements,
    ...allOrderMatePermissions,
  }),
  manager: ac.newRole({
    ...memberAc.statements,
    ...allOrderMatePermissions,
    inventory: ["read", "update"],
    settings: ["read", "update"],
  }),
  inventory: ac.newRole({
    ...memberAc.statements,
    catalogue: ["read"],
    inventory: ["read", "create", "update", "delete"],
    purchasing: ["read", "create", "update", "delete"],
    orders: ["read"],
    customers: ["read"],
    reports: ["read"],
  }),
  fulfilment: ac.newRole({
    ...memberAc.statements,
    catalogue: ["read"],
    inventory: ["read", "update"],
    orders: ["read", "update"],
    customers: ["read"],
  }),
  viewer: ac.newRole({
    ...memberAc.statements,
    catalogue: ["read"],
    inventory: ["read"],
    purchasing: ["read"],
    orders: ["read"],
    customers: ["read"],
    reports: ["read"],
    settings: ["read"],
  }),
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
