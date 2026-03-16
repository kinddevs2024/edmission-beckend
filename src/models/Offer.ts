import mongoose from 'mongoose';

// pending  – только что отправлен, ждёт решения
// waiting  – студент нажал «подождать», у оффера есть expiresAt
// accepted – студент принял оффер
// declined – студент отказался
// expired  – оффер истёк автоматически после expiresAt
const OFFER_STATUSES = ['pending', 'waiting', 'accepted', 'declined', 'expired'] as const;

const offerSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    scholarshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Scholarship', default: null },
    coveragePercent: { type: Number, required: true },
    status: { type: String, default: 'pending', enum: OFFER_STATUSES },
    /** Дедлайн, который задаёт университет (например, крайний срок для ответа или оформления). */
    deadline: Date,
    /** Время, до которого студент может ответить на оффер (для режима «подождать»). После expiresAt оффер авто‑закрывается. */
    expiresAt: Date,
    /** Шаблон сертификата, с которым был создан оффер (опционально). */
    certificateTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'OfferCertificateTemplate', default: null },
    /** Заголовок сертификата (сгенерированный с учётом шаблона и данных). */
    certificateTitle: { type: String },
    /** Основной текст сертификата / поздравления. */
    certificateBody: { type: String },
    /** Дополнительные метаданные для сертификата (например, программа, стипендия и т.д.). */
    certificateMeta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

offerSchema.index({ studentId: 1 });
offerSchema.index({ universityId: 1 });
offerSchema.index({ status: 1 });
offerSchema.index({ expiresAt: 1, status: 1 });

export const Offer = mongoose.model('Offer', offerSchema);
