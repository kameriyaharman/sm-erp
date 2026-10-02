import multer from 'multer';
import { AppError } from '../../errors/AppError.js';
import { MAX_FILE_BYTES } from './file-type.js';

/**
 * multipart/form-data with exactly one file in the field "file", kept in memory (it goes
 * into Postgres). The size limit is enforced while streaming: a bigger upload is cut off
 * at 5 MB and the rest of the request is drained.
 */
const single = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',            // non-ASCII file names (busboy's default is latin1)
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 5, parts: 6, fieldSize: 1024, headerPairs: 50 },
}).single('file');

export function uploadSingleFile(req, res, next) {
  single(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'FILE_TOO_LARGE', 'Files can be at most 5 MB'));
      return next(AppError.badRequest('Validation failed', { body: { file: [`Send one file in the "file" field (${err.code})`] } }, 'VALIDATION_ERROR'));
    }
    // Malformed multipart body (busboy).
    return next(AppError.badRequest('The upload could not be read. Send multipart/form-data with one "file" field.', undefined, 'INVALID_UPLOAD'));
  });
}
