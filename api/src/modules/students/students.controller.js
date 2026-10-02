import { NS, invalidate } from '../../cache/cache.js';
import * as service from './students.service.js';

export async function listStudents(req, res) {
  res.json(await service.listStudents(req.auth, req.valid.query));
}

export async function getStudent(req, res) {
  res.json({ data: await service.getStudent(req.auth, req.valid.params.id) });
}

// A new student changes the fee ledger (allocations) and the attendance section counts.
async function bust(tenantId) {
  await Promise.all([invalidate(NS.FEES, tenantId), invalidate(NS.ATTENDANCE, tenantId)]);
}

export async function admitStudent(req, res) {
  const { detail, tenantId } = await service.admitStudent(req.auth, req.valid.body);
  await bust(tenantId);
  res.status(201).location(`${req.baseUrl}/${detail.id}`).json({ data: detail });
}

export async function updateStudent(req, res) {
  const { detail, tenantId } = await service.updateStudent(req.auth, req.valid.params.id, req.valid.body);
  await bust(tenantId);
  res.json({ data: detail });
}
