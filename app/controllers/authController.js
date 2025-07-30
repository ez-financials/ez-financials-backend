import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateOTP } from '../utils/otp.js';
import { sendEmail } from '../utils/email.js';
import { sendSMS } from '../utils/sms.js';
import uploadToCloudinary from '../utils/uploadToCloudinary.js';
import upload from '../middlewares/localUpload.js';
import {
  signupStep1Schema,
  otpSchema,
  signupStep2Schema,
  signupStep3Schema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from '../schemas/authSchema.js';

export async function signupStep1(req, res, next) {
  try {
    const { error } = signupStep1Schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { email, phone, password } = req.body;
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ success: false, message: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    user = new User({ email, phone, password: hashedPassword });
    await user.save();

    res.json({ success: true, message: 'User registered. Please choose OTP method.' });
  } catch (err) {
    next(err);
  }
}

async function handleOtpSend({ email, method }, res, next) {
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    user.otp = otp;
    user.otpExpires = otpExpires;
    await user.save();
    if (method === 'sms') {
      await sendSMS({
        to: user.phone,
        body: `Your OTP is ${otp}`,
      });
    } else {
      await sendEmail({
        to: user.email,
        subject: 'Your OTP Code',
        text: `Your OTP is ${otp}`,
      });
    }
    res.json({ success: true, message: `OTP sent via ${method === 'sms' ? 'SMS' : 'email'}` });
  } catch (err) {
    next(err);
  }
}

export async function sendOtp(req, res, next) {
  const { email, method } = req.body;
  await handleOtpSend({ email, method }, res, next);
}

export async function resendOtp(req, res, next) {
  const { email, method } = req.body;
  await handleOtpSend({ email, method }, res, next);
}

export async function verifyOtp(req, res, next) {
  try {
    const { error } = otpSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { email, otp } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.otp !== otp || user.otpExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();
    res.json({ success: true, message: 'OTP verified' });
  } catch (err) {
    next(err);
  }
}

export const localIdUpload = upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
]);

export async function signupStep2(req, res, next) {
  try {
    console.log(req.files)
    const { email, idType } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!req.files || !req.files.idFront) {
      return res.status(400).json({ success: false, message: 'Front image of ID is required' });
    }
    user.idType = idType;
    // Upload front image to Cloudinary
    const frontResult = await uploadToCloudinary(req.files.idFront[0].path, 'user_ids');
    user.idFrontUrl = frontResult.secure_url;
    // Upload back image if provided
    if (req.files.idBack) {
      const backResult = await uploadToCloudinary(req.files.idBack[0].path, 'user_ids');
      user.idBackUrl = backResult.secure_url;
    }
    user.idStatus = 'under_review';
    await user.save();
    res.json({ success: true, message: "Your ID is under review. We'll notify you." });
  } catch (err) {
    next(err);
  }
}

export async function signupStep3(req, res, next) {
  try {
    const { error } = signupStep3Schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const { email, cardType, address } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.cardType = cardType;
    if (cardType === 'physical') {
      user.address = address;
    } else if (cardType === 'virtual') {
      // Generate dummy card details
      user.cardNumber = '4111 1111 1111 ' + Math.floor(1000 + Math.random() * 9000);
      user.cardExpiry = '12/28';
      user.cardCVV = Math.floor(100 + Math.random() * 900).toString();
    }
    await user.save();
    res.json({ success: true, message: 'Signup complete' });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { error } = loginSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.isVerified) return res.status(403).json({ success: false, message: 'Email not verified' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { error } = forgotPasswordSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const token = generateOTP();
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    await sendEmail({
      to: email,
      subject: 'Password Reset Code',
      text: `Your password reset code is ${token}`,
    });
    res.json({ success: true, message: 'Password reset code sent to email' });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { error } = resetPasswordSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });
    const { email, password, token } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.resetPasswordToken !== token || user.resetPasswordExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired token' });
    }
    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    next(err);
  }
}
