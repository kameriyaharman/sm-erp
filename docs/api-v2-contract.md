# SM ERP: API contract for the new school-operations screens

This is the binding contract between the backend (`api/`) and the new web screens (`web/`).
Backend and frontend are built in parallel against this file. If you must deviate, change this
file in the same commit and note it at the bottom under "Changes".

## Conventions (same as the existing API)

- Base path `/api/v1`. Auth: `Authorization: Bearer <access token>`. The web app calls through its
  own `/api/v1/*` proxy, so paths are identical.
- Success: `{ "data": ... }`, lists add `"meta": { "page", "limit", "total", "totalPages" }`
  (plus extra totals where stated). Creates return **201** with `{ data }`. Deletes return **204**.
- Errors: `{ "error": { "code", "message", "details"? } }`. Validation errors: 400
  `VALIDATION_ERROR` with `details` = zod `fieldErrors` (`{ field: [msg] }`).
- Money: rupee decimal **strings** (`"4500.00"`). Accept number or string on input.
- Dates `YYYY-MM-DD`; times `HH:MM` (24 h); timestamps ISO-8601.
- IDs are UUIDs. Request bodies are `.strict()` zod objects.
- **Scope** (use `resolveBranchScope` / `assertBranchAccess` in `api/src/middleware/scope.js`):
  `super_admin` = whole tenant, `branch_admin` = own branch, `teacher` = own branch (`auth.branchId`),
  `parent` = only their own children (`student_profiles.parent_id = auth.userId`).
  Out-of-scope single records are **404**, never 403.
- "Current academic year" = the branch's `academic_years.is_current = true` row.
- `ADMINS` = super_admin + branch_admin. `STAFF` = ADMINS + teacher.
- Teacher name strings are `first_name + ' ' + last_name` from `users`.

---

## 1. School masters: `/school` (STAFF)

### GET /school/classes
Current-year classes of the caller's branch (super_admin: `?branchId=` optional, default all branches of tenant)
```json
{ "data": [ { "id": "", "name": "Grade 5", "numericLevel": 5,
  "sections": [ { "id": "", "name": "A", "label": "Grade 5 A", "capacity": 40, "studentCount": 15,
                  "classTeacher": { "staffId": "", "userId": "", "name": "Priya Nair" } | null } ] } ] }
```
Classes with no section this year are still listed (`sections: []`). Order: display_order, name.

### GET /school/subjects  → `{ data: [ { id, name, code, isGradedOnly, displayOrder } ] }` (active only)
### GET /school/terms     → `{ data: [ { id, name, sequenceNo, startDate, endDate } ] }` (current year)
### GET /school/fee-heads → `{ data: [ { id, name, code } ] }` (ADMINS)

---

## 2. Students: `/students`

### GET /students (STAFF)
Query: `search` (name / admission no / roll / parent phone), `classId`, `sectionId`,
`status` = `active` (default: enrolled+suspended) | `left` (transferred/withdrawn/graduated) | `all`,
`page` (1), `limit` (25, max 100), `sort` = `name` (default) | `admission` | `class`.
```json
{ "data": [ { "id": "", "name": "Aarav Sharma", "firstName": "Aarav", "lastName": "Sharma",
  "admissionNumber": "DPS-1001", "rollNumber": "1", "gender": "male", "dateOfBirth": "2015-01-01",
  "admissionDate": "2022-04-01", "status": "enrolled",
  "class": { "id": "", "name": "Grade 5" } | null, "section": { "id": "", "name": "A" } | null,
  "parent": { "name": "Rakesh Sharma", "phone": "+919800000000" } | null } ],
  "meta": { "page": 1, "limit": 25, "total": 27, "totalPages": 2 } }
```

