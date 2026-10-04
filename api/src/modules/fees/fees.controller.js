import * as feesService from './fees.service.js';
import * as charges from './charges.service.js';
import { NS, invalidate } from '../../cache/cache.js';

export async function listStudents(req, res) {
  res.json(await feesService.listStudentFees(req.auth, req.valid.query));
}

export async function getStudentDues(req, res) {
  res.json({ data: await feesService.getStudentDues(req.auth, req.valid.params.studentId) });
}

export async function createInvoice(req, res) {
  const invoice = await feesService.createInvoice(req.auth, req.valid.body);
  await invalidate(NS.FEES, invoice.tenantId ?? req.auth.tenantId);
  res.status(201).location(`${req.baseUrl}/invoices/${invoice.id}`).json({ data: invoice });
}

export async function getInvoice(req, res) {
  res.json({ data: await feesService.getInvoice(req.auth, req.valid.params.invoiceId) });
}

export async function collectPayment(req, res) {
  const { receipt, replayed } = await feesService.collectPayment(
    req.auth,
    req.valid.body,
    req.valid.headers['idempotency-key'],
  );
  if (!replayed) await invalidate(NS.FEES, receipt.tenantId ?? req.auth.tenantId);
  // 201 for a new receipt; 200 when a retry returns the receipt created earlier.
  res.status(replayed ? 200 : 201).set('Idempotent-Replayed', String(replayed)).json({ data: receipt });
}

export async function getAnalytics(req, res) {
  res.json({ data: await feesService.getAnalytics(req.auth, req.valid.query) });
}

export async function createCharges(req, res) {
  const { tenantId, ...data } = await charges.createCharges(req.auth, req.valid.body);
  if (!data.dryRun && data.invoicesCreated > 0) await invalidate(NS.FEES, tenantId ?? req.auth.tenantId);
  res.status(data.dryRun || data.invoicesCreated === 0 ? 200 : 201).json({ data });
}
