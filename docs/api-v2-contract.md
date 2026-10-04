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
- **Teachers are limited to their own classes and subjects** (section 12, `docs/rbac.md`): a teacher's
  sections = sections they are class teacher of + sections where they teach at least one subject
  (`teacher_subject_assignments`). A section/record of their branch outside that scope is **403 `NOT_ASSIGNED`**;
  another branch's id stays **404**.
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
  "classTeacherOf": [ { "sectionId": "", "label": "Grade 5 A" } ],
  "subjects": [ { "sectionId": "", "sectionLabel": "Grade 5 A", "subjectId": "", "subjectName": "English" } ] }
```
`subjects` = current-year teaching assignments (section 12).
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
`sectionId` required when the paper is class-wide. Teacher: the subject teacher of that section (`canEdit: true`) or
its class teacher (read-only, `canEdit: false`); anyone else 403 `NOT_ASSIGNED`. Admins: `canEdit: true`.
```json
{ "data": { "paper": { ...paper shape..., "exam": { "id": "", "name": "" } },
  "section": { "id": "", "name": "", "label": "Grade 5 A" },
  "canEdit": true,
  "students": [ { "studentId": "", "name": "", "rollNumber": "1", "admissionNumber": "",
                  "marksObtained": 72.5 | null, "isAbsent": false, "remarks": null } ] } }
```
### PUT /marks (STAFF)
`{ paperId, entries: [ { studentId, marksObtained: number|null, isAbsent: boolean, remarks?: string } ] }` (max 200)
- Upsert on `(exam_schedule_id, student_id)`; `marksObtained` must be 0..maxMarks; `isAbsent` ⇒ marks null.
  An entry with `marksObtained: null` and `isAbsent: false` deletes the row (clears the mark).
- Student must be in the paper's class (and section, if set) → otherwise 422 `STUDENT_NOT_IN_CLASS`.
- Locked paper → 409 `PAPER_LOCKED`. Returns `{ data: { saved: n, cleared: n } }`.
- Teacher: only students of sections where they teach the paper's subject → otherwise 403 `NOT_ASSIGNED`
  (`details.studentIds`); a class teacher cannot edit other subjects.

### Teacher shortcut: GET /teacher/papers (teacher) → current-year papers whose subject the teacher teaches in at least
one section of the paper's class; same shape as `/exams/:id/papers` plus `"exam": { "id", "name", "status" }` and
`"sections": [ { "id", "label", "canEdit" } ]` (the sections they teach it in, `canEdit: true`, plus their
class-teacher section of that class read-only), ordered by exam start_date desc.

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

### GET /homework?sectionId=&page=&limit= (STAFF). Newest first.
Teacher: only their sections (class teacher or subject teacher); a `sectionId` outside them → 403 `NOT_ASSIGNED`.
```json
{ "data": [ { "id": "", "section": { "id": "", "label": "Grade 5 A" }, "subject": { "id": "", "name": "" } | null,
  "title": "", "details": "", "assignedAt": "", "dueDate": "", "teacher": { "name": "" },
  "createdBy": { "userId": "", "name": "Priya Nair" } | null,
  "canEdit": true,
  "attachments": [ { "id": "", "fileName": "Worksheet.pdf", "mimeType": "application/pdf", "sizeBytes": 41234,
                     "url": "/api/v1/homework/attachments/<id>", "uploadedAt": "" } ] } ], "meta": {...} }
```
`canEdit` = the caller may delete it and add/remove files (admins in scope; a teacher only for homework they set).
### POST /homework (STAFF) `{ sectionId, subjectId?, title (3-200), details? (≤4000), dueDate }` → 201 row
Teacher: `subjectId` required (400) and they must teach that subject in that section (403 `NOT_ASSIGNED`).
Admins may still set homework without a subject. JSON only: files are uploaded afterwards, one per request.
### DELETE /homework/:id: the teacher who set it, or ADMINS → 204 (another teacher's → 403 `NOT_OWNER`)
### Files: see section 12.3.

---

## 7. Timetable: `/timetable`

### GET /timetable?sectionId= (STAFF; teacher: their sections only, else 403 `NOT_ASSIGNED`. Own week: `GET /teacher/timetable`)
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
Teacher: their class-teacher and subject sections (else 403 `NOT_ASSIGNED`). Marking attendance (roster GET / POST)
stays class teacher only (403 `NOT_CLASS_TEACHER`). From `attendance_submissions` + `student_attendance`.
```json
{ "data": { "section": { "id": "", "label": "Grade 5 A" }, "month": "2026-09",
  "days": [ { "date": "2026-09-01", "total": 15, "present": 13, "absent": 1, "late": 1, "leave": 0, "halfDay": 0, "submittedAt": "" } ],
  "students": [ { "studentId": "", "name": "", "rollNumber": "1", "present": 20, "absent": 1, "late": 1, "leave": 0, "halfDay": 0, "percentage": 95.2 } ] } }