### GET /students/:id (STAFF)
```json
{ "data": {
  "id": "", "name": "", "firstName": "", "lastName": "", "admissionNumber": "", "admissionDate": "",
  "rollNumber": "", "gender": "", "dateOfBirth": "", "status": "enrolled", "dateOfLeaving": null,
  "bloodGroup": null, "address": null,
  "class": { "id": "", "name": "" } | null, "section": { "id": "", "name": "" } | null,
  "academicYear": { "id": "", "name": "2026-27" },
  "fatherName": "", "motherName": "", "guardianName": null, "socialCategory": "General",
  "penNumber": null, "apaarId": null,
  "parent": { "userId": "", "name": "", "phone": "", "email": null } | null,
  "fees": { "totalFee": "", "paid": "", "pending": "", "overdue": "" },
  "attendance": { "workingDays": 0, "present": 0, "absent": 0, "late": 0, "leave": 0, "halfDay": 0, "percentage": 93.5 | null },
  "transport": { "routeId": "", "routeName": "", "stopName": "", "pickupTime": "07:20" } | null,
  "reportCards": [ { "id": "", "label": "Term 1", "status": "published", "percentage": 82.4, "grade": "A2", "publishedAt": "" | null } ],
  "certificates": [ { "id": "", "type": "bonafide", "number": "", "status": "issued", "issuedAt": "" } ]
} }
```
Fields that the schema does not have (e.g. bloodGroup/address) may be returned as `null`.
`fees`: same numbers as `/fees/students` for that student (total incl. not yet invoiced, paid, pending, overdue).

### POST /students (ADMINS): admission
Body:
```json
{ "firstName": "", "lastName": "", "gender": "male|female|other", "dateOfBirth": "YYYY-MM-DD",
  "classId": "", "sectionId": "", "rollNumber": "12"?, "admissionNumber": "DPS-1050"?,
  "admissionDate": "YYYY-MM-DD"?, "fatherName": ""?, "motherName": ""?,
  "socialCategory": "General|SC|ST|OBC|EWS"?,
  "parent": { "name": "Rakesh Sharma", "phone": "9876543210", "email": ""? },
  "applyFeeStructure": true }
```
- `admissionNumber` omitted → next number in the branch's existing pattern (`<prefix>-<n+1>`; fallback `ADM-0001`).
- `rollNumber` omitted → next number in the section.
- Parent: find a `parent` user in the tenant by phone (normalise to `+91XXXXXXXXXX`), else create one
  (`password_hash` = bcrypt of a random UUID: cannot log in until the school sets a password).
- Student user row: role `student`, `username` = lower-case admission number, unusable password.
- `applyFeeStructure` (default true): create `student_fee_allocations` from the class's `fee_structures` for the current year.
- 409 `CONFLICT` if the admission number exists. Returns **201** with the same shape as GET /students/:id.

### PATCH /students/:id (ADMINS)
Any of: `firstName, lastName, gender, dateOfBirth, sectionId (same class), rollNumber, fatherName,
motherName, guardianName, socialCategory, penNumber, apaarId, parentPhone`. Returns the detail shape.

---

## 3. Staff: `/staff` (ADMINS)

### GET /staff → `{ data: [ ... ] }`
```json
{ "id": "<staff_profiles.id>", "userId": "", "name": "", "firstName": "", "lastName": "", "email": "",
  "phone": null, "role": "teacher|branch_admin|super_admin", "employeeCode": "", "designation": "",
  "department": "", "dateOfJoining": "", "status": "active",
  "classTeacherOf": [ { "sectionId": "", "label": "Grade 5 A" } ] }
```
### POST /staff
`{ firstName, lastName, email, phone?, designation, department?, employeeCode?, dateOfJoining?, role: "teacher"|"branch_admin", password (min 10) }`
- branch_admin may only create `teacher`. Email unique per tenant (409). Returns 201 with the row shape.

### PATCH /staff/:id → `{ designation?, department?, phone?, status?: "active"|"inactive" }`

---

## 4. Exams, papers and marks

