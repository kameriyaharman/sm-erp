// Must stay in sync with the `user_role` enum in the database.
export const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  BRANCH_ADMIN: 'branch_admin',
  TEACHER: 'teacher',
  PARENT: 'parent',
  STUDENT: 'student',
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));
