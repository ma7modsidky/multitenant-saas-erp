// Event payload schemas
// Each module declares its event payload types here.
// Naming: `<Module><Aggregate><Action>V1` schema + inferred type.
//
// Events are named `<module>.<aggregate>.<pastTense>.v<major>`.
//
// Example:
// ```typescript
// import { z } from 'zod';
//
// export const inventoryStockDepletedV1Schema = z.object({
//   variantId: z.string().uuid(),
//   warehouseId: z.string().uuid(),
//   quantityOnHand: z.string(),
//   reorderPoint: z.string(),
// });
// export type InventoryStockDepletedV1 = z.infer<typeof inventoryStockDepletedV1Schema>;
// ```

// Placeholder for module-specific event schemas.
// Events will be added by each module during implementation.
