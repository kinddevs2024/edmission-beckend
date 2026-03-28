export type ProfileVisibility = 'private' | 'public';

/** Treat missing / unknown as private (safe default). */
export function effectiveProfileVisibility(value: unknown): ProfileVisibility {
  return value === 'public' ? 'public' : 'private';
}

/** Strip PII for university discovery / pipeline / dashboard list items. */
export function redactStudentForUniversityListing(student: Record<string, unknown>): Record<string, unknown> {
  if (effectiveProfileVisibility(student.profileVisibility) === 'public') {
    return { ...student };
  }
  const o = { ...student };
  delete o.firstName;
  delete o.lastName;
  delete o.avatarUrl;
  delete o.userEmail;
  if (o.userId && typeof o.userId === 'object' && o.userId !== null) {
    const u = o.userId as Record<string, unknown>;
    o.userId = u._id != null ? { _id: u._id } : o.userId;
  }
  return o;
}

/** Strip PII from populated student subdocument for university chat APIs. */
export function redactStudentForUniversityChat(student: Record<string, unknown>): Record<string, unknown> {
  return redactStudentForUniversityListing(student);
}
