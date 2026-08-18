import { describe, expect, it } from 'vitest';

import {
  Bill,
  Grn,
  PurchaseOrder,
  PurchasingDomainError,
  Requisition,
  Supplier,
  SupplierReturn,
  VendorLedgerEntry,
  LEDGER_ENTRY_TYPE,
} from '../../domain/index.js';

const ORG = 'org-1';

function poLines(
  overrides: Array<
    Partial<{ quantity: string; unitCostMinor: string; discountMinor: string; taxRateBpSnapshot: number }>
  > = [{}],
) {
  return overrides.map((o) => ({
    itemNameSnapshot: 'Widget',
    quantity: o.quantity ?? '2',
    unitCostMinor: o.unitCostMinor ?? '1000',
    ...(o.discountMinor !== undefined ? { discountMinor: o.discountMinor } : {}),
    ...(o.taxRateBpSnapshot !== undefined ? { taxRateBpSnapshot: o.taxRateBpSnapshot } : {}),
  }));
}

describe('Supplier (PUR-1)', () => {
  it('PUR-1: requires a non-empty name', () => {
    expect(() => Supplier.create({ id: 's1', organizationId: ORG, code: 'SUP-001', name: '   ' })).toThrow(
      PurchasingDomainError,
    );
  });

  it('PUR-1: trims the name and defaults currency + payment terms', () => {
    const s = Supplier.create({ id: 's1', organizationId: ORG, code: 'SUP-001', name: '  Acme  ' });
    expect(s.name).toBe('Acme');
    expect(s.currency).toBe('USD');
    expect(s.paymentTerms.netDays).toBe(30);
    expect(s.isActive).toBe(true);
  });

  it('PUR-1: update rejects an empty rename', () => {
    const s = Supplier.create({ id: 's1', organizationId: ORG, code: 'SUP-001', name: 'Acme' });
    expect(() => s.update({ name: ' ' })).toThrow(PurchasingDomainError);
  });

  it('PUR-1: update normalizes payment terms and nulls an empty tax id', () => {
    const s = Supplier.create({ id: 's1', organizationId: ORG, code: 'SUP-001', name: 'Acme', taxId: '123' });
    s.update({ taxId: '', paymentTerms: { netDays: 15, discountDays: 10, discountRateBp: 200 } });
    expect(s.taxId).toBeNull();
    expect(s.paymentTerms.netDays).toBe(15);
  });
});

describe('PurchaseOrder (PUR-3, PUR-8)', () => {
  function makePo(status?: string, received = false) {
    const po = PurchaseOrder.create({
      id: 'po1',
      organizationId: ORG,
      number: 'PO-0001',
      supplierId: 'sup-1',
      currency: 'USD',
      lines: poLines(),
      status: status as never,
    });
    if (received) {
      po.applyReceived(po.lines[0]!.id, '1');
    }
    return po;
  }

  it('PUR-8: rejects an empty PO', () => {
    expect(() =>
      PurchaseOrder.create({
        id: 'po1',
        organizationId: ORG,
        number: 'PO-0001',
        supplierId: 'sup-1',
        currency: 'USD',
        lines: [],
      }),
    ).toThrow(/at least one line \(PUR-8\)/);
  });

  it('PUR-8: rejects a zero quantity', () => {
    expect(() =>
      PurchaseOrder.create({
        id: 'po1',
        organizationId: ORG,
        number: 'PO-0001',
        supplierId: 'sup-1',
        currency: 'USD',
        lines: poLines([{ quantity: '0' }]),
      }),
    ).toThrow(PurchasingDomainError);
  });

  it('PUR-8: computes exact line totals including tax (integer math)', () => {
    const po = PurchaseOrder.create({
      id: 'po1',
      organizationId: ORG,
      number: 'PO-0001',
      supplierId: 'sup-1',
      currency: 'USD',
      lines: poLines([{ quantity: '2', unitCostMinor: '1000', taxRateBpSnapshot: 1400 }]),
    });
    expect(po.lines[0]!.lineTotalMinor).toBe('2000');
    // tax = 2000 × 14% = 280; total = 2000 + 280 = 2280
    expect(po.totalMinor).toBe('2280');
    expect(po.toJSON().taxMinor).toBe('280');
  });

  it('PUR-3: enforces the sanctioned transition table', () => {
    const po = makePo();
    po.transitionTo('pending_approval', new Date('2026-01-02T00:00:00Z'));
    po.transitionTo('approved', new Date('2026-01-03T00:00:00Z'));
    po.transitionTo('received', new Date('2026-01-04T00:00:00Z'));
    expect(po.status).toBe('received');
    expect(() => po.transitionTo('approved', new Date())).toThrow(/Illegal PO status transition .* \(PUR-3\)/);
  });

  it('PUR-3: a PO with receipts cannot be cancelled', () => {
    // Cancelling is legal from draft; receipts make it forbidden (PUR-3).
    const po = makePo('draft', true);
    expect(() => po.transitionTo('cancelled', new Date())).toThrow(/has receipts and cannot be cancelled \(PUR-3\)/);
  });

  it('PUR-4: applyReceived rejects an overshoot past the ordered quantity', () => {
    const po = makePo('approved');
    const lineId = po.lines[0]!.id;
    po.applyReceived(lineId, '2');
    expect(() => po.applyReceived(lineId, '1')).toThrow(/would push received .* past ordered .* \(PUR-4\)/);
  });
});

