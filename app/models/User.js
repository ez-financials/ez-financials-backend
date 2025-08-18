import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema({
  address: String,
  apartment: String,
  city: String,
  state: String,
  zip: String,
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  otp: { type: String },
  otpExpires: { type: Date },
  governmentIdUrl: { type: String },
  cardType: { type: String, enum: ['virtual', 'physical'] },
  cardNumber: { type: String },
  cardExpiry: { type: String },
  cardCVV: { type: String },
  address: addressSchema,
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  idType: { type: String, enum: ['passport', 'driver_license', 'national_id'] },
  idFrontUrl: { type: String },
  idBackUrl: { type: String },
  idStatus: { type: String, enum: ['under_review', 'approved', 'rejected'], default: 'under_review' },
  // Sumsub linkage
  sumsubApplicantId: { type: String, index: true },
  // New per-document KYC storage
  kyc: {
    passport: {
      frontUrl: { type: String },
      backUrl: { type: String },
      status: { type: String, enum: ['under_review', 'approved', 'rejected'], default: 'under_review' },
      reviewAnswer: { type: String }, // e.g., GREEN/RED
      reviewStatus: { type: String }, // e.g., completed/pending
      rejectReasons: [{ type: String }],
      moderationComment: { type: String },
      clientComment: { type: String },
      reviewedAt: { type: Date },
    },
    driverLicense: {
      frontUrl: { type: String },
      backUrl: { type: String },
      status: { type: String, enum: ['under_review', 'approved', 'rejected'], default: 'under_review' },
      reviewAnswer: { type: String },
      reviewStatus: { type: String },
      rejectReasons: [{ type: String }],
      moderationComment: { type: String },
      clientComment: { type: String },
      reviewedAt: { type: Date },
    },
    nationalId: {
      frontUrl: { type: String },
      backUrl: { type: String },
      status: { type: String, enum: ['under_review', 'approved', 'rejected'], default: 'under_review' },
      reviewAnswer: { type: String },
      reviewStatus: { type: String },
      rejectReasons: [{ type: String }],
      moderationComment: { type: String },
      clientComment: { type: String },
      reviewedAt: { type: Date },
    },
  },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Standardized aliases for clarity in API responses/requests
userSchema.virtual('frontIdUrl')
  .get(function() { return this.idFrontUrl; })
  .set(function(value) { this.idFrontUrl = value; });

userSchema.virtual('backIdUrl')
  .get(function() { return this.idBackUrl; })
  .set(function(value) { this.idBackUrl = value; });

const User = mongoose.model('User', userSchema);
export default User;
