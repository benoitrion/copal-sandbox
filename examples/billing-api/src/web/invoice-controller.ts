import type { InvoiceService } from "../service/invoice-service";

export function invoiceRoutes(app: { get: Function; post: Function }, service: InvoiceService) {
  app.get("/customers/:id/invoices", (req: { params: { id: string } }) => service.listForCustomer(req.params.id));
  app.post("/invoices/preview", (req: { body: { lines: [] } }) => service.preview(req.body.lines));
}
