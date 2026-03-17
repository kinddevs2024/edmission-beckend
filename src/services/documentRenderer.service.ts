type DocumentType = 'offer' | 'scholarship';
type PageFormat = 'A4_PORTRAIT' | 'A4_LANDSCAPE' | 'LETTER' | 'CUSTOM';

export type DocumentSceneElementType = 'text' | 'image' | 'logo' | 'signature' | 'shape' | 'line';

export type DocumentSceneElement = {
  id: string;
  type: DocumentSceneElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  locked?: boolean;
  layer?: number;
  opacity?: number;
  content?: string;
  src?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  points?: number[];
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
};

export type DocumentScene = {
  version: string;
  page: {
    format: PageFormat;
    width: number;
    height: number;
    backgroundColor?: string;
    safeMargin?: number;
  };
  elements: DocumentSceneElement[];
};

const PAGE_DIMENSIONS: Record<Exclude<PageFormat, 'CUSTOM'>, { width: number; height: number }> = {
  A4_PORTRAIT: { width: 794, height: 1123 },
  A4_LANDSCAPE: { width: 1123, height: 794 },
  LETTER: { width: 816, height: 1056 },
};

export const MERGE_TAGS = {
  Student: [
    '{{student.firstName}}',
    '{{student.lastName}}',
    '{{student.fullName}}',
    '{{student.email}}',
    '{{student.phone}}',
    '{{student.country}}',
  ],
  University: [
    '{{university.name}}',
    '{{university.address}}',
    '{{university.logo}}',
  ],
  Offer: [
    '{{offer.programName}}',
    '{{offer.degreeLevel}}',
    '{{offer.intake}}',
    '{{offer.startDate}}',
    '{{offer.tuitionFee}}',
    '{{offer.currency}}',
    '{{offer.conditions}}',
  ],
  Scholarship: [
    '{{scholarship.amount}}',
    '{{scholarship.percent}}',
    '{{scholarship.type}}',
  ],
  Dates: [
    '{{today}}',
    '{{deadline.acceptBy}}',
  ],
  System: [
    '{{document.id}}',
  ],
} as const;

export function getPageDimensions(format: PageFormat, width?: number, height?: number): { width: number; height: number } {
  if (format === 'CUSTOM') {
    return {
      width: Math.max(320, Math.round(width ?? 794)),
      height: Math.max(320, Math.round(height ?? 1123)),
    };
  }
  return PAGE_DIMENSIONS[format];
}

export function createBlankScene(format: PageFormat, width?: number, height?: number): DocumentScene {
  const size = getPageDimensions(format, width, height);
  return {
    version: '1.0.0',
    page: {
      format,
      width: size.width,
      height: size.height,
      backgroundColor: '#ffffff',
      safeMargin: 32,
    },
    elements: [],
  };
}

export function parseScene(canvasJson: string, fallbackFormat: PageFormat = 'A4_PORTRAIT', width?: number, height?: number): DocumentScene {
  try {
    const parsed = JSON.parse(canvasJson) as Partial<DocumentScene>;
    const format = parsed.page?.format ?? fallbackFormat;
    const size = getPageDimensions(format, parsed.page?.width ?? width, parsed.page?.height ?? height);
    const elements = Array.isArray(parsed.elements)
      ? parsed.elements
          .map((element, index) => normalizeElement(element, index))
          .filter((element): element is DocumentSceneElement => element != null)
      : [];

    return {
      version: typeof parsed.version === 'string' && parsed.version.trim() ? parsed.version : '1.0.0',
      page: {
        format,
        width: size.width,
        height: size.height,
        backgroundColor: typeof parsed.page?.backgroundColor === 'string' ? parsed.page.backgroundColor : '#ffffff',
        safeMargin: typeof parsed.page?.safeMargin === 'number' ? parsed.page.safeMargin : 32,
      },
      elements,
    };
  } catch {
    return createBlankScene(fallbackFormat, width, height);
  }
}

export function stringifyScene(scene: DocumentScene): string {
  return JSON.stringify(scene);
}