describe('Grn (PUR-4, PUR-5)', () => {
  it('PUR-4: rejects an empty GRN', () => {
    expect(() =>
      Grn.create({ id: 'g1', organizationId: ORG, number: 'GRN-0001', poId: 'po1', supplierId: 'sup-1', lines: [] }),
    ).toThrow(/at least one line \(PUR-4\)/);
  });

  it('PUR-4: rejects a non-positive received quantity', () => {
    expect(() =>
      Grn.create({
        id: 'g1',
        organizationId: ORG,
        number: 'GRN-0001',
        poId: 'po1',
        supplierId: 'sup-1',
        lines: [{ poLineId: 'pl1', quantity: '0', unitCostMinor: '1000' }],
      }),
    ).toThrow(PurchasingDomainError);
  });

  it('PUR-5: a received GRN is immutable — receiving twice is rejected', () => {
    const grn = Grn.create({
      id: 'g1',
      organizationId: ORG,
      number: 'GRN-0001',
      poId: 'po1',
      supplierId: 'sup-1',
      lines: [{ poLineId: 'pl1', quantity: '2', unitCostMinor: '1000' }],
    });
    grn.receive('user-1', new Date('2026-01-05T00:00:00Z'));
    expect(grn.status).toBe('received');
    expect(() => grn.receive('user-2', new Date())).toThrow(/already received and is immutable \(PUR-5\)/);
  });
});

describe('Bill (PUR-6, PUR-7)', () => {
  function makeBill(overrides: { unitCostMinor?: string; quantity?: string } = {}) {
    return Bill.create({
      id: 'b1',
      organizationId: ORG,
      number: 'BILL-0001',
      supplierId: 'sup-1',
      currency: 'USD',
      lines: [
        {
          poLineId: 'pl1',
          grnLineId: 'gl1',
          quantity: overrides.quantity ?? '2',
          unitCostMinor: overrides.unitCostMinor ?? '1500',
        },
      ],
    });
  }

  it('PUR-6: rejects an empty bill', () => {
    expect(() =>
      Bill.create({
        id: 'b1',
        organizationId: ORG,
        number: 'BILL-0001',
        supplierId: 'sup-1',
        currency: 'USD',
        lines: [],
      }),
    ).toThrow(/at least one line \(PUR-6\)/);
  });

  it('PUR-6: only a draft can be approved', () => {
    const bill = makeBill();
    bill.approve(new Date('2026-01-06T00:00:00Z'));
    expect(bill.status).toBe('approved');
    expect(() => bill.approve(new Date())).toThrow(/only a draft can be approved \(PUR-6\)/);
  });

  it('PUR-7: an allocation that exceeds the total is rejected', () => {
    const bill = makeBill(); // total = 2 × 1500 = 3000
    bill.approve(new Date());
    bill.applyPayment('2000', new Date());
    expect(bill.status).toBe('partially_paid');
    expect(bill.balanceDue).toBe('1000');
    expect(() => bill.applyPayment('1001', new Date())).toThrow(/exceed the bill total .* \(PUR-7\)/);
  });

  it('PUR-7: payments cannot be allocated to a draft or void bill', () => {
    const draft = makeBill();
    expect(() => draft.applyPayment('100', new Date())).toThrow(/Cannot allocate a payment to a draft bill \(PUR-7\)/);
    const voidBill = makeBill();
    voidBill.void(new Date());
    expect(voidBill.status).toBe('void');
    expect(() => voidBill.applyPayment('100', new Date())).toThrow(
      /Cannot allocate a payment to a void bill \(PUR-7\)/,
    );
  });

  it('PUR-7: full payment flips the bill to paid', () => {
    const bill = makeBill(); // 3000
    bill.approve(new Date());
    bill.applyPayment('3000', new Date());
    expect(bill.status).toBe('paid');
    expect(bill.balanceDue).toBe('0');
  });
});

