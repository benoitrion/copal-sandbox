import { InvoiceRepo } from "../persistence/invoice-repo";
import { invoiceTotal, Line } from "../invoice/total";

export class InvoiceService {
  constructor(private repo: InvoiceRepo) {}

  listForCustomer(customerId: string) {
    return this.repo.findByCustomer(customerId);
  }

  preview(lines: Line[]) {
    return { total: invoiceTotal(lines) };
  }
}
