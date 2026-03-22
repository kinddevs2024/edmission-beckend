import { GlobalFaculty } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

function normalizeItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 100);
}

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

async function makeUniqueCode(name: string, excludeId?: string): Promise<string> {
  const base = slugifyName(name) || 'faculty';
  let code = `global_${base}`;
  let attempt = 1;

  while (true) {
    const existing = await GlobalFaculty.findOne({ code }).select('_id').lean();
    if (!existing || String((existing as { _id: unknown })._id) === excludeId) return code;
    attempt += 1;
    code = `global_${base}_${attempt}`;
  }
}

function toDto(doc: Record<string, unknown>) {
  return {
    ...doc,
    id: String(doc._id ?? ''),
    code: String(doc.code ?? ''),
    name: String(doc.name ?? ''),
    items: Array.isArray(doc.items) ? doc.items.map((item) => String(item)) : [],
    order: doc.order != null ? Number(doc.order) : 0,
  };
}

export async function listGlobalFaculties() {
  const list = await GlobalFaculty.find().sort({ order: 1, name: 1 }).lean();
  return list.map((doc) => toDto(doc as unknown as Record<string, unknown>));
}

export async function createGlobalFaculty(body: { name: string; items?: string[]; order?: number }) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new AppError(400, 'Faculty name is required', ErrorCodes.VALIDATION);

  const doc = await GlobalFaculty.create({
    code: await makeUniqueCode(name),
    name,
    items: normalizeItems(body.items),
    order: body.order != null ? Number(body.order) : 0,
  });

  return toDto(doc.toObject() as unknown as Record<string, unknown>);
}

export async function updateGlobalFaculty(
  id: string,
  body: { name?: string; items?: string[]; order?: number }
) {
  const doc = await GlobalFaculty.findById(id);
  if (!doc) throw new AppError(404, 'Global faculty not found', ErrorCodes.NOT_FOUND);

  if (body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new AppError(400, 'Faculty name is required', ErrorCodes.VALIDATION);
    doc.name = name;
    doc.code = await makeUniqueCode(name, String(doc._id));
  }
  if (body.items !== undefined) doc.items = normalizeItems(body.items);
  if (body.order !== undefined) doc.order = Number(body.order);

  await doc.save();
  return toDto(doc.toObject() as unknown as Record<string, unknown>);
}

export async function deleteGlobalFaculty(id: string) {
  const doc = await GlobalFaculty.findByIdAndDelete(id);
  if (!doc) throw new AppError(404, 'Global faculty not found', ErrorCodes.NOT_FOUND);
  return { deleted: true };
}
