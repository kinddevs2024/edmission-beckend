/**
 * Derive { language, level } rows from approved language certificates so university
 * profile views show e.g. "English — IELTS · score 7" alongside profile.languages.
 */

export type CertificateDocLike = {
  type: string;
  certificateType?: string;
  name?: string;
  score?: string;
};

export type LanguageLevelRow = { language: string; level: string };

function norm(s: string): string {
  return s.replace(/\bils\b/gi, 'IELTS').replace(/\s+/g, ' ').trim();
}

/** Guess target language from certificate / exam names. */
export function inferLanguageFromCertificateText(haystack: string): string {
  const t = haystack.toLowerCase();
  if (/\b(ielts|toefl|pte\s*academic|pearson|oet|duolingo|cambridge\s*(cae|cpe|fce|pet|ket)|\bcae\b|\bcpe\b|\bfce\b)\b/.test(t)) return 'English';
  if (/\b(delf|dalf|tcf|tef)\b/.test(t)) return 'French';
  if (/\b(dele|siele)\b/.test(t)) return 'Spanish';
  if (/\b(testdaf|dsh|goethe|ösd|telc\s*deutsch)\b/.test(t)) return 'German';
  if (/\bhsk\b|汉语/.test(t)) return 'Chinese';
  if (/\bjlpt\b|日本語/.test(t)) return 'Japanese';
  if (/\b(torfl|trki)\b/.test(t)) return 'Russian';
  if (/\b(cils|celi|plida)\b/.test(t)) return 'Italian';
  if (/\btopik\b/.test(t)) return 'Korean';
  if (/\b(english|английск)\b/.test(t)) return 'English';
  if (/\b(french|français|француз)\b/.test(t)) return 'French';
  if (/\b(spanish|español|испанск)\b/.test(t)) return 'Spanish';
  if (/\b(german|deutsch|немец)\b/.test(t)) return 'German';
  if (/\b(italian|italiano|итальян)\b/.test(t)) return 'Italian';
  if (/\b(portuguese|português|португал)\b/.test(t)) return 'Portuguese';
  if (/\b(turkish|türkçe|турецк)\b/.test(t)) return 'Turkish';
  if (/\b(arabic|العربية)\b/.test(t)) return 'Arabic';
  if (/\b(uzbek|o'zbek|узбек)\b/.test(t)) return 'Uzbek';
  return '';
}

function pickExamLabel(certType: string, docName: string): string {
  const a = norm(certType);
  const b = norm(docName);
  if (a && b && a.toLowerCase() === b.toLowerCase()) return a;
  if (a && b && b.toLowerCase().includes(a.toLowerCase())) return b;
  if (a && b && a.toLowerCase().includes(b.toLowerCase())) return a;
  const merged = [a, b].filter(Boolean).join(' ').trim();
  return merged || a || b;
}

function isLanguageCertificateDoc(doc: CertificateDocLike): boolean {
  if (doc.type === 'language_certificate') return true;
  if (doc.type === 'other' && doc.name && /ielts|toefl|pte|delf|dalf|hsk|jlpt|dele|testdaf|goethe|oet|duolingo|cae|cpe|fce/i.test(doc.name)) {
    return true;
  }
  return false;
}

function rowFromDoc(doc: CertificateDocLike): LanguageLevelRow | null {
  if (!isLanguageCertificateDoc(doc)) return null;
  const certType = String(doc.certificateType ?? '').trim();
  const name = String(doc.name ?? '').trim();
  const score = String(doc.score ?? '').trim();
  const haystack = `${certType} ${name}`;
  const language = inferLanguageFromCertificateText(haystack) || 'Other';
  const exam = pickExamLabel(certType, name);
  const levelParts: string[] = [];
  if (exam) levelParts.push(exam);
  if (score) levelParts.push(`score ${score}`);
  const level = levelParts.join(' · ') || (exam ? exam : 'Certificate');
  if (!level || level === 'Certificate' && language === 'Other' && !score && !exam) return null;
  return { language, level };
}

function rowKey(r: LanguageLevelRow): string {
  return `${r.language.toLowerCase()}|${r.level.toLowerCase()}`;
}

/** Rows inferred from approved student documents (language_certificate + relevant "other"). */
export function languageRowsFromApprovedCertificates(docs: CertificateDocLike[]): LanguageLevelRow[] {
  const out: LanguageLevelRow[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const row = rowFromDoc(doc);
    if (!row) continue;
    const k = rowKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

/** Profile languages first, then certificate rows not already duplicated. */
export function mergeProfileLanguagesWithCertificates(
  profileLangs: LanguageLevelRow[],
  fromCertificates: LanguageLevelRow[]
): LanguageLevelRow[] {
  const merged: LanguageLevelRow[] = [];
  const seen = new Set<string>();
  for (const r of profileLangs) {
    if (!r.language && !r.level) continue;
    const row = { language: r.language || '—', level: r.level || '—' };
    const k = rowKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(row);
  }
  for (const r of fromCertificates) {
    const k = rowKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(r);
  }
  return merged;
}