### GET /exams (STAFF) → `{ data: [ ... ] }` current year, ordered by start_date, name
```json
{ "id": "", "name": "Half Yearly Exam", "examType": "mid_term", "componentCode": "TERM" | null,
  "term": { "id": "", "name": "Term 1" } | null, "startDate": "", "endDate": "", "status": "completed",
  "papers": 10, "marksEntered": 270, "marksExpected": 270 }
```
`marksExpected` = sum over papers of students in that class/section; `marksEntered` = marks_entry rows (absent counts as entered).

### POST /exams (ADMINS)
`{ name, examType: unit_test|periodic|mid_term|final|practical|internal|other, componentCode?: PT|NB|SEA|MA|PF|TERM, termId?, startDate?, endDate? }` → 201 row shape.
### PATCH /exams/:id (ADMINS): `{ name?, status?: draft|scheduled|ongoing|completed|results_published, startDate?, endDate? }`
(`results_published` sets `results_published_at`.)

### GET /exams/:id/papers (STAFF) → `{ data: [ ... ] }` (optional `?classId=`)
```json
{ "id": "<exam_schedules.id>", "examId": "", "class": { "id": "", "name": "" },
  "section": { "id": "", "name": "" } | null, "subject": { "id": "", "name": "", "code": "" },
  "examDate": "", "maxMarks": 80, "passMarks": 27 | null, "marksLocked": false,
  "entered": 15, "students": 15 }
```
### POST /exams/:id/papers (ADMINS)
`{ classId, subjectIds: [uuid,...], examDate, maxMarks, passMarks? }` → creates one paper per subject for the
whole class (section null); existing papers are skipped. Returns 201 `{ data: { created: n, skipped: n } }`.
### PATCH /papers/:id (ADMINS) `{ examDate?, maxMarks?, passMarks?, marksLocked? }`

### GET /marks?paperId=&sectionId= (STAFF)
`sectionId` required when the paper is class-wide. Teacher: any section of their branch.
```json
{ "data": { "paper": { ...paper shape..., "exam": { "id": "", "name": "" } },
  "section": { "id": "", "name": "", "label": "Grade 5 A" },
  "students": [ { "studentId": "", "name": "", "rollNumber": "1", "admissionNumber": "",
                  "marksObtained": 72.5 | null, "isAbsent": false, "remarks": null } ] } }
```
### PUT /marks (STAFF)
`{ paperId, entries: [ { studentId, marksObtained: number|null, isAbsent: boolean, remarks?: string } ] }` (max 200)
- Upsert on `(exam_schedule_id, student_id)`; `marksObtained` must be 0..maxMarks; `isAbsent` ⇒ marks null.
  An entry with `marksObtained: null` and `isAbsent: false` deletes the row (clears the mark).
- Student must be in the paper's class (and section, if set) → otherwise 422 `STUDENT_NOT_IN_CLASS`.
- Locked paper → 409 `PAPER_LOCKED`. Returns `{ data: { saved: n, cleared: n } }`.

### Teacher shortcut: GET /teacher/papers (teacher) → papers of the current year for every class in the teacher's branch,
same shape as `/exams/:id/papers` plus `"exam": { "id", "name", "status" }`, ordered by exam start_date desc.

### Report cards for a section: GET /documents/sections/:sectionId/report-cards?termId= (STAFF)
`termId` omitted = annual/final cards (term_id IS NULL). Teacher: class teacher only (same rule as generate).
```json
{ "data": [ { "id": "", "studentId": "", "name": "", "rollNumber": "", "status": "generated|published|draft|revoked",
  "percentage": 82.4 | null, "grade": "A2" | null, "rankInSection": 3 | null, "result": "pass",
  "teacherRemarks": null, "publishedAt": null } ] }
```
Existing endpoints stay as they are: `POST /documents/report-cards/generate {sectionId, termId?}`,
`POST /documents/report-cards/publish {sectionId, termId?}`, `PATCH /documents/report-cards/:id`,
`GET /documents/report-cards/:id/pdf`, `GET /documents/students/:studentId/report-cards`.

---

## 5. Notices: `/notices`

