// Cross-module port interfaces
// Ports are the only way modules communicate synchronously (Level 2/3).
//
// Each port is declared here as an interface + DI token symbol.
// The owning module provides the implementation.
// The consuming module never imports the implementation — only this interface + token.
//
// Level 2 = read-only query port
// Level 3 = transactional command port (accepts TransactionRef)
//
// Example (will be added during Inventory module implementation):
// ```typescript
// export const INVENTORY_STOCK_PORT = Symbol('INVENTORY_STOCK_PORT');
//
// export interface InventoryStockPort {
//   getAvailability(input: { productVariantIds: string[]; warehouseId: string }): Promise<AvailabilitySnapshot[]>;
//   reserve(input: ReserveStockInput, tx: TransactionRef): Promise<ReservationRef>;
//   commitReservation(reservationId: string, tx: TransactionRef): Promise<void>;
//   releaseReservation(reservationId: string, tx: TransactionRef): Promise<void>;
// }
// ```

// Placeholder for module-specific port interfaces.
// Ports will be added during module implementation.
