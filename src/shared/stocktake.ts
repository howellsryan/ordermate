export type StocktakeLineInput = {
  variantId: string;
  expectedOnHand: number;
  expectedReserved: number;
  countedOnHand: number;
};

export type StocktakeRequest = {
  locationId: string;
  reason?: string;
  lines: StocktakeLineInput[];
};

export type StocktakeResponse = {
  ok: true;
  stocktakeId: string;
  countedLines: number;
  changedLines: number;
  totalVariance: number;
};
