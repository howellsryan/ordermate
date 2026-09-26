export type OperationsReport = {
  generatedAt: string;
  windowDays: number;
  currency: string;
  inventory: {
    onHandUnits: number;
    reservedUnits: number;
    availableUnits: number;
    incomingUnits: number;
    inventoryValueMinor: number;
    trackedPositions: number;
    lowStockPositions: number;
    stockoutPositions: number;
  };
  orders: {
    createdOrders: number;
    openOrders: number;
    grossOrderValueMinor: number;
    fulfilledUnits: number;
    returnedUnits: number;
  };
  purchasing: {
    openPurchaseOrders: number;
    overduePurchaseOrders: number;
    outstandingCommitmentMinor: number;
    receivedUnits: number;
  };
  locations: Array<{
    locationId: string;
    locationName: string;
    onHandUnits: number;
    availableUnits: number;
    inventoryValueMinor: number;
  }>;
  topFulfilled: Array<{
    variantId: string;
    productName: string;
    variantName: string;
    sku: string;
    fulfilledUnits: number;
  }>;
  orderTrend: Array<{
    day: string;
    orders: number;
    grossMinor: number;
  }>;
  movementTrend: Array<{
    day: string;
    fulfilledUnits: number;
    receivedUnits: number;
    returnedUnits: number;
  }>;
};
