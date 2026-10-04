# SM ERP: role-based access (RBAC)

Who may do what, module by module. The server enforces every rule below: hiding a button in `web/` is never the
control. Proven end to end by the RBAC e2e script (owner, branch admin, English teacher, maths teacher, two parents,
another tenant, a second branch).

## Roles and scope

| Role | Login | Data scope |
|---|---|---|
| **Owner** (`super_admin` of a tenant) | `owner@demo.school` | Every branch of **their own tenant**. Another tenant's id is a 404. (A platform `super_admin` without a tenant sees all tenants.) |
| **Branch admin** (`branch_admin`) | `admin@demo.school` | **Their own branch** only. Another branch's id is a 404; asking for `?branchId=` of another branch is a 403 `BRANCH_SCOPE_VIOLATION`. |
| **Class teacher** (`teacher` + `sections.class_teacher_id`) | `teacher@demo.school` (Grade 5 A) | The section(s) they are class teacher of, for the current academic year. |
| **Subject teacher** (`teacher` + `teacher_subject_assignments`) | `teacher@` (English 5 A, 6 A), `maths@`, `science@`, `hindi@demo.school` | The (section, subject) pairs assigned to them for the current academic year. One teacher per subject per section. |
| **Parent** (`parent`) | `parent@demo.school` | Only their own children (primary parent `student_profiles.parent_id` or linked guardian `student_guardians`). |
| **Student** (`student`) | admission no. `DPS-1001` (Aarav, any case) | Only themself, in the family portal (`/parent/*` with one child): fees + paying them, attendance, homework + files of their section, timetable, transport, published report cards, notices. A sibling's id is a 404. |

A teacher is usually both: class teacher of one section and subject teacher in several. **"Their sections"** =
class-teacher sections + sections where they teach at least one subject.

### Status codes for "not allowed"

| Situation | Response |
|---|---|
| Role may never call the endpoint (e.g. parent on `/students`, teacher on `/expenses`) | **403** `INSUFFICIENT_ROLE` |
| Teacher, record of **their own branch** but not their section / subject | **403** `NOT_ASSIGNED` (attendance, report cards: `NOT_CLASS_TEACHER`; homework of another teacher: `NOT_OWNER`) |
| Any id of **another branch or tenant** (admins and teachers), or a parent asking for someone else's child / file | **404** (never confirms the record exists) |
| Not signed in / token revoked / account inactive | **401** |
| Signed in with a temporary password and not yet changed it (any endpoint except `/auth/*`) | **403** `PASSWORD_CHANGE_REQUIRED` |

## Matrix

"Yes (tenant)" / "Yes (branch)" = within the role's data scope above. "No" = 403.

### School masters `/school`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| Classes + sections, subjects, terms (pickers) | Yes (tenant) | Yes (branch) | Yes (branch) | Yes (branch) | No | No |
| Fee heads | Yes (tenant) | Yes (branch) | No | No | No | No |
| Who teaches each subject in a section (`/school/assignments`) | Yes (tenant) | Yes (branch) | Yes (branch) | Yes (branch) | No | No |

### Staff and subject assignments `/staff`, `/teacher`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| List staff (with class-teacher sections + subjects) | Yes (tenant) | Yes (branch) | No | No | No | No |
| Add staff | Teacher or branch admin | Teachers only | No | No | No | No |
| Edit staff / deactivate | Yes (tenant) | Yes (branch) | No | No | No | No |
| View / replace a teacher's subject assignments (`/staff/:id/assignments`, `SUBJECT_TAKEN` unless `reassign`) | Yes (tenant) | Yes (branch) | No | No | No | No |
| Own classes + subjects (`/teacher/assignments`) | No | No | Yes | Yes | No | No |
| Own week across sections (`/teacher/timetable`) | No | No | Yes | Yes | No | No |
| Own marks papers (`/teacher/papers`) | No | No | Read-only rows for their CT section inside papers of subjects they teach | Papers of their subjects only | No | No |

### Students `/students`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| List / search students | Yes (tenant) | Yes (branch) | Their sections | Their sections | No | No |
| Student detail (incl. fees, attendance, report cards) | Yes (tenant) | Yes (branch) | Their sections | Their sections | No | No |
| Admit / edit a student | Yes (tenant) | Yes (branch) | No | No | No | No |
| Student photo: view | Yes (tenant) | Yes (branch) | Their sections | Their sections | No | No |
| Student photo: upload / remove; reveal full Aadhaar (logged; elsewhere always `XXXX-XXXX-1234`) | Yes (tenant) | Yes (branch) | No | No | No | No |

