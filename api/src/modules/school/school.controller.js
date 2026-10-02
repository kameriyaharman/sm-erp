import * as service from './school.service.js';

export async function listClasses(req, res) {
  res.json({ data: await service.listClasses(req.auth, req.valid.query) });
}

export async function listSubjects(req, res) {
  res.json({ data: await service.listSubjects(req.auth, req.valid.query) });
}

export async function listTerms(req, res) {
  res.json({ data: await service.listTerms(req.auth, req.valid.query) });
}

export async function listFeeHeads(req, res) {
  res.json({ data: await service.listFeeHeads(req.auth, req.valid.query) });
}