```
Days without a register are omitted. `percentage` = (present + late + 0.5·halfDay) / marked days · 100, 1 decimal.

---

## 11. Parent app (parent role; `:studentId` must be one of the parent's children, else 404. The student role uses the same endpoints for itself only, see 15)

### GET /parent/home (existing): now also fills
- `timetable`: `{ "1": Period[], ... "6": Period[] }` from the section timetable (Period = `{ id, start, end, kind, subject, teacher?, room? }` as in `web/src/features/parent/types.ts`; `subject` = label).
- `homework`: latest 5 for the child's section (`HomeworkItem`); `attachments: [ { name, url, sizeKb } ]`
  (`url` = `/api/v1/homework/attachments/<id>`, needs the parent's bearer token).
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
### GET /parent/children/:studentId/homework?page=&limit= → same row shape as `/homework` (with `attachments`, `canEdit: false`), `meta` paging
### GET /parent/children/:studentId/timetable → same as `/timetable` GET
### GET /parent/children/:studentId/transport →
`{ data: { route: { name, vehicleNumber, driverName, driverPhone, attendantName }, stop: { name, pickupTime, dropTime }, stops: [ { name, pickupTime, dropTime, isMine } ] } | null }`
### Report cards (existing): `GET /documents/students/:studentId/report-cards`, PDF `GET /documents/report-cards/:id/pdf`.
### Notices: `GET /notices` (parent rules above).

---

## 12. Teacher subject assignments and homework files (migration `010`)

One teacher per subject per section per academic year (`teacher_subject_assignments`, UNIQUE
`(academic_year_id, section_id, subject_id)`). The class teacher (`sections.class_teacher_id`) is separate and unchanged.

### 12.1 Managing assignments (ADMINS)

#### GET /staff/:id/assignments → current-year assignments of one staff member
```json
{ "data": [ { "id": "", "section": { "id": "", "label": "Grade 5 A" }, "subject": { "id": "", "name": "English", "code": "ENG" } } ] }
```
#### PUT /staff/:id/assignments
`{ "assignments": [ { "sectionId": "", "subjectId": "" } ] (max 200), "reassign": false }` → replaces that teacher's
current-year assignments; returns the GET shape. Duplicate pairs are ignored. `[]` clears them.
- A pair already taught by **another** teacher → 409 `SUBJECT_TAKEN`, message names the teacher,
  `details.conflicts: [ { section: { id, label }, subject: { id, name }, teacher: { staffId, name } } ]`.
  With `reassign: true` the pair moves to this teacher instead.
- Not a teacher account → 422 `NOT_A_TEACHER`; inactive teacher (non-empty list) → 422 `STAFF_INACTIVE`;
  section not of the current year / other branch, or inactive subject → 422 `INVALID_REFERENCE`
  (`details.sectionIds`, `details.subjectIds`); staff outside the admin's scope → 404.

#### GET /school/assignments?sectionId= (STAFF) → who teaches each subject in a section
All active subjects of the branch, in display order:
```json
{ "data": [ { "subject": { "id": "", "name": "English", "code": "ENG" }, "teacher": { "staffId": "", "name": "Priya Nair" } | null } ] }
```

### 12.2 The signed-in teacher (teacher role only)

#### GET /teacher/assignments
```json
{ "data": { "classTeacherOf": [ { "sectionId": "", "label": "Grade 5 A" } ],
            "subjects": [ { "section": { "id": "", "label": "Grade 5 A" }, "subject": { "id": "", "name": "English", "code": "ENG" } } ] } }
```
Use it for the teacher's pickers (homework section + subject, marks, timetable) instead of `/school/classes`.

#### GET /teacher/timetable → the teacher's own week across sections
```json
{ "data": { "teacher": { "staffId": "", "name": "Priya Nair" },
            "days": { "1": [ { "periodNo": 3, "start": "09:00", "end": "09:40", "kind": "class", "subject": { "id": "", "name": "English" },
                               "label": "English", "teacher": { "staffId": "", "name": "" }, "room": "R-501",
                               "section": { "id": "", "label": "Grade 5 A" } } ], "2": [], ... "6": [] } } }
