import { AppError } from '../errors/AppError.js';

/**
 * Validates and coerces request input with zod schemas.
 * Parsed values are exposed on `req.valid.{headers,params,query,body}`
 * (Express 5's req.query is read-only, so we never overwrite the originals).
 *
 *   router.get('/', validate({ query: listSchema }), handler)
 */
export function validate(schemas) {
  return function validateMiddleware(req, _res, next) {
    req.valid = req.valid ?? {};
    const issues = {};

    for (const part of ['headers', 'params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part] ?? {});
      if (result.success) {
        req.valid[part] = result.data;
      } else {
        const { formErrors, fieldErrors } = result.error.flatten();
        // formErrors carries object-level issues such as unrecognised keys.
        issues[part] = formErrors.length > 0 ? { ...fieldErrors, _errors: formErrors } : fieldErrors;
      }
    }

    if (Object.keys(issues).length > 0) {
      return next(AppError.badRequest('Validation failed', issues, 'VALIDATION_ERROR'));
    }
    return next();
  };
}
