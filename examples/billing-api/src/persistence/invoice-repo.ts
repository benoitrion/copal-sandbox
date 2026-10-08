export interface Db {
  query(sql: string, params?: unknown[]): Promise<unknown[]>;
}

export class InvoiceRepo {
  constructor(private db: Db) {}

  findByCustomer(customerId: string) {
    return this.db.query("SELECT * FROM invoices WHERE customer_id = $1", [customerId]);
  }
}
