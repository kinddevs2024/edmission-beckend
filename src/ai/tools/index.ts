/**
 * AI tools: executable functions the assistant can call to query the database.
 * Used when the LLM requests tool_calls (e.g. search_universities, search_students).
 */

import mongoose from 'mongoose';
import type { Role } from '../../types/role';
import * as searchService from '../../services/search.service';
import * as studentService from '../../services/student.service';
import { UniversityProfile, StudentProfile, Program, Interest, Offer, Recommendation, Scholarship } from '../../models';
import { safeRegExp } from '../../utils/validators';
import { logger } from '../../utils/logger';

const MAX_TOOL_LIMIT = 20;
const MAX_QUERY_LENGTH = 200;
/** Timeout per tool execution so one slow query does not hang the chat. */
const TOOL_TIMEOUT_MS = 8000;

export const TOOL_NAMES = {
  search_universities: 'search_universities',
  get_university_details: 'get_university_details',
  search_students: 'search_students',
  search_programs: 'search_programs',
  get_student_details: 'get_student_details',
  list_my_applications: 'list_my_applications',
  list_my_offers: 'list_my_offers',
  get_recommendations: 'get_recommendations',
  compare_universities: 'compare_universities',
  get_scholarships: 'get_scholarships',
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/** Parameters for each tool (from LLM or internal call). */
export interface ToolParams {
  search_universities: { query?: string; country?: string; limit?: number };
  get_university_details: { universityId: string };
  search_students: { query?: string; country?: string; limit?: number };
  search_programs: { field?: string; degreeLevel?: string; language?: string; country?: string; limit?: number };
  get_student_details: { studentId: string };
  list_my_applications: Record<string, never>;
  list_my_offers: Record<string, never>;
  get_recommendations: { country?: string; minScore?: number; limit?: number };
  compare_universities: { universityIds: string[] };
  get_scholarships: { universityId?: string; country?: string; limit?: number };
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Sanitize string param: trim and cap length to prevent abuse. */
function sanitizeStr(value: unknown, maxLen = MAX_QUERY_LENGTH): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s.slice(0, maxLen) : undefined;
}

/** Clamp limit param to [1, MAX_TOOL_LIMIT]. */
function clampLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 10;
  return Math.min(MAX_TOOL_LIMIT, Math.max(1, Math.floor(n)));
}

/** Result is a string to inject into the conversation. Privacy: students do not see other students; universities see only name, country, city, GPA, id (no email/phone). */
export async function runTool(
  name: ToolName,
  params: Record<string, unknown>,
  userId: string,
  role: Role
): Promise<string> {
  const start = Date.now();
  const limit = clampLimit(params?.limit ?? 10);

  let result: Promise<string>;
  switch (name) {
    case TOOL_NAMES.search_universities:
      result = runSearchUniversities(sanitizeStr(params.query), sanitizeStr(params.country), limit, role);
      break;
    case TOOL_NAMES.get_university_details:
      result = runGetUniversityDetails(sanitizeStr(params.universityId, 50) ?? '', userId, role);
      break;
    case TOOL_NAMES.search_students:
      result = runSearchStudents(sanitizeStr(params.query), sanitizeStr(params.country), limit, userId, role);
      break;
    case TOOL_NAMES.search_programs:
      result = runSearchPrograms(
        sanitizeStr(params.field),
        sanitizeStr(params.degreeLevel),
        sanitizeStr(params.language),
        sanitizeStr(params.country),
        limit,
        role
      );
      break;
    case TOOL_NAMES.get_student_details:
      result = runGetStudentDetails(sanitizeStr(params.studentId, 50) ?? '', role);
      break;
    case TOOL_NAMES.list_my_applications:
      result = runListMyApplications(userId, role);
      break;
    case TOOL_NAMES.list_my_offers:
      result = runListMyOffers(userId, role);
      break;
    case TOOL_NAMES.get_recommendations:
      result = runGetRecommendations(
        userId,
        role,
        sanitizeStr(params.country),
        typeof params.minScore === 'number' ? Math.max(0, Math.min(1, params.minScore)) : undefined,
        limit
      );
      break;
    case TOOL_NAMES.compare_universities:
      result = runCompareUniversities(
        userId,
        role,
        Array.isArray(params.universityIds) ? (params.universityIds as unknown[]).slice(0, 4).map((id) => String(id).trim()).filter(Boolean) : []
      );
      break;
    case TOOL_NAMES.get_scholarships:
      result = runGetScholarships(
        userId,
        role,
        sanitizeStr(params.universityId, 50),
        sanitizeStr(params.country),
        limit
      );
      break;
    default:
      logger.warn({ tool: name, userId, role }, 'AI tool unknown');
      return `Unknown tool: ${name}`;
  }

  try {
    const out = await withTimeout(
      result,
      TOOL_TIMEOUT_MS,
      'Search took too long. Please try a more specific query or open the universities/students page.'
    );
    logger.info({ tool: name, userId, role, durationMs: Date.now() - start }, 'AI tool ok');
    return out;
  } catch (err) {
    logger.warn({ tool: name, userId, role, err: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }, 'AI tool error');
    throw err;
  }
}

