import { UniversityProfile, Faculty } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

async function getUniversityIdByUserId(userId: string): Promise<string> {
  const profile = await UniversityProfile.findOne({ userId }).select('_id').lean();
  if (!profile) throw new AppError(404, 'University profile not found', ErrorCodes.NOT_FOUND);
  return String(profile._id);
}

export async function getFaculties(userId: string) {
  const universityId = await getUniversityIdByUserId(userId);
  const list = await Faculty.find({ universityId })
    .sort({ order: 1, name: 1 })
    .lean();
  return list.map((doc) => ({
    ...doc,
    id: String((doc as { _id: unknown })._id),
    universityId: String((doc as { universityId: unknown }).universityId),
  }));
}

export async function getFacultyById(userId: string, facultyId: string) {
  const universityId = await getUniversityIdByUserId(userId);
  const doc = await Faculty.findOne({ _id: facultyId, universityId }).lean();
  if (!doc) throw new AppError(404, 'Faculty not found', ErrorCodes.NOT_FOUND);
  return {
    ...doc,
    id: String((doc as { _id: unknown })._id),
    universityId: String((doc as { universityId: unknown }).universityId),
  };
}

export async function createFaculty(
  userId: string,
  data: { name: string; description: string; order?: number }
) {
  const universityId = await getUniversityIdByUserId(userId);
  const name = String(data.name || '').trim();
  const description = String(data.description ?? '').trim();
  if (!name) throw new AppError(400, 'Faculty name is required', ErrorCodes.VALIDATION);
  if (!description) throw new AppError(400, 'Faculty description is required', ErrorCodes.VALIDATION);

  const created = await Faculty.create({
    universityId,
    name,
    description,
    order: data.order != null ? Number(data.order) : 0,
  });
  return {
    ...created.toObject(),
    id: String(created._id),
    universityId: String(created.universityId),
  };
}

export async function updateFaculty(
  userId: string,
  facultyId: string,
  data: { name?: string; description?: string; order?: number }
) {
  const universityId = await getUniversityIdByUserId(userId);
  const faculty = await Faculty.findOne({ _id: facultyId, universityId });
  if (!faculty) throw new AppError(404, 'Faculty not found', ErrorCodes.NOT_FOUND);

  if (data.name !== undefined) {
    const name = String(data.name).trim();
    if (!name) throw new AppError(400, 'Faculty name is required', ErrorCodes.VALIDATION);
    faculty.name = name;
  }
  if (data.description !== undefined) {
    faculty.description = String(data.description).trim();
  }
  if (data.order !== undefined) faculty.order = Number(data.order);
  await faculty.save();

  const doc = faculty.toObject();
  return {
    ...doc,
    id: String(doc._id),
    universityId: String(doc.universityId),
  };
}

export async function deleteFaculty(userId: string, facultyId: string) {
  const universityId = await getUniversityIdByUserId(userId);
  const result = await Faculty.findOneAndDelete({ _id: facultyId, universityId });
  if (!result) throw new AppError(404, 'Faculty not found', ErrorCodes.NOT_FOUND);
  return { deleted: true };
}
