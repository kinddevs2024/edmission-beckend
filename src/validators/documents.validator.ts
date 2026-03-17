import { z } from 'zod';
import { objectIdZod } from '../utils/validators';

const documentTypeZod = z.enum(['offer', 'scholarship']);
const templateStatusZod = z.enum(['draft', 'active', 'archived']);
const pageFormatZod = z.enum(['A4_PORTRAIT', 'A4_LANDSCAPE', 'LETTER', 'CUSTOM']);
const assetTypeZod = z.enum(['image', 'logo', 'signature', 'background', 'pdf_background']);

const templateAssetSchema = z.object({
  id: objectIdZod.optional(),
  type: assetTypeZod,
  fileUrl: z.string().min(1).max(1000),
  fileName: z.string().min(1).max(260),
  mimeType: z.string().min(1).max(120),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

export const createTemplateSchema = z.object({
  body: z.object({
    type: documentTypeZod,
    name: z.string().min(1).max(200),
    status: templateStatusZod.optional(),
    pageFormat: pageFormatZod.optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    editorVersion: z.string().max(20).optional(),
    canvasJson: z.string().optional(),
    previewImageUrl: z.string().max(1000).optional(),
    isDefault: z.boolean().optional(),
    assets: z.array(templateAssetSchema).max(50).optional(),
  }),
});

export const updateTemplateSchema = z.object({
  body: z.object({
    type: documentTypeZod.optional(),
    name: z.string().min(1).max(200).optional(),
    status: templateStatusZod.optional(),
    pageFormat: pageFormatZod.optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    editorVersion: z.string().max(20).optional(),
    canvasJson: z.string().optional(),
    previewImageUrl: z.string().max(1000).optional(),
    isDefault: z.boolean().optional(),
    assets: z.array(templateAssetSchema).max(50).optional(),
  }).strict(),
});

export const listTemplatesQuerySchema = z.object({
  query: z.object({
    type: documentTypeZod.optional(),
    status: templateStatusZod.optional(),
  }),
});

export const renderTemplatePreviewSchema = z.object({
  body: z.object({
    studentId: objectIdZod.optional(),
    acceptDeadline: z.string().optional(),
    universityMessage: z.string().max(2000).optional(),
    documentData: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const sendStudentDocumentSchema = z.object({
  body: z.object({
    studentId: objectIdZod,
    chatId: objectIdZod.optional(),
    templateId: objectIdZod,
    type: documentTypeZod,
    acceptDeadline: z.string().optional(),
    universityMessage: z.string().max(2000).optional(),
    title: z.string().max(300).optional(),
    documentData: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const listStudentDocumentsQuerySchema = z.object({
  query: z.object({
    type: documentTypeZod.optional(),
    status: z.enum(['sent', 'viewed', 'accepted', 'declined', 'postponed', 'expired', 'revoked']).optional(),
  }),
});

export const postponeStudentDocumentSchema = z.object({
  body: z.object({
    days: z.union([z.literal(3), z.literal(7), z.literal(14)]),
  }),
});