describe('SupplierReturn (PUR-11)', () => {
  it('PUR-11: requires a reason code', () => {
    expect(() =>
      SupplierReturn.create({
        id: 'r1',
        organizationId: ORG,
        number: 'RET-0001',
        supplierId: 'sup-1',
        reasonCode: '',
        currency: 'USD',
        lines: [{ quantity: '1', unitCostMinor: '1000' }],
      }),
    ).toThrow(/requires a reason code \(PUR-11\)/);
  });

  it('PUR-11: requires a bill or GRN-line reference', () => {
    expect(() =>
      SupplierReturn.create({
        id: 'r1',
        organizationId: ORG,
        number: 'RET-0001',
        supplierId: 'sup-1',
        reasonCode: 'damaged',
        currency: 'USD',
        lines: [{ quantity: '1', unitCostMinor: '1000' }],
      }),
    ).toThrow(/requires a bill or GRN-line reference \(PUR-11\)/);
  });

  it('PUR-11: computes the return value as Σ quantity × unit cost', () => {
    const ret = SupplierReturn.create({
      id: 'r1',
      organizationId: ORG,
      number: 'RET-0001',
      supplierId: 'sup-1',
      billId: 'b1',
      reasonCode: 'damaged',
      currency: 'USD',
      lines: [
        { quantity: '2', unitCostMinor: '1500' },
        { quantity: '1', unitCostMinor: '500' },
      ],
    });
    expect(ret.amountMinor).toBe('3500');
  });

  it('PUR-11: only a draft can be approved', () => {
    const ret = SupplierReturn.create({
      id: 'r1',
      organizationId: ORG,
      number: 'RET-0001',
      supplierId: 'sup-1',
      billId: 'b1',
      reasonCode: 'damaged',
      currency: 'USD',
      lines: [{ quantity: '1', unitCostMinor: '1000' }],
    });
    ret.approve('user-1', new Date('2026-01-07T00:00:00Z'));
    expect(ret.status).toBe('approved');
    expect(() => ret.approve('user-2', new Date())).toThrow(/only a draft can be approved \(PUR-11\)/);
  });
});

describe('Requisition (PUR-12)', () => {
  it('PUR-12: rejects a requisition without lines', () => {
    expect(() => Requisition.create({ id: 'req1', organizationId: ORG, number: 'REQ-0001', lines: [] })).toThrow(
      /at least one line \(PUR-12\)/,
    );
  });

  it('PUR-12: creates a draft with the given lines', () => {
    const req = Requisition.create({
      id: 'req1',
      organizationId: ORG,
      number: 'REQ-0001',
      requestedBy: 'user-1',
      lines: [{ itemNameSnapshot: 'Widget', quantity: '3', estimatedUnitCostMinor: '800' }],
    });
    expect(req.status).toBe('draft');
    expect(req.lines[0]!.quantity).toBe('3');
    expect(req.lines[0]!.estimatedUnitCostMinor).toBe('800');
  });
});

describe('VendorLedgerEntry (PUR-2)', () => {
  it('PUR-2: signs bills positive and payments/debit notes negative', () => {
    const bill = VendorLedgerEntry.create({
      id: 'e1',
      organizationId: ORG,
      supplierId: 'sup-1',
      type: LEDGER_ENTRY_TYPE.BILL,
      amountMinor: '3000',
      currency: 'USD',
      referenceType: 'bill',
    });
    const payment = VendorLedgerEntry.create({
      id: 'e2',
      organizationId: ORG,
      supplierId: 'sup-1',
      type: LEDGER_ENTRY_TYPE.PAYMENT,
      amountMinor: '2000',
      currency: 'USD',
      referenceType: 'supplier_payment',
    });
    const note = VendorLedgerEntry.create({
      id: 'e3',
      organizationId: ORG,
      supplierId: 'sup-1',
      type: LEDGER_ENTRY_TYPE.DEBIT_NOTE,
      amountMinor: '500',
      currency: 'USD',
      referenceType: 'supplier_return',
    });
    expect(bill.signedMinor).toBe(3000n);
    expect(payment.signedMinor).toBe(-2000n);
    expect(note.signedMinor).toBe(-500n);
  });

  it('PUR-2: the ledger is append-only — corrections are new entries', () => {
    expect(() => VendorLedgerEntry.assertImmutable()).toThrow(/append-only.*\(PUR-2\)/);
  });
});
