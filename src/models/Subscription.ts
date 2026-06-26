import mongoose from 'mongoose';

/** Student plans */
export const STUDENT_PLANS = ['student_free_trial', 'student_standard', 'student_max_premium'] as const;
/** University plans */
export const UNIVERSITY_PLANS = ['university_free', 'university_premium'] as const;
/** School counsellor plans */
export const SCHOOL_COUNSELLOR_PLANS = ['school_counsellor_free', 'school_counsellor_premium'] as const;
/** Internal staff plan */
export const STAFF_PLANS = ['staff_internal'] as const;

export const SUBSCRIPTION_STATUS = ['active', 'expired', 'cancelled'] as const;

const subscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    role: {
      type: String,
      required: true,
      enum: [
        'student',
        'university',
        'university_multi_manager',
        'multi_university_admin',
        'admin',
        'student_admin',
        'school_counsellor',
        'counsellor_coordinator',
        'manager',
      ],
    },
    plan: { type: String, required: true },
    status: { type: String, enum: SUBSCRIPTION_STATUS, default: 'active' },
    trialEndsAt: { type: Date },
    currentPeriodEnd: { type: Date },
    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },
    cybersourceReferenceNumber: { type: String },
    cybersourceTransactionId: { type: String },
    cybersourceSubscriptionId: { type: String },
    cybersourcePaymentToken: { type: String },
    trialReminderSentAt: { type: Date },
  },
  { timestamps: true }
);

subscriptionSchema.index({ role: 1, plan: 1 });
subscriptionSchema.index({ status: 1 });

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