### GET /notices (any signed-in role) `?limit=50`
Admins: all of their scope. Teacher: audience all|teachers. Parent: audience all|parents, and `classId` null
or a class one of their children is in. Newest first, pinned first.
```json
{ "data": [ { "id": "", "title": "", "body": "", "audience": "all|parents|teachers",
  "class": { "id": "", "name": "" } | null, "pinned": false, "createdAt": "", "createdBy": { "name": "" } } ] }
```
### POST /notices (ADMINS)
`{ title (3-150), body (3-4000), audience, classId?, pinned?: false, sendSms?: false }`
→ 201 `{ data: { notice: {...}, broadcast: { batchId, recipients } | null } }`. `sendSms` reuses the existing
broadcast (`sendBroadcastNotice`, targetRole parent for parents/all and teacher for teachers).
### DELETE /notices/:id (ADMINS) → 204 (soft delete)

---

## 6. Homework: `/homework`

### GET /homework?sectionId=&page=&limit= (STAFF). Teacher sees their branch; newest first.
```json
{ "data": [ { "id": "", "section": { "id": "", "label": "Grade 5 A" }, "subject": { "id": "", "name": "" } | null,
  "title": "", "details": "", "assignedAt": "", "dueDate": "", "teacher": { "name": "" } } ], "meta": {...} }
```
### POST /homework (STAFF) `{ sectionId, subjectId?, title (3-200), details? (≤4000), dueDate }` → 201 row
### DELETE /homework/:id: the teacher who set it, or ADMINS → 204

---

## 7. Timetable: `/timetable`

### GET /timetable?sectionId= (STAFF)
```json
{ "data": { "section": { "id": "", "label": "Grade 5 A" },
  "days": { "1": [ { "periodNo": 1, "start": "08:00", "end": "08:40", "kind": "class|break|assembly|activity",
                     "subject": { "id": "", "name": "" } | null, "label": "Mathematics",
                     "teacher": { "staffId": "", "name": "" } | null, "room": null } ], "2": [], ... "6": [] } } }
```
Keys "1".."6" (Mon..Sat) always present. `label` = subject name for classes, free text otherwise ("Lunch break").
### PUT /timetable (ADMINS)
`{ sectionId, periods: [ { weekday 1-6, periodNo, start, end, kind, subjectId?, label?, teacherStaffId?, room? } ] }`
Replaces the whole week for the section. Returns the GET shape.

---

## 8. Transport: `/transport` (ADMINS)

### GET /transport/routes
```json
{ "data": [ { "id": "", "name": "Route 1 - Sector 12", "vehicleNumber": "DL 1P C 4521", "driverName": "",
  "driverPhone": "", "attendantName": null, "capacity": 40, "studentCount": 12, "status": "active",
  "stops": [ { "id": "", "name": "", "sequenceNo": 1, "pickupTime": "07:10", "dropTime": "14:20", "studentCount": 3 } ] } ] }
```
### POST /transport/routes `{ name, vehicleNumber, driverName, driverPhone, attendantName?, capacity?, stops: [ { name, pickupTime, dropTime } ] (≥1) }` → 201
### PATCH /transport/routes/:id same fields optional; `stops` if given replaces stops that have no students (409 otherwise).
### GET /transport/routes/:id/students → `{ data: [ { studentId, name, admissionNumber, classLabel: "Grade 5 A", stop: { id, name } } ] }`
### PUT /transport/assignments `{ studentId, routeId: uuid|null, stopId?: uuid }` → `{ data: { studentId, routeId, stopId } }` (null routeId = remove)

---

## 9. Expenses: `/expenses` (ADMINS)

