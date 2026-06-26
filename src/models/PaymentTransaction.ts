import mongoose from 'mongoose';

const PAYMENT_TRANSACTION_STATUS = ['pending', 'accepted', 'declined', 'cancelled', 'error'] as const;

const paymentTransactionSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, enum: ['cybersource', 'stripe'] },
    referenceNumber: { type: String, required: true, unique: true },
    transactionUuid: { type: String },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true },
    planId: { type: String, required: true },
    status: { type: String, enum: PAYMENT_TRANSACTION_STATUS, default: 'pending' },
    amount: { type: String, required: true },
    currency: { type: String, required: true },
    recurringFrequency: { type: String },
    requestPayload: { type: mongoose.Schema.Types.Mixed },
    responsePayload: { type: mongoose.Schema.Types.Mixed },
    decision: { type: String },
    reasonCode: { type: String },
    transactionId: { type: String },
    subscriptionId: { type: String },
    paymentToken: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

paymentTransactionSchema.index({ userId: 1, createdAt: -1 });
paymentTransactionSchema.index({ status: 1, createdAt: -1 });
paymentTransactionSchema.index({ transactionId: 1 }, { sparse: true });

export const PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema);