### Setup `/setup`, `/settings/school`, `/me`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| Academic years + terms, classes + sections (class teacher), subjects: list / create / edit / safe delete | Yes (any branch, `?branchId=`) | Yes (branch) | No | No | No | No |
| School profile (branch details, codes, principal), logo upload | Yes (any branch) | Yes (branch) | No | No | No | No |
| Change the school (tenant) name | Yes | No (403) | No | No | No | No |
| See the school logo | Yes | Yes | Yes (own branch) | Yes (own branch) | No | No |
| My account: view, change own password (signs out other devices) | Yes | Yes | Yes | Yes | Yes | Yes |
| My account: edit own name / mobile | Yes | Yes | Yes | Yes | No (the office changes a parent's mobile: it links siblings) | No |


### Homework `/homework` (+ files)

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| List homework | Yes (tenant) | Yes (branch) | Their sections (all subjects) | Their sections (all subjects) | Own child's section (`/parent`) | Own section (`/parent`) |
| Set homework | Any section, subject optional | Any section in branch, subject optional | **Only subjects they teach in that section** | **Only (section, subject) assigned** | No | No |
| Delete homework | Yes | Yes | Only homework they set | Only homework they set | No | No |
| Upload a file (max 5 x 5 MB, allowed types only) | Yes | Yes | Only to homework they set | Only to homework they set | No | No |
| Delete a file | Yes | Yes | Only on homework they set | Only on homework they set | No | No |
| Download a file | Yes (tenant) | Yes (branch) | Their sections (or homework they set) | Their sections (or homework they set) | Only for a child's section, else 404 | Only for own section, else 404 |

### Timetable `/timetable`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| Section timetable | Yes (tenant) | Yes (branch) | Their sections | Their sections | Own child (`/parent`) | Own (`/parent`) |
| Replace a section's week (teacher clash check) | Yes (tenant) | Yes (branch) | No | No | No | No |

### Exams, papers and marks `/exams`, `/papers`, `/marks`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| Exams list, papers of an exam (schedule) | Yes (tenant) | Yes (branch) | Yes (branch, read-only) | Yes (branch, read-only) | No | No |
| Create / edit exams and papers, lock marks | Yes (tenant) | Yes (branch) | No | No | No | No |
| View marks of a paper for a section | Yes | Yes | **Read-only for their CT section** (`canEdit: false`) | Sections where they teach that subject (`canEdit: true`) | No | No |
| Enter / change marks | Yes | Yes | No (unless they also teach that subject there) | **Only students of sections where they teach the paper's subject** | No | No |

### Attendance `/academics`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| Markable sections + roster, take / correct attendance | Yes (30-day window) | Yes (30-day window) | Own CT section only (today + 1 day back) | No (`NOT_CLASS_TEACHER`) | No | No |
| Parent-notification status of a day | Yes | Yes | Own CT section | No | No | No |
| Monthly history of a section | Yes (tenant) | Yes (branch) | Their sections | Their sections | Own child (`/parent/children/:id/attendance`) | Own (same endpoint) |

### Report cards and certificates `/documents`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| Section report cards list, generate | Yes | Yes | Own CT section | No (`NOT_CLASS_TEACHER`) | No | No |
| Edit remarks (teacher) / result + principal remarks | Both | Both | Teacher remarks only, before publishing | No | No | No |
| Publish | Yes | Yes | No | No | No | No |
| Report card PDF | Yes | Yes | Own CT section | No | Own child, published only | Own, published only |
| A student's report-card list | Yes | Yes | No | No | Own child, published | Own, published |
| Transfer / bonafide certificates (issue, list, PDF, cancel) | Yes | Yes | No | No | No | No |
| Public QR verification `/verify/:code` | Public (rate-limited) | | | | | |

### Notices `/notices`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| Read | All in scope | All in branch | Audience all / teachers, own branch | Audience all / teachers, own branch | Audience all / parents, children's branches, whole-school or a child's class | Same rule as parents, for their own class |
| Post (optional SMS) / delete | Yes | Yes | No | No | No | No |

### Fees, payments, finance, notifications, transport, expenses

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| Fees: ledgers, invoices, counter payments, analytics, defaulters | Yes (tenant) | Yes (branch) | No | No | No | No |
| Online payment: create order, order status, receipt PDF | Yes | Yes | No | No | Own children's invoices / receipts | Own invoices / receipts |
| Online payments console, summary, detail, **reconcile** (`/finance/online-payments`) | Yes (tenant) | Yes (branch) | No | No | No | No |
| Payment gateway settings (`/settings/payments`): school-wide Razorpay account | Read + write | Read (masked) | No | No | No | No |
| Payment gateway settings: a branch's own account (override) | Any branch | Own branch only | No | No | No | No |
| Portal logins (`/portal-access`): list, reset password, bulk slips | Yes (tenant) | Students of own branch, parents with a child there | No | No | No | No |
| Change own password (`POST /auth/change-password`) | Yes | Yes | Yes | Yes | Yes | Yes |
| SMS broadcasts, fee reminders, notification logs | Yes | Yes | No | No | No | No |
| Transport routes, stops, rider assignments | Yes (tenant) | Yes (branch) | No | No | Own child's route (`/parent`) | No |
| Expenses | Yes (tenant) | Yes (branch) | No | No | No | No |
| Fee setup: fee heads, class-wise structure, copy, apply to students (`/fees/heads`, `/fees/structure*`) | Yes (tenant; `?branchId=` / head office) | Yes (branch) | No | No | No | No |
| Per-student fee concession (`/students/:id/fee-concession`) | Yes (tenant) | Yes (branch) | No | No | No | No |
| One-off charges to a student or a class / section (`POST /fees/charges`) | Yes (tenant) | Yes (branch: own students / classes, others 404) | No | No | No | No |
| Cancel a receipt (`POST /fees/receipts/:id/cancel`); online receipts need `acknowledgeOnlineRefund` | Yes (tenant) | Yes (branch; other branch's receipt 404) | No | No | No | No |
| Generate bills for upcoming instalments: one student (`POST /fees/invoices`) or a class / section (`POST /fees/invoices/bulk`) | Yes (tenant) | Yes (branch) | No | No | No | No |
| "Pay in advance": bill own upcoming instalments, only when the school takes payments online (`POST /parent/children/:id/fees/advance-bill`) | No | No | No | No | Own children (other id 404) | Only themself |
| All transport riders, filtered (`GET /transport/riders`) | Yes (tenant) | Yes (branch) | No | No | No | No |
| Day book, accounts, ledger, transfers, CSV export, month summary (`/accounts*`, `/daybook*`, `/ledger*`) | Yes (tenant; `?branchId=` / head office) | Yes (branch) | No | No | No | No |

### Parent app `/parent`

| Capability | Owner | Branch admin | Class teacher | Subject teacher | Parent | Student |
|---|---|---|---|---|---|---|
| Home, child fees / attendance / homework (+ files) / timetable / transport | No | No | No | No | Own children only (another child id: 404) | Only themself (`children` has one entry, `viewer: "student"`; any other id: 404) |

## How it is enforced (for developers)

- `authorize(...roles)` on every route (role gate) runs after `authenticate`, which re-reads role, tenant, branch and
  status from the database on every request (a deactivated account or role change applies immediately).
- Branch/tenant scope: `staffScope` / `resolveBranchScope` for lists, `assertStaffAccess` / `assertBranchAccess` for
  single records (404 outside scope).
- Teachers: `loadTeacherScope(db, auth)` (`api/src/modules/shared/access.js`) loads the current-year class-teacher
  sections and `teacher_subject_assignments`; the rules themselves are pure functions in
  `api/src/modules/shared/teacher-scope.helpers.js` (`teaches`, `hasSection`, `marksAccess`, `paperSectionsForTeacher`),
  unit-tested in `api/test/rbac.test.js`. `loadSectionInScope` = branch check (404) + teacher section check (403).
- Parents and students: `loadChildForParent` (404 for anyone else's child; a student matches only `student_profiles.user_id`); file downloads check that a child (or the student) is in the homework's section; payments use `isGuardianOf` / `isStudentSelf`.
- Temporary passwords: `authenticate` answers 403 `PASSWORD_CHANGE_REQUIRED` for every endpoint outside `/api/v1/auth/` while `users.must_change_password` is set.
- Payment webhooks are not JWT-authenticated: `/finance/webhook/:tenantCode` must be signed with the webhook secret of one of that school's saved Razorpay accounts and can only settle that school's orders made with that account; the legacy `/finance/webhook` only reaches platform-account orders.
- Files: `api/src/modules/homework/file-type.js` (extension + declared type + magic bytes, filename sanitising),
  unit-tested in `api/test/homework-files.test.js`.
- Changing assignments: admins in the Staff screen (`PUT /staff/:id/assignments`). Changes apply to the teacher's very
  next request (no token refresh needed). A teacher keeps the right to delete homework they set even after the
  subject moves to someone else.
