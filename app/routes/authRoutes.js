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
  signupStep2Json,
  kycStatus,
} from '../controllers/authController.js';
import multer from 'multer';
import { authenticateToken } from '../middlewares/authMiddleware.js';
import { webhookHandler } from '../controllers/sumsubController.js';
// import { uploadFields } from '../middlewares/uploadMiddleware.js';

const router = express.Router();

// Accept fields-only or optional files (memory) for multipart/form-data on JSON route
const memoryUpload = multer({ storage: multer.memoryStorage() });

// Signup steps
router.post('/signup/step1', signupStep1); // Only create user
router.post('/send-otp', sendOtp); // Send OTP via SMS or email
router.post('/resend-otp', resendOtp); // Resend OTP
router.post('/signup/verify-otp', verifyOtp); // OTP verification
router.post('/signup/step2', authenticateToken, localIdUpload, signupStep2); // Upload ID with files
router.post('/signup/step2-json', authenticateToken, memoryUpload.any(), signupStep2Json); // Upload ID via JSON (base64) or form-data with optional files
router.post('/signup/step3', authenticateToken, signupStep3); // Card choice & address
router.get('/kyc-status', authenticateToken, kycStatus);
router.post('/webhooks', webhookHandler);

// Auth
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
