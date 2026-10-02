import * as service from './homework.service.js';
import { contentDisposition } from './file-type.js';

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

/** Before multer: permission + file count, so a refused upload is never buffered. */
export async function assertCanUpload(req, _res, next) {
  await service.assertCanUpload(req.auth, req.valid.params.id);
  next();
}

export async function addAttachment(req, res) {
  res.status(201).json({ data: await service.addAttachment(req.auth, req.valid.params.id, req.file) });
}

export async function downloadAttachment(req, res) {
  const file = await service.getAttachmentFile(req.auth, req.valid.params.id);
  res.set({
    'Content-Type': file.mimeType,
    'Content-Length': String(file.data.length),
    'Content-Disposition': contentDisposition(file.fileName),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.end(file.data);
}

export async function deleteAttachment(req, res) {
  await service.deleteAttachment(req.auth, req.valid.params.id);
  res.status(204).end();
}
