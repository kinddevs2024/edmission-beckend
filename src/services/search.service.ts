import { Chat, Message, StudentProfile, UniversityCatalog, UniversityProfile } from '../models';
import { safeRegExp } from '../utils/validators';

const SEARCH_LIMIT = 10;

export interface SearchUniversityItem {
  id: string;
  name: string;
  country?: string;
  city?: string;
  source: 'catalog' | 'profile';
}

export interface SearchStudentItem {
  id: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  city?: string;
}

export interface SearchChatMessageItem {
  id: string;
  chatId: string;
  text: string;
  createdAt?: string;
}

export interface SearchPageItem {
  path: string;
  labelKey: string;
}

export interface SearchResult {
  universities: SearchUniversityItem[];
  students: SearchStudentItem[];
  chatMessages: SearchChatMessageItem[];
}

export async function searchUniversities(q: string): Promise<SearchUniversityItem[]> {
  const trimmed = q?.trim();
  if (!trimmed) return [];

  const re = safeRegExp(trimmed);
  const orFilter = { $or: [{ universityName: re }, { city: re }, { country: re }] };

  const [catalogs, profiles] = await Promise.all([
    UniversityCatalog.find({ ...orFilter, linkedUniversityProfileId: { $exists: false } })
      .select('universityName country city')
      .limit(SEARCH_LIMIT)
      .lean(),
    UniversityProfile.find({ ...orFilter, verified: true })
      .select('universityName country city')
      .limit(SEARCH_LIMIT)
      .lean(),
  ]);

  const catalogItems: SearchUniversityItem[] = catalogs.map((c) => ({
    id: `catalog-${String((c as { _id: unknown })._id)}`,
    name: (c as { universityName?: string }).universityName ?? '',
    country: (c as { country?: string }).country,
    city: (c as { city?: string }).city,
    source: 'catalog' as const,
  }));

  const profileItems: SearchUniversityItem[] = profiles.map((p) => ({
    id: String((p as { _id: unknown })._id),
    name: (p as { universityName?: string }).universityName ?? '',
    country: (p as { country?: string }).country,
    city: (p as { city?: string }).city,
    source: 'profile' as const,
  }));

  return [...catalogItems, ...profileItems].slice(0, SEARCH_LIMIT);
}

export async function searchStudents(q: string): Promise<SearchStudentItem[]> {
  const trimmed = q?.trim();
  if (!trimmed) return [];

  const re = safeRegExp(trimmed);
  const filter = {
    $or: [{ firstName: re }, { lastName: re }],
  };

  const list = await StudentProfile.find(filter)
    .select('firstName lastName country city')
    .limit(SEARCH_LIMIT)
    .lean();

  return list.map((s) => ({
    id: String((s as { _id: unknown })._id),
    firstName: (s as { firstName?: string }).firstName,
    lastName: (s as { lastName?: string }).lastName,
    country: (s as { country?: string }).country,
    city: (s as { city?: string }).city,
  }));
}

export async function searchChatMessages(userId: string, q: string): Promise<SearchChatMessageItem[]> {
  const trimmed = q?.trim();
  if (!trimmed) return [];

  const studentProfile = await StudentProfile.findOne({ userId }).select('_id').lean();
  const universityProfile = await UniversityProfile.findOne({ userId }).select('_id').lean();
  let chatIds: unknown[] = [];
  if (studentProfile) {
    const chats = await Chat.find({ studentId: (studentProfile as { _id: unknown })._id }).select('_id').lean();
    chatIds = chats.map((c) => (c as { _id: unknown })._id);
  } else if (universityProfile) {
    const chats = await Chat.find({ universityId: (universityProfile as { _id: unknown })._id }).select('_id').lean();
    chatIds = chats.map((c) => (c as { _id: unknown })._id);
  }
  if (chatIds.length === 0) return [];

  const re = safeRegExp(trimmed);
  const messages = await Message.find({ chatId: { $in: chatIds }, type: 'text', message: re })
    .sort({ createdAt: -1 })
    .limit(SEARCH_LIMIT)
    .select('message chatId createdAt')
    .lean();

  return messages.map((m) => ({
    id: String((m as { _id: unknown })._id),
    chatId: String((m as { chatId: unknown }).chatId),
    text: ((m as { message?: string }).message ?? '').slice(0, 120),
    createdAt: (m as { createdAt?: Date }).createdAt?.toISOString?.(),
  }));
}

export async function globalSearch(q: string, role: string, userId?: string): Promise<SearchResult> {
  const trimmed = q?.trim();
  if (!trimmed) return { universities: [], students: [], chatMessages: [] };

  const isStudent = role === 'student';
  const isUniversity = role === 'university';
  const isAdmin = role === 'admin';
  const isSchool = role === 'school_counsellor';

  const chatPromise = (isStudent || isUniversity) && userId ? searchChatMessages(userId, trimmed) : Promise.resolve([]);

  const [universities, students, chatMessages] = await Promise.all([
    isStudent || isUniversity || isAdmin ? searchUniversities(trimmed) : [],
    isUniversity || isAdmin || isSchool ? searchStudents(trimmed) : [],
    chatPromise,
  ]);

  return { universities, students, chatMessages };
}