async function runSearchUniversities(
  query: string | undefined,
  country: string | undefined,
  limit: number,
  role: Role
): Promise<string> {
  if (role !== 'student' && role !== 'admin') {
    return 'This tool is only available for students.';
  }

  if (query?.trim()) {
    const items = await searchService.searchUniversities(query.trim());
    const limited = items.slice(0, limit);
    if (limited.length === 0) return 'No universities found for this search.';
    return limited
      .map((u) => `${u.name} (${u.country ?? '—'}${u.city ? `, ${u.city}` : ''}) [id: ${u.id}]`)
      .join('\n');
  }

  const filter: Record<string, unknown> = { verified: true };
  if (country?.trim()) filter.country = new RegExp(safeRegExp(country.trim()).source, 'i');

  const list = await UniversityProfile.find(filter)
    .select('universityName country city')
    .sort({ universityName: 1 })
    .limit(limit)
    .lean();

  if (list.length === 0) return 'No universities found for the given criteria.';
  return list
    .map((u) => {
      const id = String((u as { _id: unknown })._id);
      const name = (u as { universityName?: string }).universityName ?? '—';
      const c = (u as { country?: string }).country ?? '—';
      const city = (u as { city?: string }).city;
      return `${name} (${c}${city ? `, ${city}` : ''}) [id: ${id}]`;
    })
    .join('\n');
}

