# Vertical demo workflow research — 26 September 2026

This note records the real-world workflow evidence used to design Operating Layer's industry demo workspaces. It intentionally separates **observed operational patterns** from **Operating Layer demo decisions**.

The goal is not to pretend that every industry is a warehouse. The demos should show how the existing canonical order, inventory, purchasing, receiving, stocktake and reporting capabilities fit each business while clearly labelling domain-specific service stages that are not yet production modules.

## Product decision

Each demo is a browser-local, resettable business workspace with two layers:

1. **Live core** — steps already represented by the real Operating Layer demo engine, such as customer orders, reservations, stock movements, purchase orders, receiving, transfers, cycle counts, returns, supplier management and reporting.
2. **Vertical prototype** — researched industry-specific steps such as an electrician quote/job/invoice lifecycle, salon appointment checkout, cafe recipe depletion or dropship supplier acknowledgement. These are playable narrative workflow stages in the demo but are explicitly labelled so the demo never implies the production SaaS already provides them.

The shared product principle remains:

> **Detect → prioritise → explain → prepare → human commits**

No vertical demo silently changes production infrastructure, tenant schemas or live customer data. The demo remains local to the browser.

## 1. Retail store

### Observed real-world pattern

Modern retail inventory workflows connect point-of-sale demand to stock, replenishment and physical receiving. Shopify separates the commercial purchase order from the physical inventory transfer: once a PO is ordered, a linked transfer can track shipment and receiving; accepted units become available at the destination and partial/multiple receipts are supported. Inventory transfers can also be received with barcode scanning. Square similarly supports supplier/location purchase orders and partial receiving, while cycle counts update only the items deliberately counted rather than forcing an entire-location overwrite.

### Operating Layer demo

**Juniper & Row — Retail**

- Sale/order consumes available stock.
- Store stock risk enters the Flow Plan.
- Buyer prepares and submits a supplier PO.
- Delivery is partially or fully received into the store/stockroom.
- Inter-location transfer handles stock balancing.
- Cycle count records physical variance without touching uncounted items.
- Return puts stock back through the normal return/movement path.

This demo should emphasize the store + stockroom operating loop, not warehouse-scale wave picking.

### Sources

- Shopify — Purchase orders: https://help.shopify.com/en/manual/products/inventory/purchase-orders
- Shopify — Creating an inventory transfer for a purchase order: https://help.shopify.com/en/manual/products/inventory/purchase-orders/creating-inventory-transfers
- Shopify — Receiving and managing inventory transfers: https://help.shopify.com/en/manual/products/inventory/inventory-transfers/receiving-and-managing-transfers
- Square UK — inventory and purchase-order guidance: https://squareup.com/help/gb/en/

## 2. Electrician / field-service business

### Observed real-world pattern

Jobber documents the common field-service lifecycle as **Request → Quote → Job → Invoice → Payment**. Requests may be submitted by a client or created internally; approved quotes can progress into scheduled jobs; jobs are assigned to a team with line items; invoices bill completed work; payments close the financial loop. Jobber also supports mobile/on-site workflow and progress/deposit invoicing patterns.

An electrical contractor adds a material-control loop around that service lifecycle: depot/van stock, parts used on jobs, replenishment, supplier purchasing and van/depot counts.

### Operating Layer demo

**WiredRight Electrical — Field Service**

- Enquiry/request is triaged.
- Quote is prepared and approved. *(vertical prototype)*
- Job is scheduled/assigned. *(vertical prototype)*
- Parts are issued from van/depot stock. *(live core inventory movement concept)*
- Job is completed. *(vertical prototype)*
- Invoice and payment stages close the service lifecycle. *(vertical prototype)*
- Van stock is counted and replenished from depot or supplier. *(live core)*

The demo deliberately does not relabel a customer order as an appointment or invoice. Service stages remain distinct, while materials use the canonical stock/purchasing engine.

### Sources

- Jobber — Workflow Overview, updated 21 January 2026: https://help.getjobber.com/en/articles/jobber-workflow-overview/
- Jobber — Invoice Basics, updated 27 July 2026: https://help.getjobber.com/en/articles/invoice-basics/
- Jobber — Collect payment on an invoice, updated 6 August 2026: https://help.getjobber.com/en/articles/how-to-collect-payment-on-an-invoice/

## 3. Hairdresser / salon

### Observed real-world pattern

Fresha's current salon workflow creates an appointment by selecting a calendar slot, client and one or more services. Checkout through the point of sale marks the appointment Completed. Inventory is a parallel operational concern: salons can track stock used internally or sold to clients, maintain suppliers, create stock orders from low/out-of-stock or due-for-reorder products, run stocktakes and sell retail products online.

### Operating Layer demo

**Marlow & Finch Hair — Salon**

- Appointment is booked to a stylist/service. *(vertical prototype)*
- Client arrives and service starts. *(vertical prototype)*
- Service/add-ons and retail products are prepared for checkout. *(vertical prototype + live product stock)*
- Checkout completes the appointment. *(vertical prototype)*
- Retail/backbar products are counted and adjusted. *(live core)*
- Low stock becomes a supplier PO and is received back into salon stock. *(live core)*

### Sources

