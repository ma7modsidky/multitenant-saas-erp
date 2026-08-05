/**
 * Domain error for the inventory module.
 * Codes are stable machine-readable strings surfaced by the API as error codes.
 */
export class InventoryDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryDomainError';
  }
}
