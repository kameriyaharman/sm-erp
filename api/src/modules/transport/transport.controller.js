import * as service from './transport.service.js';

export async function listRoutes(req, res) {
  res.json({ data: await service.listRoutes(req.auth, req.valid.query) });
}

export async function createRoute(req, res) {
  res.status(201).json({ data: await service.createRoute(req.auth, req.valid.body) });
}

export async function updateRoute(req, res) {
  res.json({ data: await service.updateRoute(req.auth, req.valid.params.id, req.valid.body) });
}

export async function listRouteStudents(req, res) {
  res.json({ data: await service.listRouteStudents(req.auth, req.valid.params.id) });
}

export async function assignStudent(req, res) {
  res.json({ data: await service.assignStudent(req.auth, req.valid.body) });
}
