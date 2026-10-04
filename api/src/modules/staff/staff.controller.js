import * as service from './staff.service.js';

export async function listStaff(req, res) {
  res.json(await service.listStaff(req.auth, req.valid.query));
}

export async function createStaff(req, res) {
  const staff = await service.createStaff(req.auth, req.valid.body);
  res.status(201).json({ data: staff });
}

export async function updateStaff(req, res) {
  res.json({ data: await service.updateStaff(req.auth, req.valid.params.id, req.valid.body) });
}
