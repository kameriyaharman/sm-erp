import { NS, invalidate } from '../../cache/cache.js';
import * as service from './fee-setup.service.js';

// Allocations feed the cached fee ledgers (/fees/students, analytics, defaulters).
const bust = (req, tenantId) => invalidate(NS.FEES, tenantId ?? req.auth.tenantId);

export async function listHeads(req, res) {
  res.json({ data: await service.listHeads(req.auth, req.valid.query) });
}

export async function createHead(req, res) {
  res.status(201).json({ data: await service.createHead(req.auth, req.valid.body) });
}

export async function updateHead(req, res) {
  const data = await service.updateHead(req.auth, req.valid.params.id, req.valid.body);
  await bust(req);
  res.json({ data });
}

export async function deleteHead(req, res) {
  await service.deleteHead(req.auth, req.valid.params.id);
  res.status(204).end();
}

export async function overview(req, res) {
  res.json({ data: await service.overview(req.auth, req.valid.query) });
}

export async function getStructure(req, res) {
  res.json({ data: await service.getStructure(req.auth, req.valid.query) });
}

export async function saveStructure(req, res) {
  const { structure, impact, dryRun } = await service.saveStructure(req.auth, req.valid.body);
  if (!dryRun) await bust(req);
  res.json({ data: structure, impact, dryRun });
}

export async function copyStructure(req, res) {
  const { structure, impact } = await service.copyStructure(req.auth, req.valid.body);
  await bust(req);
  res.status(201).json({ data: structure, impact });
}

export async function schedule(req, res) {
  res.json({ data: await service.schedule(req.auth, req.valid.query) });
}

export async function applyPreview(req, res) {
  res.json({ data: await service.applyPreview(req.auth, req.valid.query) });
}

export async function apply(req, res) {
  const { tenantId, ...data } = await service.apply(req.auth, req.valid.body);
  await bust(req, tenantId);
  res.json({ data });
}

export async function getConcession(req, res) {
  res.json({ data: await service.getConcession(req.auth, req.valid.params.id, req.valid.query) });
}

export async function saveConcession(req, res) {
  const { tenantId, view, impact } = await service.saveConcession(req.auth, req.valid.params.id, req.valid.body);
  await bust(req, tenantId);
  res.json({ data: view, impact });
}
