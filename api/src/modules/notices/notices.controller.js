import * as service from './notices.service.js';

export async function listNotices(req, res) {
  res.set('Cache-Control', 'private, no-store').json(await service.listNotices(req.auth, req.valid.query));
}

export async function createNotice(req, res) {
  res.status(201).json({ data: await service.createNotice(req.auth, req.valid.body) });
}

export async function deleteNotice(req, res) {
  await service.deleteNotice(req.auth, req.valid.params.id);
  res.status(204).end();
}
