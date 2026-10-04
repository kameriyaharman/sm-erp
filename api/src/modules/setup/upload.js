import multer from 'multer';
import { AppError } from '../../errors/AppError.js';

/**
 * multipart/form-data with one picture in the field "file", kept in memory (it goes into
 * Postgres). The size limit is enforced while streaming, so an oversized upload is cut off
 * instead of buffered. `label` names the thing in error messages ("Photo", "Logo").
 */
export function imageUpload(maxBytes, label) {
  const single = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 2, parts: 3, fieldSize: 256, headerPairs: 50 },
  }).single('file');

  return function uploadImage(req, res, next) {
    single(req, res, (err) => {
      if (!err) {
        if (!req.file) return next(AppError.badRequest('Validation failed', { body: { file: ['Choose a picture to upload'] } }, 'VALIDATION_ERROR'));
        return next();
      }
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'FILE_TOO_LARGE', `${label} can be at most ${maxBytes / (1024 * 1024)} MB`));
        return next(AppError.badRequest('Validation failed', { body: { file: [`Send one picture in the "file" field (${err.code})`] } }, 'VALIDATION_ERROR'));
      }
      return next(AppError.badRequest('The upload could not be read. Send multipart/form-data with one "file" field.', undefined, 'INVALID_UPLOAD'));
    });
  };
}

/** Sends a stored picture with an ETag (sha256) so browsers revalidate cheaply. */
export function sendImage(req, res, row) {
  const etag = `"${row.sha256}"`;
  res.set({
    'Content-Type': row.mime_type,
    'Cache-Control': 'private, no-cache',
    ETag: etag,
    'Content-Disposition': 'inline',
  });
  if (req.get('if-none-match') === etag) return res.status(304).end();
  return res.send(row.data);
}
