import * as service from './homework.service.js';

export async function listHomework(req, res) {
  res.json(await service.listHomework(req.auth, req.valid.query));
}

export async function createHomework(req, res) {
  res.status(201).json({ data: await service.createHomework(req.auth, req.valid.body) });
}

export async function deleteHomework(req, res) {
  await service.deleteHomework(req.auth, req.valid.params.id);
  res.status(204).end();
}