Categories: `salary, utilities, maintenance, transport, supplies, events, other`.
Payment modes: `cash, upi, bank_transfer, cheque, card`.
### GET /expenses?from=&to=&category=&page=&limit=
```json
{ "data": [ { "id": "", "category": "utilities", "description": "", "amount": "12500.00", "expenseDate": "",
  "paymentMode": "bank_transfer", "vendor": null, "reference": null, "createdBy": { "name": "" }, "createdAt": "" } ],
  "meta": { "page": 1, "limit": 25, "total": 40, "totalPages": 2, "totalAmount": "123456.00",
            "byCategory": [ { "category": "salary", "amount": "90000.00" } ] } }
```
### POST /expenses `{ category, description (3-255), amount (>0), expenseDate, paymentMode, vendor?, reference? }` → 201
### DELETE /expenses/:id → 204 (soft delete)
### GET /expenses/monthly?months=12 → `{ data: [ { "month": "2026-04", "amount": "345000.00" } ] }`
Oldest first, months of the current academic year up to the current month (zero-filled).

---

## 10. Attendance history (STAFF)

### GET /academics/attendance/history?sectionId=&month=YYYY-MM
Teacher: sections of their branch. From `attendance_submissions` + `student_attendance`.
```json
{ "data": { "section": { "id": "", "label": "Grade 5 A" }, "month": "2026-09",
  "days": [ { "date": "2026-09-01", "total": 15, "present": 13, "absent": 1, "late": 1, "leave": 0, "halfDay": 0, "submittedAt": "" } ],
  "students": [ { "studentId": "", "name": "", "rollNumber": "1", "present": 20, "absent": 1, "late": 1, "leave": 0, "halfDay": 0, "percentage": 95.2 } ] } }
```
Days without a register are omitted. `percentage` = (present + late + 0.5·halfDay) / marked days · 100, 1 decimal.

---

## 11. Parent app (parent role; `:studentId` must be one of the parent's children, else 404)

### GET /parent/home (existing): now also fills
- `timetable`: `{ "1": Period[], ... "6": Period[] }` from the section timetable (Period = `{ id, start, end, kind, subject, teacher?, room? }` as in `web/src/features/parent/types.ts`; `subject` = label).
- `homework`: latest 5 for the child's section (`HomeworkItem`, `attachments: []`).
- `bus`: `{ routeName, stopName, state: "not_running", etaMinutes: null, updatedAt, pickupTime, dropTime, driverName, driverPhone, vehicleNumber }` or null.

### GET /parent/children/:studentId/fees
```json
{ "data": { "child": { "id": "", "name": "", "className": "", "sectionName": "" },
  "totals": { "totalFee": "", "paid": "", "pending": "", "overdue": "" },
  "invoices": [ { "id": "", "invoiceNumber": "", "periodLabel": "", "issueDate": "", "dueDate": "", "netAmount": "",
                  "paidAmount": "", "balanceAmount": "", "status": "unpaid|partially_paid|paid", "overdue": true,
                  "items": [ { "feeHead": "Tuition", "description": "", "amount": "" } ] } ],
  "upcoming": [ { "feeHead": "Tuition", "installmentNo": 3, "dueDate": "", "netAmount": "" } ],
  "receipts": [ { "id": "", "receiptNumber": "", "receivedAt": "", "amount": "", "paymentMode": "upi" } ],
  "onlinePayment": { "enabled": false } } }
```
Invoices: not cancelled, newest due first. `upcoming` = unbilled allocations. `onlinePayment.enabled` = Razorpay keys configured.
Online pay (existing): `POST /finance/create-order { invoiceIds }`; receipt PDF: `GET /finance/receipts/:receiptId/pdf`.

### GET /parent/children/:studentId/attendance?month=YYYY-MM (default current month)
```json
{ "data": { "month": "2026-09", "days": [ { "date": "2026-09-01", "status": "present" } ],
  "summary": { "workingDays": 22, "present": 20, "absent": 1, "late": 1, "leave": 0, "halfDay": 0, "percentage": 95.5 },
  "year": { "workingDays": 70, "present": 64, "absent": 3, "late": 2, "leave": 1, "halfDay": 0, "percentage": 94.3 } } }
```
### GET /parent/children/:studentId/homework?page=&limit= → same row shape as `/homework`, `meta` paging
### GET /parent/children/:studentId/timetable → same as `/timetable` GET
### GET /parent/children/:studentId/transport →
`{ data: { route: { name, vehicleNumber, driverName, driverPhone, attendantName }, stop: { name, pickupTime, dropTime }, stops: [ { name, pickupTime, dropTime, isMine } ] } | null }`
### Report cards (existing): `GET /documents/students/:studentId/report-cards`, PDF `GET /documents/report-cards/:id/pdf`.
### Notices: `GET /notices` (parent rules above).