async function runGetUniversityDetails(universityId: string, userId: string, role: Role): Promise<string> {
  if (role !== 'student' && role !== 'admin') {
    return 'This tool is only available for students.';
  }
  if (!universityId) return 'universityId is required.';

  try {
    const data = await studentService.getUniversityById(userId, universityId);
    const raw = data as Record<string, unknown>;
    const lines: string[] = [];
    lines.push(`Name: ${raw.name ?? raw.universityName ?? '—'}`);
    lines.push(`Country: ${raw.country ?? '—'}`);
    if (raw.city) lines.push(`City: ${raw.city}`);
    if (raw.description) lines.push(`Description: ${String(raw.description).slice(0, 500)}`);
    const programs = Array.isArray(raw.programs) ? raw.programs : [];
    if (programs.length > 0) {
      lines.push('Programs:');
      programs.slice(0, 15).forEach((p: Record<string, unknown>) => {
        lines.push(`  - ${p.name ?? p.field ?? '—'} (${p.degreeLevel ?? '—'}, ${p.field ?? '—'}${p.language ? `, ${p.language}` : ''})`);
      });
    }
    const scholarships = Array.isArray(raw.scholarships) ? raw.scholarships : [];
    if (scholarships.length > 0) {
      lines.push('Scholarships:');
      scholarships.slice(0, 10).forEach((s: Record<string, unknown>) => {
        lines.push(`  - ${s.name ?? '—'} (${s.coveragePercent ?? '—'}% coverage)`);
      });
    }
    return lines.join('\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('not found') || msg.includes('404')) return 'University not found.';
    return `Error: ${msg}`;
  }
}

async function runSearchStudents(
  query: string | undefined,
  country: string | undefined,
  limit: number,
  userId: string,
  role: Role
): Promise<string> {
  if (role !== 'university' && role !== 'admin' && role !== 'school_counsellor') {
    return 'This tool is only available for universities.';
  }

  const filter: Record<string, unknown> = {};
  if (country?.trim()) filter.country = new RegExp(safeRegExp(country.trim()).source, 'i');
  if (query?.trim()) {
    const re = safeRegExp(query.trim());
    filter.$or = [{ firstName: re }, { lastName: re }];
  }

  const list = await StudentProfile.find(filter)
    .select('firstName lastName country city gpa')
    .sort({ lastName: 1, firstName: 1 })
    .limit(limit)
    .lean();

  if (list.length === 0) return 'No students found for the given criteria.';
  return list
    .map((s) => {
      const id = String((s as { _id: unknown })._id);
      const name = [(s as { firstName?: string }).firstName, (s as { lastName?: string }).lastName].filter(Boolean).join(' ') || '—';
      const c = (s as { country?: string }).country ?? '—';
      const gpa = (s as { gpa?: number }).gpa;
      return `${name} (${c}${gpa != null ? `, GPA: ${gpa}` : ''}) [id: ${id}]`;
    })
    .join('\n');
}

async function runSearchPrograms(
  field: string | undefined,
  degreeLevel: string | undefined,
  language: string | undefined,
  country: string | undefined,
  limit: number,
  role: Role
): Promise<string> {
  if (role !== 'student' && role !== 'admin') {
    return 'This tool is only available for students.';
  }

  const match: Record<string, unknown> = {};
  if (field?.trim()) match.field = new RegExp(safeRegExp(field.trim()).source, 'i');
  if (degreeLevel?.trim()) match.degreeLevel = new RegExp(safeRegExp(degreeLevel.trim()).source, 'i');
  if (language?.trim()) match.language = new RegExp(safeRegExp(language.trim()).source, 'i');

  const pipeline: unknown[] = [
    { $match: match },
    { $lookup: { from: 'universityprofiles', localField: 'universityId', foreignField: '_id', as: 'university' } },
    { $unwind: '$university' },
    { $match: { 'university.verified': true } },
  ];
  if (country?.trim()) {
    (pipeline as { $match?: Record<string, unknown> }[]).push({
      $match: { 'university.country': new RegExp(safeRegExp(country.trim()).source, 'i') },
    });
  }
  pipeline.push(
    { $project: { name: 1, degreeLevel: 1, field: 1, language: 1, universityId: 1, 'university.universityName': 1, 'university.country': 1 } },
    { $sort: { 'university.universityName': 1, name: 1 } },
    { $limit: limit }
  );

  const list = await Program.aggregate(pipeline as never[]).exec();
  if (list.length === 0) return 'No programs found for the given criteria.';
  return list
    .map((p: { name?: string; degreeLevel?: string; field?: string; language?: string; university?: { universityName?: string; country?: string } }) => {
      const uni = p.university;
      const uniName = uni?.universityName ?? '—';
      const c = uni?.country ?? '—';
      const prog = `${p.name ?? p.field ?? '—'} (${p.degreeLevel ?? '—'}, ${p.field ?? '—'}${p.language ? `, ${p.language}` : ''})`;
      return `${uniName} | ${prog} | ${c}`;
    })
    .join('\n');
}

async function runGetStudentDetails(studentId: string, role: Role): Promise<string> {
  if (role !== 'university' && role !== 'admin' && role !== 'school_counsellor') {
    return 'This tool is only available for universities.';
  }
  if (!studentId) return 'studentId is required.';
  if (!mongoose.Types.ObjectId.isValid(studentId)) return 'Invalid student id.';

  const student = await StudentProfile.findById(studentId).lean();
  if (!student) return 'Student not found.';

  const s = student as Record<string, unknown>;
  const lines: string[] = [];
  lines.push(`Name: ${[s.firstName, s.lastName].filter(Boolean).join(' ') || '—'}`);
  lines.push(`Country: ${s.country ?? '—'}`);
  if (s.city) lines.push(`City: ${s.city}`);
  if (s.gpa != null) lines.push(`GPA: ${s.gpa}`);
  if (s.languageLevel) lines.push(`Language level: ${s.languageLevel}`);
  if (s.gradeLevel) lines.push(`Grade level: ${s.gradeLevel}`);
  if (s.targetDegreeLevel) lines.push(`Target degree: ${s.targetDegreeLevel}`);
  const faculties = Array.isArray(s.interestedFaculties) ? (s.interestedFaculties as string[]).filter(Boolean) : [];
  if (faculties.length > 0) lines.push(`Interested fields: ${faculties.slice(0, 10).join(', ')}`);
  if (s.bio) lines.push(`Bio: ${String(s.bio).slice(0, 300)}`);
  return lines.join('\n');
}

async function runListMyApplications(userId: string, role: Role): Promise<string> {
  if (role !== 'student' && role !== 'admin') {
    return 'This tool is only available for students.';
  }
  const profile = await StudentProfile.findOne({ userId }).select('_id').lean();
  if (!profile) return 'Student profile not found.';

  const list = await Interest.find({ studentId: (profile as { _id: unknown })._id })
    .populate('universityId', 'universityName country')
    .sort({ updatedAt: -1 })
    .lean();

  if (list.length === 0) return 'You have no applications (interests) yet. You can apply from /student/universities.';
  return (list as { universityId?: { universityName?: string; country?: string }; status?: string }[])
    .map((i) => {
      const uni = i.universityId;
      const name = uni?.universityName ?? '—';
      const country = uni?.country ?? '';
      const status = i.status ?? '—';
      return `- ${name} (${country}): ${status}`;
    })
    .join('\n');
}

async function runListMyOffers(userId: string, role: Role): Promise<string> {
  if (role !== 'student' && role !== 'admin') {
    return 'This tool is only available for students.';
  }
  const profile = await StudentProfile.findOne({ userId }).select('_id').lean();
  if (!profile) return 'Student profile not found.';

  const list = await Offer.find({ studentId: (profile as { _id: unknown })._id })
    .populate('universityId', 'universityName')
    .populate('scholarshipId', 'name coveragePercent')
    .sort({ createdAt: -1 })
    .lean();

  if (list.length === 0) return 'You have no offers yet.';
  return (list as { universityId?: { universityName?: string }; scholarshipId?: { name?: string; coveragePercent?: number }; status?: string }[])
    .map((o) => {
      const uni = o.universityId;
      const sch = o.scholarshipId;
      const name = uni?.universityName ?? '—';
      const schStr = sch ? ` — ${sch.name ?? '—'} (${sch.coveragePercent ?? 0}%)` : '';
      const status = o.status ?? '—';
      return `- ${name}${schStr}: ${status}`;
    })
    .join('\n');
}

async function runGetRecommendations(
  userId: string,
  role: Role,
  country: string | undefined,
  minScore: number | undefined,
  limit: number
): Promise<string> {
  if (role === 'student' || role === 'admin') {
    const profile = await StudentProfile.findOne({ userId }).select('_id').lean();
    if (!profile) return 'Student profile not found.';
    const filter: Record<string, unknown> = { studentId: (profile as { _id: unknown })._id };
    if (minScore != null && Number.isFinite(minScore)) filter.matchScore = { $gte: minScore };
    const rawList = await Recommendation.find(filter)
      .sort({ matchScore: -1 })
      .limit(limit * 2)
      .populate('universityId', 'universityName country')
      .lean();
    type RecUni = { universityId?: { universityName?: string; country?: string }; matchScore?: number };
    let list: RecUni[] = rawList as RecUni[];
    if (country?.trim()) {
      const re = new RegExp(safeRegExp(country.trim()).source, 'i');
      list = list.filter((r) => re.test(r.universityId?.country ?? ''));
    }
    list = list.slice(0, limit);
    if (list.length === 0) return 'No recommendations match the criteria. Try adjusting filters or complete your profile.';
    return list
      .map((r) => {
        const uni = r.universityId;
        const name = uni?.universityName ?? '—';
        const c = uni?.country ?? '—';
        const pct = r.matchScore != null ? Math.round(r.matchScore * 100) : '—';
        return `- ${name} (${c}): match ${pct}%`;
      })
      .join('\n');
  }

  if (role === 'university' || role === 'school_counsellor') {
    const profile = await UniversityProfile.findOne({ userId }).select('_id').lean();
    if (!profile) return 'University profile not found.';
    const filter: Record<string, unknown> = { universityId: (profile as { _id: unknown })._id };
    if (minScore != null && Number.isFinite(minScore)) filter.matchScore = { $gte: minScore };
    const rawList = await Recommendation.find(filter)
      .sort({ matchScore: -1 })
      .limit(limit * 2)
      .populate('studentId', 'firstName lastName country gpa')
      .lean();
    type RecStu = { studentId?: { firstName?: string; lastName?: string; country?: string; gpa?: number }; matchScore?: number };
    let list: RecStu[] = rawList as RecStu[];
    if (country?.trim()) {
      const re = new RegExp(safeRegExp(country.trim()).source, 'i');
      list = list.filter((r) => re.test(r.studentId?.country ?? ''));
    }
    list = list.slice(0, limit);
    if (list.length === 0) return 'No recommended students match the criteria.';
    return list
      .map((r) => {
        const s = r.studentId;
        const name = s ? [s.firstName, s.lastName].filter(Boolean).join(' ') || '—' : '—';
        const c = s?.country ?? '—';
        const gpa = s?.gpa != null ? s.gpa : '—';
        const pct = r.matchScore != null ? Math.round(r.matchScore * 100) : '—';
        return `- ${name} (${c}, GPA: ${gpa}): match ${pct}%`;
      })
      .join('\n');
  }

  return 'This tool is available for students and universities only.';
}

async function runCompareUniversities(userId: string, role: Role, universityIds: string[]): Promise<string> {
  if (role !== 'student' && role !== 'admin') {
    return 'This tool is only available for students.';
  }
  if (universityIds.length < 2 || universityIds.length > 4) {
    return 'Provide 2 to 4 university ids (e.g. from search_universities or recommendations).';
  }

  const blocks: string[] = [];
  for (const id of universityIds) {
    try {
      const data = await studentService.getUniversityById(userId, id);
      const raw = data as Record<string, unknown>;
      const name = raw.name ?? raw.universityName ?? '—';
      blocks.push(`--- ${name} ---`);
      blocks.push(`Country: ${raw.country ?? '—'}, City: ${raw.city ?? '—'}`);
      if (raw.description) blocks.push(`Description: ${String(raw.description).slice(0, 200)}...`);
      const programs = Array.isArray(raw.programs) ? raw.programs : [];
      if (programs.length > 0) {
        blocks.push('Programs: ' + (programs as Record<string, unknown>[]).slice(0, 5).map((p: Record<string, unknown>) => `${p.name ?? p.field} (${p.degreeLevel}, ${p.language ?? '—'})`).join('; '));
      }
      const scholarships = Array.isArray(raw.scholarships) ? raw.scholarships : [];
      if (scholarships.length > 0) {
        blocks.push('Scholarships: ' + (scholarships as Record<string, unknown>[]).slice(0, 5).map((s: Record<string, unknown>) => `${s.name} (${s.coveragePercent}%)`).join('; '));
      }
      if (raw.tuitionFee != null || (raw as { programs?: { tuitionFee?: unknown }[] }).programs?.some((p: { tuitionFee?: unknown }) => p.tuitionFee != null)) {
        const firstProg = (programs as { tuitionFee?: number }[])[0];
        if (firstProg?.tuitionFee != null) blocks.push(`Tuition (sample): ${firstProg.tuitionFee}`);
      }
      blocks.push('');
    } catch {
      blocks.push(`--- id ${id} ---\nNot found or not accessible.\n`);
    }
  }
  return blocks.join('\n');
}

async function runGetScholarships(
  userId: string,
  role: Role,
  universityId: string | undefined,
  country: string | undefined,
  limit: number
): Promise<string> {
  if (role !== 'student' && role !== 'admin') {
    return 'This tool is only available for students.';
  }

  const filter: Record<string, unknown> = {};
  if (universityId) {
    if (!mongoose.Types.ObjectId.isValid(universityId)) return 'Invalid university id.';
    filter.universityId = new mongoose.Types.ObjectId(universityId);
  } else if (country?.trim()) {
    const verifiedIds = await UniversityProfile.find({ verified: true, country: new RegExp(safeRegExp(country.trim()).source, 'i') }).select('_id').lean();
    const ids = (verifiedIds as { _id: unknown }[]).map((u) => u._id);
    if (ids.length === 0) return 'No verified universities in that country.';
    filter.universityId = { $in: ids };
  } else {
    const verifiedIds = await UniversityProfile.find({ verified: true }).select('_id').lean();
    filter.universityId = { $in: (verifiedIds as { _id: unknown }[]).map((u) => u._id) };
  }

  const list = await Scholarship.find(filter)
    .populate('universityId', 'universityName country')
    .sort({ deadline: 1 })
    .limit(limit)
    .lean();

  if (list.length === 0) return 'No scholarships found for the given criteria.';
  return (list as { name?: string; coveragePercent?: number; remainingSlots?: number; deadline?: Date; universityId?: { universityName?: string; country?: string } }[])
    .map((s) => {
      const uni = s.universityId;
      const uniName = uni?.universityName ?? '—';
      const c = uni?.country ?? '—';
      const deadline = s.deadline ? new Date(s.deadline).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
      return `- ${uniName} (${c}): ${s.name ?? '—'} — ${s.coveragePercent ?? 0}% coverage, ${s.remainingSlots ?? 0} slots left, deadline ${deadline}`;
    })
    .join('\n');
}

/** Parse a single [TOOL:name]{...json...} from the start of the reply. Returns toolName, params, and the rest of the reply without this line. */
export function parseToolCall(reply: string): { toolName: string; params: Record<string, unknown>; rest: string } | null {
  const match = /^\s*\[TOOL:(\w+)\]\s*/.exec(reply);
  if (!match) return null;
  const toolName = match[1];
  const after = reply.slice(match[0].length).trim();
  if (after[0] !== '{') return null;
  let depth = 0;
  let end = -1;
  for (let i = 0; i < after.length; i++) {
    if (after[i] === '{') depth++;
    else if (after[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return null;
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(after.slice(0, end)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rest = after.slice(end).trim();
  return { toolName, params, rest };
}

/** One-line description of tools for the fallback (non-OpenAI) system prompt appendix. */
export function getToolFallbackPromptAppendix(role: Role): string {
  const tools = getOpenAIToolsDefinitions(role);
  if (tools.length === 0) return '';
  const names = tools.map((t) => t.function.name).join(', ');
  return `When you need to query the database, output exactly one line: [TOOL:toolName]{"param":"value"} with valid JSON (e.g. [TOOL:search_universities]{"country":"Germany"}), then your answer. Available tools: ${names}. Use only these names and only when the user asks for data you don't have in the context.`;
}

/** OpenAI-style tool definitions for the API. */
export function getOpenAIToolsDefinitions(role: Role): Array<{ type: 'function'; function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] } } }> {
  const tools: Array<{ type: 'function'; function: { name: string; description: string; parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] } } }> = [];

  if (role === 'student' || role === 'admin') {
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.search_universities,
        description: 'Search platform universities by text query or filter by country. Returns list of university names with country, city and id.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search text (university name, city or country)' },
            country: { type: 'string', description: 'Filter by country name' },
            limit: { type: 'number', description: 'Max results (default 10, max 20)' },
          },
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.get_university_details,
        description: 'Get full details of one university (programs, scholarships, description) by its id. Use after search_universities to get the id.',
        parameters: {
          type: 'object',
          properties: {
            universityId: { type: 'string', description: 'University id (from search_universities or context)' },
          },
          required: ['universityId'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.search_programs,
        description: 'Search study programs by field (e.g. Computer Science), degree level (bachelor, master, phd), language (e.g. English), or country. Returns list: university name, program name, degree, field, language, country.',
        parameters: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'Program field or subject (e.g. Computer Science, Economics)' },
            degreeLevel: { type: 'string', description: 'Degree level: bachelor, master, phd' },
            language: { type: 'string', description: 'Language of instruction (e.g. English, Russian)' },
            country: { type: 'string', description: 'Filter by country of the university' },
            limit: { type: 'number', description: 'Max results (default 10, max 20)' },
          },
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.list_my_applications,
        description: 'List the student\'s applications (interests) with university name and status. Use when the student asks "what are my applications", "where did I apply", "my applications list".',
        parameters: { type: 'object', properties: {} },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.list_my_offers,
        description: 'List the student\'s offers from universities with scholarship info and status. Use when the student asks "what offers do I have", "my offers".',
        parameters: { type: 'object', properties: {} },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.get_recommendations,
        description: 'Get extended list of recommendations (universities for student, or students for university) with optional filters. Use when user wants "more recommendations" or "recommendations from country X" or "with minimum match score".',
        parameters: {
          type: 'object',
          properties: {
            country: { type: 'string', description: 'Filter by country (university country for student, student country for university)' },
            minScore: { type: 'number', description: 'Minimum match score 0-1 (e.g. 0.7 for 70%)' },
            limit: { type: 'number', description: 'Max results (default 10, max 20)' },
          },
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.compare_universities,
        description: 'Compare 2 to 4 universities by their ids. Returns programs, scholarships, country, city, tuition (if available) for each. Use when student asks "compare X and Y" or "difference between these universities".',
        parameters: {
          type: 'object',
          properties: {
            universityIds: { type: 'array', items: { type: 'string' }, description: 'Array of 2-4 university ids (from search or recommendations)' },
          },
          required: ['universityIds'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.get_scholarships,
        description: 'List scholarships from verified universities. Filter by university id or country. Returns university name, scholarship name, coverage %, slots left, deadline.',
        parameters: {
          type: 'object',
          properties: {
            universityId: { type: 'string', description: 'Filter by one university id' },
            country: { type: 'string', description: 'Filter by country of the university' },
            limit: { type: 'number', description: 'Max results (default 10, max 20)' },
          },
        },
      },
    });
  }

  if (role === 'university' || role === 'admin' || role === 'school_counsellor') {
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.search_students,
        description: 'Search students on the platform by name or filter by country. Returns list of student names with country and id.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search by first or last name' },
            country: { type: 'string', description: 'Filter by country' },
            limit: { type: 'number', description: 'Max results (default 10, max 20)' },
          },
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.get_student_details,
        description: 'Get short profile of a student by id (name, country, GPA, language level, target degree, interests). Use after search_students to get the id. No contact data.',
        parameters: {
          type: 'object',
          properties: {
            studentId: { type: 'string', description: 'Student id (from search_students or context)' },
          },
          required: ['studentId'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: TOOL_NAMES.get_recommendations,
        description: 'Get extended list of recommended students with optional filters (country, minScore). Use when university asks "more recommended students" or "from country X".',
        parameters: {
          type: 'object',
          properties: {
            country: { type: 'string', description: 'Filter by student country' },
            minScore: { type: 'number', description: 'Minimum match score 0-1 (e.g. 0.7 for 70%)' },
            limit: { type: 'number', description: 'Max results (default 10, max 20)' },
          },
        },
      },
    });
  }

  return tools;
}
