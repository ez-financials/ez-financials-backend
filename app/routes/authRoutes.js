import express from 'express';
import {
  signupStep1,
  signupStep2,
  signupStep3,
  verifyOtp,
  login,
  forgotPassword,
  resetPassword,
  sendOtp,
  resendOtp,
  localIdUpload,
} from '../controllers/authController.js';
// import { uploadFields } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

// Signup steps
router.post('/signup/step1', signupStep1); // Only create user
router.post('/send-otp', sendOtp); // Send OTP via SMS or email
router.post('/resend-otp', resendOtp); // Resend OTP
router.post('/signup/verify-otp', verifyOtp); // OTP verification
router.post('/signup/step2', localIdUpload, signupStep2); // Upload ID with files
router.post('/signup/step3', signupStep3); // Card choice & address

// Auth
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
