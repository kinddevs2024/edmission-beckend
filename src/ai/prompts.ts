import type { Role } from '../types/role';

export function getSystemPrompt(role: 'student' | 'university', context: string): string {
  const base = `You are Edmission assistant for university admissions. You help users with application process, recommendations, and decisions. Answer in the same language the user writes. Do not invent facts; use only the context provided. Do not give medical or legal advice. Keep answers concise and helpful.`;

  if (role === 'student') {
    return `${base}

Context about this student and their application status:
---
${context}
---
Use this context to give personalized advice about their chances, next steps, and recommendations.`;
  }

  if (role === 'university') {
    return `${base}

Context about this university's pipeline and candidates:
---
${context}
---
Use this context to help with candidate evaluation and pipeline questions.`;
  }

  return `${base}\n\nContext:\n${context}`;
}
