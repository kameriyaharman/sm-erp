import { z } from 'zod';
import { uuid } from '../shared/schemas.js';

// super_admin may narrow to one branch; everyone else is scoped to their own branch.
export const branchQuery = z.object({ branchId: uuid.optional() }).strict();
