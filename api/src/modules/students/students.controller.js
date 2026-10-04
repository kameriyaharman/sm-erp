import { NS, invalidate } from '../../cache/cache.js';
import { sendImage } from '../setup/upload.js';
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
  const { detail, tenantId, warnings } = await service.updateStudent(req.auth, req.valid.params.id, req.valid.body);
  await bust(tenantId);
  res.json({ data: detail, ...(warnings.length > 0 && { warnings }) });
}

export async function getPhoto(req, res) {
  sendImage(req, res, await service.getPhoto(req.auth, req.valid.params.id));
}

export async function putPhoto(req, res) {
  res.json({ data: await service.putPhoto(req.auth, req.valid.params.id, req.file) });
}

export async function deletePhoto(req, res) {
  await service.deletePhoto(req.auth, req.valid.params.id);
  res.status(204).end();
}

export async function revealAadhaar(req, res) {
  res.set('Cache-Control', 'no-store').json({ data: await service.revealAadhaar(req.auth, req.valid.params.id) });
}