---

## Changes
(record deviations here)

Backend implementation (migration `009_school_operations.sql`). All changes are additive or pin down
behaviour the contract left open; no field was renamed or removed.

- **`branchId` for super_admin.** POST `/staff`, `/exams`, `/notices`, `/transport/routes`, `/expenses` accept an
  optional `branchId` (super_admin only; default = the tenant's head office). List GETs (`/school/*`, `/students`,
  `/staff`, `/exams`, `/transport/routes`, `/expenses`, `/expenses/monthly`) accept optional `?branchId=` the same way.
  Other roles passing a different branch get 403 `BRANCH_SCOPE_VIOLATION`.
- **Validation `details`** follow the existing middleware: field errors are grouped by request part,
  e.g. `{ "body": { "firstName": ["Required"] } }` / `{ "query": { "sectionId": [...] } }`.
- **Parent scope** = primary parent (`parent_id`) **or** a linked guardian (`student_guardians`), same rule as
  `/parent/home` and online payments.
- **POST /exams** creates the exam with status `scheduled`.
- **PATCH /students/:id**: changing `sectionId` keeps the roll number if free in the new section, else assigns the
  next one. `parentPhone` links the student to an existing parent account with that mobile; otherwise it updates the
  linked parent's mobile (422 `PARENT_NOT_FOUND` if the student has no parent). Roll clash → 409 `ROLL_NUMBER_TAKEN`.
- **POST /students**: a roll number already used in the section → 409 `ROLL_NUMBER_TAKEN`; section of another
  class → 422 `SECTION_NOT_IN_CLASS`; a section outside the current year → 422 `SECTION_NOT_CURRENT`.
- **PATCH /papers/:id**: lowering `maxMarks` below an entered mark → 422 `MARKS_EXCEED_MAX`; changing `maxMarks` of a
  locked paper that has marks → 409 `PAPER_LOCKED` (send `marksLocked: false` in the same request to unlock).
- **PUT /marks**: `marksObtained` above the paper's maximum → 400 `VALIDATION_ERROR` (`details.body["entries.N.marksObtained"]`).
  GET /marks for a section that does not sit the paper → 422 `SECTION_NOT_IN_PAPER`.
- **PUT /timetable**: overlapping / duplicate periods → 400 `VALIDATION_ERROR` (`details.body["periods.N.field"]`);
  a teacher already teaching another section at an overlapping time that weekday → 409 `TEACHER_CLASH`
  (`details.clashes`). A non-class period without a label gets a default label ("Break", "Assembly", "Activity").
- **PATCH /transport/routes/:id `stops`**: the new list (in order) is matched to existing stops by name
  (case-insensitive); matched stops keep their students, unmatched existing stops are removed only if nobody is
  assigned (else 409 `STOP_IN_USE`). Lowering `capacity` below the riders → 422 `CAPACITY_TOO_LOW`. `status`
  (`active|inactive`) may also be patched.
- **PUT /transport/assignments**: `stopId` omitted → first stop of the route. Full route → 409 `ROUTE_FULL`;
  stop on another route → 422 `STOP_NOT_ON_ROUTE`; inactive route → 422 `ROUTE_INACTIVE`.
- **POST /homework**: `dueDate` before today (school time zone) → 400 `VALIDATION_ERROR`. Teacher deleting another
  teacher's homework → 403 `NOT_OWNER`.
- **GET /parent/children/:id/timetable** for a child with no section: `{ "section": null, "days": { "1": [], ... } }`.
- **Parent home `timetable`** periods also omit `teacher` / `room` when not set; homework without a subject shows
  `subject: "General"`; `bus.updatedAt` is the response time (no live tracking yet).