- Fresha — Create appointments: https://www.fresha.com/help-center/knowledge-base/calendar/260-create-appointments-1
- Fresha — Complete appointments: https://www.fresha.com/help-center/knowledge-base/calendar/29-complete-appointments
- Fresha — Create stock orders: https://www.fresha.com/help-center/knowledge-base/inventory/160-create-stock-orders
- Fresha — Inventory and products: https://www.fresha.com/help-center/knowledge-base/inventory
- Fresha — Online product store: https://www.fresha.com/help-center/knowledge-base/inventory/163-create-and-manage-an-online-product-store

## 4. Coffee shop / cafe

### Observed real-world pattern

Restaurant inventory differs materially from ordinary SKU retail because a sold menu item often consumes several ingredient quantities. Lightspeed Restaurant describes recipes as the relationship between finished products and ingredients; made-to-order products can automatically deduct their ingredient quantities when ordered. Its inventory module also includes supplier purchase orders, stock levels, reorder points, stock counts, production batches and explicit wastage events with reasons/value.

### Operating Layer demo

**Ember & Oak Coffee — Cafe**

- Menu sale is captured. *(vertical prototype until POS exists)*
- Recipe consumes beans/milk/syrup quantities. *(vertical prototype)*
- Waste/spoilage is recorded with a reason. *(vertical prototype, conceptually aligned to audited adjustments)*
- Ingredient below-par risk becomes replenishment work. *(live core inventory/replenishment)*
- Supplier PO is reviewed and submitted. *(live core)*
- Delivery is received and counted. *(live core)*

Recipe-level ingredient depletion is intentionally not faked as a normal one-SKU order mutation.

### Sources

- Lightspeed Restaurant — About Inventory: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407517428891-About-Inventory
- Lightspeed Restaurant — Creating and managing recipes: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407511552155-Creating-and-managing-recipes
- Lightspeed Restaurant — Stock levels and conversion: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407517612699-Stock-levels
- Lightspeed Restaurant — Wastage: https://k-series-support.lightspeedhq.com/hc/en-us/articles/7116014889499-Wastage

## 5. Dropshipping

### Observed real-world pattern

Shopify describes dropshipping as a model where the supplier warehouses the product and ships directly to the customer. The customer order flows to the merchant's store and then to the supplier; the supplier picks, packs and ships directly. The merchant does not physically handle inventory or shipping, but remains responsible for customer service and order tracking.

### Operating Layer demo

**Atlas Direct — Dropship**

- Customer order is confirmed. *(live core customer order concept)*
- Supplier is selected and order details are prepared. *(live purchasing/prototype routing)*
- Supplier acknowledges availability. *(vertical prototype)*
- Supplier ships directly to customer with tracking. *(vertical prototype)*
- Late/unavailable supplier exception is surfaced for intervention. *(vertical prototype + Flow Plan principle)*
- Return/refund/customer communication closes the exception path. *(live return concept + vertical prototype)*

The demo should not show warehouse picking for a pure dropship order because that would contradict the operating model.

### Source

- Shopify — Dropshipping: https://help.shopify.com/en/manual/products/dropshipping

## 6. Online ecommerce / fulfilment business

### Observed real-world pattern

A stock-owning ecommerce business combines online customer demand with reservations, pick/pack/ship, returns, replenishment and supplier receiving. Shopify's purchase-order and inventory-transfer model demonstrates the separation between a commercial supplier agreement and physical receiving; returns create a separate reverse-logistics path. This aligns strongly with Operating Layer's current canonical model.

### Operating Layer demo

**Northstar Supply Co. — Ecommerce**

- Order is confirmed and stock is reserved.
- Warehouse picks/scans the order; multiple orders can be wave-picked.
- Fulfilment reduces physical stock through canonical movements.
- Returns record reverse movement and returned quantity.
- Forecast/reorder risk prepares supplier buying work.
- PO is submitted, tracked and partially/fully received.

This remains the deepest **live core** demo because it directly matches the product's existing order/inventory/purchasing model.

## Demo UX requirements

1. Demo launcher must let the visitor choose a business before entering.
2. Every demo gets its own business identity, operational story, sample catalogue labels and location/supplier/customer naming.
3. Add a dedicated **Workstreams** page that explains and lets the user play the realistic business flow.
4. Every workstream step is visibly labelled **Live core** or **Vertical prototype**.
5. Live-core actions deep-link into the existing real demo pages instead of duplicating logic.
6. Vertical-prototype stages can be marked complete/reset locally to make the demo playable, but cannot masquerade as production mutations.
7. Switching demo business resets the shared canonical demo state before applying the next profile so changes from one industry cannot leak into another.
8. Existing guest-demo acceptance tests remain valid for the ecommerce profile; add configuration/vertical tests for every new profile.

## Future production roadmap implied by the research

The vertical demos are also a discovery tool. If customer demand validates these industries, promote prototype stages into production only as reusable domain primitives:

- **Service work:** requests, quotes, jobs, appointments, assigned resources, invoices/payments.
- **Food service:** recipes/BOMs, measurement conversions, production batches, wastage.
- **Dropship:** supplier fulfilment assignments, acknowledgements, direct-shipment tracking and supplier exceptions.

Do not put these into the production tenant schema merely to make a demo look complete. Demo evidence should guide which primitives deserve a real product slice.