export type DeliveryDiscrepancyIssue =
  | {
      type: "reference_mismatch";
      documentPurchaseOrderReference: string;
      expectedPurchaseOrderNumber: string;
    }
  | {
      type: "unexpected_line";
      description: string;
      supplierSku: string;
      sku: string;
      barcode: string;
      quantity: number | null;
      warnings: string[];
    }
  | {
      type: "quantity_variance";
      lineId: string;
      sku: string;
      description: string;
      documentQuantity: number;
      receivedQuantity: number;
    };

export type DeliveryDiscrepancyEvidence = {
  version: 1;
  proposalKey: string;
  proposalEventId: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  documentReference: string;
  documentDate: string;
  issues: DeliveryDiscrepancyIssue[];
};

export type DeliveryDiscrepancyResolutionCode =
  | "supplier_follow_up"
  | "accepted_variance"
  | "corrected_document"
  | "other";

export type DeliveryDiscrepancyRecord = {
  id: string;
  purchase_order_id: string;
  purchase_order_number: string;
  supplier_name: string;
  location_name: string;
  proposal_key: string;
  proposal_event_id: string;
  status: "open" | "resolved";
  issue_count: number;
  evidence_json: string;
  created_at: string;
  created_by: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_code: DeliveryDiscrepancyResolutionCode | null;
  resolution_note: string | null;
};

export type DeliveryDiscrepancyCreateRequest = {
  proposalKey: string;
  proposalEventId: string;
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  documentReference: string;
  documentDate: string;
  issues: DeliveryDiscrepancyIssue[];
};
