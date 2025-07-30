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
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
export default User;