export function resolveSceneVariables(scene: DocumentScene, payload: Record<string, unknown>): DocumentScene {
  return {
    ...scene,
    elements: scene.elements.map((element) => resolveElementVariables(element, payload)),
  };
}

export function resolveTemplateText(value: string | undefined, payload: Record<string, unknown>): string | undefined {
  if (typeof value !== 'string') return value;
  return value.replace(/{{\s*([^}]+)\s*}}/g, (_match, rawPath: string) => {
    const found = getPathValue(payload, rawPath.trim());
    return found == null ? '' : String(found);
  });
}

export function createSamplePayload(type: DocumentType): Record<string, unknown> {
  return {
    today: new Date().toISOString().slice(0, 10),
    student: {
      firstName: 'Ali',
      lastName: 'Valiyev',
      fullName: 'Ali Valiyev',
      email: 'ali@example.com',
      phone: '+998 90 123 45 67',
      country: 'Uzbekistan',
    },
    university: {
      name: 'Edmission University',
      address: 'Tashkent, Uzbekistan',
      logo: '',
    },
    offer: {
      programName: 'Computer Science',
      degreeLevel: 'Bachelor',
      intake: 'Fall 2026',
      startDate: '2026-09-01',
      tuitionFee: '12000',
      currency: 'USD',
      conditions: 'Maintain GPA 3.0 and submit final transcript.',
    },
    scholarship: {
      amount: type === 'scholarship' ? '5000' : '0',
      percent: type === 'scholarship' ? '50' : '0',
      type: type === 'scholarship' ? 'Merit scholarship' : '',
    },
    deadline: {
      acceptBy: '2026-04-15',
    },
    document: {
      id: 'preview-document',
    },
  };
}

export function createTemplateSummary(scene: DocumentScene): string {
  const firstText = scene.elements.find((element) => element.type === 'text' && element.content?.trim());
  if (firstText?.content) {
    return firstText.content.slice(0, 160);
  }
  return `${scene.elements.length} element(s)`;
}

function normalizeElement(input: unknown, index: number): DocumentSceneElement | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<DocumentSceneElement>;
  if (typeof raw.type !== 'string') return null;
  const supported: DocumentSceneElementType[] = ['text', 'image', 'logo', 'signature', 'shape', 'line'];
  if (!supported.includes(raw.type as DocumentSceneElementType)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `element-${index + 1}`,
    type: raw.type as DocumentSceneElementType,
    x: normalizeNumber(raw.x, 0),
    y: normalizeNumber(raw.y, 0),
    width: normalizeNumber(raw.width, 100),
    height: normalizeNumber(raw.height, 40),
    rotation: normalizeNumber(raw.rotation, 0),
    locked: Boolean(raw.locked),
    layer: normalizeNumber(raw.layer, index),
    opacity: normalizeNumber(raw.opacity, 1),
    content: typeof raw.content === 'string' ? raw.content : undefined,
    src: typeof raw.src === 'string' ? raw.src : undefined,
    fill: typeof raw.fill === 'string' ? raw.fill : undefined,
    stroke: typeof raw.stroke === 'string' ? raw.stroke : undefined,
    strokeWidth: normalizeNumber(raw.strokeWidth, 1),
    radius: normalizeNumber(raw.radius, 0),
    points: Array.isArray(raw.points) ? raw.points.map((point) => normalizeNumber(point, 0)) : undefined,
    fontSize: normalizeNumber(raw.fontSize, 24),
    fontFamily: typeof raw.fontFamily === 'string' ? raw.fontFamily : undefined,
    fontWeight: raw.fontWeight === 'bold' ? 'bold' : 'normal',
    textAlign: raw.textAlign === 'center' || raw.textAlign === 'right' ? raw.textAlign : 'left',
    lineHeight: normalizeNumber(raw.lineHeight, 1.2),
  };
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function resolveElementVariables(element: DocumentSceneElement, payload: Record<string, unknown>): DocumentSceneElement {
  return {
    ...element,
    content: resolveTemplateText(element.content, payload),
    src: resolveTemplateText(element.src, payload),
  };
}

function getPathValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
