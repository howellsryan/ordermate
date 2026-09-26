import type { StocktakeRequest, StocktakeResponse } from "../shared/stocktake";
import { demoTenantApi as acceptanceTenantApi } from "./demo-acceptance";

const DEMO_DATA_KEY = "operating-layer:demo-data:v1";

type MovementRef = {
  id: string;
  movement_type: string;
  reference_type?: string | null;
  reference_id?: string | null;
};

type DemoStateWithMovements = { movements: MovementRef[] };

function readState() {
  const raw = window.localStorage.getItem(DEMO_DATA_KEY);
  if (!raw) throw new Error("Local demo state is not initialised");
  return JSON.parse(raw) as DemoStateWithMovements;
}

function parseStocktake(init?: RequestInit): StocktakeRequest | null {
  if (typeof init?.body !== "string") return null;
  try {
    const parsed = JSON.parse(init.body) as StocktakeRequest;
    return parsed && Array.isArray(parsed.lines) ? parsed : null;
  } catch {
    return null;
  }
}

export async function demoTenantApi<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const url = new URL(path, "https://demo.local");
  if (method !== "POST" || url.pathname !== "/inventory/stocktake") {
    return acceptanceTenantApi<T>(path, init);
  }

  const request = parseStocktake(init);
  const before = readState();
  const existingMovementIds = new Set(before.movements.map(movement => movement.id));

  // The acceptance layer performs the production-parity stale snapshot and
  // reservation validation before the local store mutates anything.
  await acceptanceTenantApi<unknown>(path, init);

  const after = readState();
  const stocktakeId = crypto.randomUUID();
  for (const movement of after.movements) {
    if (existingMovementIds.has(movement.id)) continue;
    if (movement.movement_type !== "stocktake" || movement.reference_type !== "stocktake") continue;
    movement.reference_id = stocktakeId;
  }
  window.localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(after));

  const lines = request?.lines || [];
  const totalVariance = lines.reduce((sum, line) => sum + (line.countedOnHand - line.expectedOnHand), 0);
  const changedLines = lines.filter(line => line.countedOnHand !== line.expectedOnHand).length;
  const response: StocktakeResponse = {
    ok: true,
    stocktakeId,
    countedLines: lines.length,
    changedLines,
    totalVariance,
  };
  return response as T;
}