```
Periods are those whose `teacherStaffId` is the caller (set by `PUT /timetable`). Keys "1".."6" always present.

#### GET /teacher/papers: see section 4 (now filtered to the teacher's subjects, with `sections`).

### 12.3 Homework files

Stored in Postgres (`homework_attachments.data`, bytea). At most **5 files** per homework, **5 MB** each.
Allowed: `pdf, jpg, jpeg, png, webp, doc, docx, xls, xlsx, ppt, pptx, txt`. Extension, declared MIME type and content
must agree (magic bytes: `%PDF-`, PNG, JPEG, RIFF/WEBP, OLE `D0 CF 11 E0` for doc/xls/ppt, ZIP `PK` + `word/`|`xl/`|`ppt/`
for docx/xlsx/pptx; txt = valid UTF-8 without NUL bytes). For Office files `application/octet-stream` is accepted as the
declared type (some browsers send it) when the bytes match. The stored type is the canonical one for the extension.
File names are sanitised (no path, control or reserved characters, max 150 chars; Unicode kept).

#### POST /homework/:id/attachments (STAFF: the teacher who set the homework, or ADMINS)
`multipart/form-data`, exactly one file in the field **`file`**. → **201** `{ data: attachment }`
(`{ id, fileName, mimeType, sizeBytes, url, uploadedAt }`).
Errors: 413 `FILE_TOO_LARGE`, 415 `FILE_TYPE_NOT_ALLOWED`, 409 `TOO_MANY_FILES`, 403 `NOT_OWNER`, 404 homework not
found/out of scope, 400 `VALIDATION_ERROR` (no file / wrong field / more than one file), 400 `INVALID_UPLOAD` (malformed body).
Permission and the file count are checked before the body is read.

#### GET /homework/attachments/:id (STAFF + parent) → the file bytes
Headers: `Content-Type` (stored type), `Content-Length`, `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<name>`,
`X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Content-Security-Policy: default-src 'none'; sandbox`.
Access: admins in scope; teacher: their sections (or homework they set), else 403 `NOT_ASSIGNED`; parent: only when one
of their children is in the homework's section, else **404**. Other branch/tenant → 404. Bearer token required, so the
web app downloads with `fetch` + blob (a plain `<a href>` sends no Authorization header).

#### DELETE /homework/attachments/:id (STAFF: the homework's creator, or ADMINS) → 204

---

## 15. Online payments with the school's own Razorpay, and portal logins (migration `013`)

Each school connects its **own** Razorpay account; money goes to the school's bank account. Key secret and webhook
secret are encrypted (AES-256-GCM, `SETTINGS_ENCRYPTION_KEY`, bound to school + column) and never returned or logged.
Which account takes a payment: the branch's own account if it has one, else the school-wide account, else the platform
`RAZORPAY_*` env account (backward compatibility), else online payment is off. Test keys (`rzp_test_`) are allowed in
production only for school codes in `PAYMENTS_TEST_TENANTS` (default `demo`); the mode is shown everywhere and test
receipts say "TEST MODE, no real money".

### 15.1 Settings: `/settings/payments` (ADMINS; owner = school-wide + any branch, branch admin = own branch)

#### GET /settings/payments
```json
{ "data": {
  "schoolCode": "demo", "schoolName": "Demo Public School",
  "webhook": { "url": "https://<web>/api/v1/finance/webhook/demo", "events": ["payment.captured", "payment.failed", "order.paid"] },
  "canEditSchool": true, "testKeysAllowed": true, "encryptionReady": true,
  "platform": { "configured": false, "mode": null },
  "school": Settings | null,
  "branches": [ { "id", "name", "code", "isHeadOffice", "settings": Settings | null,
                  "effective": { "source": "branch|school|platform|none", "enabled": true, "mode": "test|live|null" } } ]
} }
```
`Settings = { id, branchId, provider: "razorpay", keyId, mode, keySecretSet: true, keySecretLast4, webhookSecretSet: true,
webhookSecretLast4, enabled, allowPartial, minAmount: "500.00", verifiedAt, verifyError, lastWebhookAt, updatedAt, updatedBy: { name } | null }`.
The webhook URL is built from `PARENT_PORTAL_URL` (origin), else the request host.

#### PUT /settings/payments
`{ branchId?: uuid|null, keyId, keySecret?, webhookSecret?, enabled?, allowPartial?, minAmount? }` (`.strict()`).
`branchId` omitted = caller's level (owner: school-wide, branch admin: own branch); `null` = school-wide (owner only, else
403 `OWNER_ONLY`). Secrets are write-only: omit to keep the saved ones; required on first save (400), `keySecret` required
when `keyId` changes, `webhookSecret` when the mode changes. Changed keys are checked with Razorpay first
(`GET /v1/orders?count=1`): rejected -> **422 `INVALID_KEYS`**, nothing saved; unreachable -> saved, not verified, stays off.
`enabled: true` only takes effect once the keys are verified (else `warning` in the response). 422 `TEST_KEYS_NOT_ALLOWED`.
Returns the GET body (+ `warning: string|null`).

#### POST /settings/payments/test `{ branchId?: uuid|null }`
→ `{ data: { ok, reason: null|"invalid_keys"|"gateway_error"|"unreadable", message, mode, verifiedAt } }` (always 200).
Keys Razorpay rejects also switch online payment off. 404 `NOT_CONFIGURED`.

#### DELETE /settings/payments?branchId= → `{ data: { openOrders } }` (disconnect: deletes the keys; settled payments stay).

### 15.2 Webhook (public, signature-checked)
`POST /finance/webhook/:tenantCode` with the raw body. The `X-Razorpay-Signature` must match the webhook secret of one
of that school's saved accounts (enabled or not), and the event only reaches that school's orders created with that
account's key id: another school's URL/secret can never settle it (`200 {status:"unknown_order"}`). Bad signature 400
`INVALID_SIGNATURE`; unknown school 404. Events: `payment.captured` / `order.paid` settle (receipt + ledger, idempotent per
school + event id and per payment); `payment.failed` marks an open order `failed` with the bank's reason (a later
capture on the same order still settles it). Responses: `{ status: "processed"|"already_paid"|"payment_failed"|"needs_review"|"ignored"|"unknown_order"|"duplicate" }`.
The legacy `POST /finance/webhook` keeps working for the platform env account only.

### 15.3 Family portal fees
`GET /parent/children/:id/fees` → `onlinePayment: { enabled, mode: "test"|"live"|null, keyId, allowPartial, minAmount }`.
`POST /finance/create-order` uses the student's branch account; Checkout `key` = that account's key id. Parents/students:
part payments only if `allowPartial` (422 `PARTIAL_NOT_ALLOWED`) and ≥ `minAmount` (422 `AMOUNT_TOO_SMALL`, `details.minAmount`).
503 `PAYMENTS_DISABLED` when off. Roles: parent, **student** (own invoices), admins.

### 15.4 Online payments console (ADMINS)
- `GET /finance/online-payments?status=created|paid|failed|expired|needs_review&from=&to=&search=&branchId=&page=&limit=`
  (`expired` = still `created` after `expires_at`; dates by school time zone; search: student, admission no., Razorpay
  order/payment id, receipt no.) → `{ data: [ { id, status, amount, currency, mode, createdAt, paidAt, expiresAt,
  gatewayOrderId, gatewayPaymentId, isDemo, receipt: {id, number, amount}|null, reason, student: {id, name,
  admissionNumber, classLabel}, branch: {id, name}, paidBy: {name, role}|null } ], meta: paging }`
- `GET /finance/online-payments/summary?branchId=` → `{ today: {amount, count}, month: {amount, count}, failedThisMonth,
  needsReview, inProgress, gateway: { source, enabled, mode } }` (collected = receipts of online orders).
- `GET /finance/online-payments/:id` → row + `reviewReason, failureReason, items[], events[ { type, source:
  "webhook"|"reconcile", outcome, detail, paymentId, method, at } ], canReconcile`.
- `POST /finance/online-payments/:id/reconcile` → asks Razorpay (`GET /v1/orders/:id/payments`, with the keys the order
  was made with) and settles a captured payment through the webhook's idempotent path. `{ data: { outcome:
  "settled"|"already_paid"|"authorized"|"failed"|"no_payment"|"needs_review", message, settled: [], order } }`.
  409 `DEMO_ORDER` (demo samples), 409 `GATEWAY_GONE` (account disconnected).

### 15.5 Portal logins: `/portal-access` (ADMINS; branch admin: own branch's students, parents with a child there)
Login ids: **parent** = mobile number in any form (`9810055555`, `+91 98100 55555`, `09810055555`) or email;
**student** = admission number (case-insensitive) or username. `POST /auth/login` accepts all of these; if one phone
matches several parent accounts the password picks the account.
- `GET /portal-access?type=parent|student&search=&classId=&sectionId=&status=none|temporary|active|locked|inactive&page=&limit=`
  → `{ data: [ { userId, type, name, loginId, status, lastLoginAt, passwordSetAt, student?: {id, admissionNumber,
  username, classLabel, branchName}, phone?, email?, children?: [ {id, name, admissionNumber, classLabel} ] } ],
  meta: { schoolCode, schoolName, page, limit, total, totalPages, counts: { none, temporary, active, locked, inactive } } }`.
  `none` = never given a password (`users.password_set_at IS NULL`).
- `POST /portal-access/:userId/reset { password?, mustChange?=true }` → `{ data: { schoolCode, schoolName, portalUrl,
  mustChangePassword, slip: { userId, type, name, loginId, alsoWorks[], classLabel, children?, password } } }`.
  Without `password` a temporary one (`xxxx-xxxx-xxxx`, ~70 bits) is generated, returned **once** (`slip.password`;
  `null` for an admin-typed one) and `must_change_password` is set. Ends all the user's sessions. 422 `WEAK_PASSWORD`,
  409 `ACCOUNT_INACTIVE`, 404 for staff or out of scope.
- `POST /portal-access/bulk { type, classId, sectionId?, onlyWithoutLogin?=true }` → `{ data: { schoolCode, schoolName,
  portalUrl, classLabel, issued, skipped, slips: [slip] } }` (max 300).

### 15.6 Forced password change
Login / `GET /auth/me` return `user.mustChangePassword`. While it is true every endpoint outside `/api/v1/auth/`
answers **403 `PASSWORD_CHANGE_REQUIRED`**. `POST /auth/change-password { currentPassword, newPassword, client? }`
(any signed-in role) → same body as login (new session; other sessions and older tokens end). 422
`CURRENT_PASSWORD_WRONG` (counts toward lockout), 422 `WEAK_PASSWORD` (≥ 8 chars, a letter and a digit, not the login
id). The web app sends such users to `/set-password`.

## 14. Fee setup and day book (migration `012`) (ADMINS)

Design and invariants: `docs/accounts.md`. Branch: branch_admin = own branch; super_admin = `branchId` or the head
office. Money in/out as rupee strings; internally integer paise.

### Fee heads
- `GET /fees/heads?branchId=` → `{ data: [ { id, name, code, description, type: "recurring"|"one_time", defaultFrequency, refundable, optional, displayOrder, isActive, usage: { classes, allocations } } ] }`
- `POST /fees/heads { name, code (upper-cased, A-Z0-9_-), type, defaultFrequency? (recurring only, default quarterly), refundable?, optional?, description?, displayOrder?, branchId? }` → 201. Duplicate → 409 `HEAD_CODE_TAKEN` / `HEAD_NAME_TAKEN`.
- `PATCH /fees/heads/:id` same fields optional + `isActive`. Deactivating a head in a current/future class structure → 409 `HEAD_IN_USE`.
- `DELETE /fees/heads/:id` → 204 only if never used anywhere, else 409 `HEAD_IN_USE`.

### Class-wise structure
- `GET /fees/structure/overview?academicYearId=` → `{ data: { academicYear, years: [...], classes: [ { id, name, annual, heads, installments, students, studentsSetUp } ] } }`
- `GET /fees/structure?classId=&academicYearId=` (default current year) →
  `{ data: { class, academicYear, students, rows: [ { id, feeHead: {id,name,code}, frequency, installmentNo, label, amount, dueDate, allocations, invoiced } ], heads: [...], totals: { annual, byInstallment } } }`
- `PUT /fees/structure { classId, academicYearId?, rows: [ { feeHeadId, frequency, installmentNo, label?, amount, dueDate } ], dryRun?: false }`
  replaces the class+year structure (rows matched by head + instalment no.) → `{ data: structure, impact: { rowsAdded, rowsChanged, rowsRemoved, allocationsUpdated, studentsUpdated, allocationsRemoved, invoicedUnchanged }, dryRun }`.
  Changed rows update **un-invoiced** allocations only (amount, due date, their concession re-computed); removed rows switch off
  un-invoiced allocations. Invoices never change. `dryRun: true` reports the impact and changes nothing.
  Bad rows → 422 `INVALID_STRUCTURE` (`details.issues: [ { path, message } ]`): one frequency per head, instalment no. ≤ the
  frequency's count, no duplicates, due date in the year (up to 3 months before it starts).
- `GET /fees/structure/schedule?frequency=&amount=|total=&dueDay=10&academicYearId=` → `{ data: { rows: [ { installmentNo, label, dueDate, amount } ], total } }`
  (quarterly from April on day 10 = 10 Apr / Jul / Oct / Jan; `total` is split exactly, whole rupees kept whole).
- `POST /fees/structure/copy { fromClassId, fromAcademicYearId?, toClassId, toAcademicYearId?, overwrite?: false }` → 201 `{ data, impact }`;
  due dates shift by the months between the two years. Target has a structure and no overwrite → 409 `STRUCTURE_EXISTS`; empty source → 422 `SOURCE_EMPTY`.
- `GET /fees/structure/apply-preview?classId=&academicYearId=` → `{ data: { students, upToDate, willChange, withInvoices, newAllocations, gross, concession, net, rows: [ { studentId, name, admissionNumber, section, hasInvoices, status: new|partial|up_to_date, newAllocations, gross, concession, net } ] } }`
- `POST /fees/structure/apply { classId, academicYearId?, studentIds? }` → `{ data: { created, students, net, structure } }`: creates the
  missing `student_fee_allocations` (enrolled students of the class), with the students' concession rules applied. Idempotent.

### Concessions
- `GET /students/:id/fee-concession?academicYearId=` → `{ data: { student, academicYear, concessions: [ { id, feeHead|null, type, value, reason, approvedBy, recordedBy, approvedAt } ], allocations: [ { id, feeHead, installmentNo, label, dueDate, baseAmount, concessionType, concessionAmount, netAmount, invoiced, invoiceNumber } ], totals } }`
- `PUT /students/:id/fee-concession { academicYearId?, approvedBy (required when any), concessions: [ { feeHeadId: uuid|null (= all heads), type: "percentage", value: 0-100 } | { type: "flat", value: rupees per instalment } | { type: "full_waiver" }, reason } ] }`
  replaces the student's rules for the year and re-applies them to **un-invoiced** allocations (head rule beats all-heads rule)
  → `{ data, impact: { allocationsUpdated, invoicedUnchanged, unInvoicedBefore, unInvoicedAfter } }`. Empty list = no concession.

### Accounts and day book
- `GET /accounts?branchId=` → `{ data: [ { id, name, type: cash|bank|upi, details, isDefault, defaultFor, isActive, openingBalance, openingDate, balance, entries, firstEntryDate, lastEntryDate } ], meta: { branch, today, totalBalance } }`
- `POST /accounts { name, type, details?, openingBalance, openingDate, isDefault?, branchId? }` → 201 (409 `ACCOUNT_EXISTS`).
- `PATCH /accounts/:id { name?, details?, openingBalance?, openingDate?, isActive?, isDefault?: true }`. 422 `OPENING_AFTER_ENTRIES` (opening date after the first entry), `DEFAULT_ACCOUNT` (deactivating the default), `ACCOUNT_INACTIVE`.
- `POST /accounts/transfer { fromAccountId, toAccountId, amount, date, description?, reference? }` → 201 `{ data: { transferId, voucherNo, amount, date, out: entry, in: entry } }` (contra; not income or expense).
- `GET /accounts/summary?month=YYYY-MM | from=&to=` → `{ data: { from, to, income: [ {category, amount} ], expense: [...], feeRefunds, transfers, totalIncome, totalExpense, net, byAccount } }` (fee refunds reduce fee income; transfers excluded).
- `GET /daybook?date=&accountId=` (default today, school time zone) → `{ data: { date, today, branch: { name, schoolName, address, phone }, opening, totalIn, totalOut, closing, entries: [ entry + { in, out, balance } ], byAccount: [ { account, opening, in, out, closing } ] } }`.
  `opening + totalIn - totalOut = closing`; each entry's `balance` is the running balance.
- `GET /daybook/range?from=&to=&accountId=` (≤ 1 year) → `{ data: { opening, totalIn, totalOut, closing, days: [ { date, opening, in, out, closing, entries } ], byAccount } }`; each day opens with the previous day's closing.
- `GET /ledger?from=&to=&direction=&category=&accountId=&source=&search=&includeDeleted=&page=&limit=` → `{ data: [ entry ], meta: { page, limit, total, totalPages, totalIn, totalOut } }`
- `GET /ledger/export.csv?from=&to=&accountId=` → `text/csv` attachment: header, opening row, one row per entry with running balance, total/closing row.
- `POST /ledger { direction, category, amount, date, accountId?, paymentMode, party?, description, reference?, branchId? }` → 201 entry.
  `in`: categories `admission, donation, transport, canteen, grant, interest, other_income` (`fees` only via fee collection → 400).
  `out`: expense categories; written as an `expenses` row (shows on the Expenses page). Default account by mode (cash → default
  cash account, else default bank). 422 `MODE_ACCOUNT_MISMATCH`, `BEFORE_OPENING_DATE`, `FUTURE_DATE`, `ACCOUNT_INACTIVE`.
- `DELETE /ledger/:id { reason (3-255) }` → 204 soft delete (kept with reason for `includeDeleted`); a transfer deletes both legs;
  an expense entry deletes its expense. Fee receipt / refund entries → 409 `FEE_ENTRY_LOCKED`; already deleted → 409 `ALREADY_DELETED`.
- Entry: `{ id, date, postedAt, voucherNo, direction, category, amount, party, description, paymentMode, reference, account: {id,name,type}, source: fee_receipt|fee_refund|fee_cancel|expense|manual|transfer, online, links: { feeReceiptId, studentId, expenseId, transferId, paymentOrderId, reversesEntryId }, canDelete, createdBy, deleted? }`

### Changed (additive)
- `/expenses`: categories + `rent, printing, canteen, bank_charges, taxes`; rows + `voucherNo`, `account`; `POST` accepts `accountId`,
  rejects a future date (422 `FUTURE_DATE`) or a date before the account's opening date; `DELETE` accepts an optional `{ reason }`.

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

### Teacher subject assignments, RBAC and homework files (migration `010_teacher_assignments_attachments.sql`)

Client requirement: a teacher may only act on the subjects and sections assigned to them, enforced on the server;
homework gets file attachments. Full matrix: `docs/rbac.md`.

- **New**: section 12 (`GET/PUT /staff/:id/assignments`, `GET /school/assignments`, `GET /teacher/assignments`,
  `GET /teacher/timetable`, `POST /homework/:id/attachments`, `GET|DELETE /homework/attachments/:id`).
- **New error codes**: 403 `NOT_ASSIGNED` (teacher, own branch, not their section/subject), 409 `SUBJECT_TAKEN`,
  422 `NOT_A_TEACHER`, 422 `STAFF_INACTIVE`, 413 `FILE_TOO_LARGE`, 415 `FILE_TYPE_NOT_ALLOWED`, 409 `TOO_MANY_FILES`,
  400 `INVALID_UPLOAD`.
- **Changed shapes (additive)**: `/staff` rows + `subjects`; `/homework` (and `/parent/children/:id/homework`) rows +
  `createdBy`, `canEdit`, `attachments`; `GET /marks` + `canEdit`; `/teacher/papers` rows + `sections`;
  parent home `homework[].attachments` now filled (`{ name, url, sizeKb }`).
- **Teacher scope tightened** (was: whole branch):
  - `POST /homework`: `subjectId` required for teachers + must be an assigned (section, subject).
  - `GET /homework`, `GET /students`, `GET /students/:id`, `GET /timetable`, `GET /academics/attendance/history`:
    only the teacher's sections (class teacher or any subject there).
  - `GET /marks`: subject teacher (edit) or class teacher (read-only); `PUT /marks`: subject teacher only, and only
    students of the sections they teach that subject in.
  - `/teacher/papers`: only papers of their subjects.
- **404 vs 403 for teachers**: attendance roster/submit and section report cards now return 404 (not 403
  `NOT_CLASS_TEACHER`) for a section of another branch; a section of their own branch they are not class teacher of is
  still 403 `NOT_CLASS_TEACHER`.
- **Unchanged for teachers** (school-wide reference data, no student records): `/school/classes|subjects|terms`,
  `/school/assignments`, `GET /exams`, `GET /exams/:id/papers`, `GET /notices` (audience all|teachers).
- Uploads use `multer` (memory storage, streamed 5 MB limit); the global JSON body limit (100 kb) is unchanged and
  `express.json()` ignores multipart bodies.

