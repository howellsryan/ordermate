import { getDemoProfile } from "./demo-profiles";

const KEY = "operating-layer:demo-business-profile:v1";

type ProfileState = {
  profile: string;
  businessName: string;
  address: Record<string, unknown> | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  companyNumber: string | null;
  updatedAt: string | null;
};

function seed(): ProfileState {
  const profile = getDemoProfile();
  return {
    profile: profile.key,
    businessName: profile.businessName.replace(" — Demo", ""),
    address: { line1: "24 Market Lane", city: "Nottingham", postcode: "NG1 6HX", country: "GB" },
    email: `hello@${profile.key}.example.test`,
    phone: "0115 555 0120",
    vatNumber: null,
    companyNumber: null,
    updatedAt: null,
  };
}

function read() {
  const profile = getDemoProfile();
  const raw = window.localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as ProfileState;
      if (parsed.profile === profile.key) return parsed;
    } catch { /* reseed */ }
  }
  const state = seed();
  window.localStorage.setItem(KEY, JSON.stringify(state));
  return state;
}

export function resetDemoBusinessProfile() {
  window.localStorage.removeItem(KEY);
}

export async function demoBusinessProfileApi<T>(path: string, init?: RequestInit): Promise<T> {
  const state = read();
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET") return state as T;
  if (method !== "PATCH") throw new Error("Demo business profile route not found");
  let body: Record<string, unknown> = {};
  if (typeof init?.body === "string") {
    try { body = JSON.parse(init.body) as Record<string, unknown>; } catch { throw new Error("Invalid business profile"); }
  }
  if ("address" in body) state.address = body.address && typeof body.address === "object" ? body.address as Record<string, unknown> : null;
  if ("email" in body) state.email = typeof body.email === "string" && body.email ? body.email : null;
  if ("phone" in body) state.phone = typeof body.phone === "string" && body.phone ? body.phone : null;
  if ("vatNumber" in body) state.vatNumber = typeof body.vatNumber === "string" && body.vatNumber ? body.vatNumber : null;
  if ("companyNumber" in body) state.companyNumber = typeof body.companyNumber === "string" && body.companyNumber ? body.companyNumber : null;
  state.updatedAt = new Date().toISOString();
  window.localStorage.setItem(KEY, JSON.stringify(state));
  return state as T;
}
