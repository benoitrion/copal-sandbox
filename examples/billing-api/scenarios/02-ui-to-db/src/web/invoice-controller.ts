import type { InvoiceService } from "../service/invoice-service";
import { InvoiceRepo } from "../persistence/invoice-repo";

export function invoiceRoutes(app: { get: Function; post: Function }, service: InvoiceService, repo: InvoiceRepo) {
  app.get("/customers/:id/invoices", (req: { params: { id: string } }) => {
    console.log("listing invoices for", req.params.id);
    return repo.findByCustomer(req.params.id);
  });
  app.post("/invoices/preview", (req: { body: any }) => service.preview(req.body.lines));
}
