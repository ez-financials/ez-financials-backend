import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateOTP } from '../utils/otp.js';
import { sendEmail } from '../utils/awsEmail.js';
import { sendSMS } from '../utils/awsSms.js';
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
import { createApplicant, uploadDocumentToSumsub } from '../sumsub/sumsubService.js';
import fs from 'fs';
import path from 'path';

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

    // Mark verified
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;

    // Create Sumsub applicant if not already linked
    if (!user.sumsubApplicantId) {
      try {
        const fixedInfo = {};
        const levelName = 'id-and-liveness';
        const sumsubResp = await createApplicant(String(user._id), levelName, fixedInfo);
        const applicantId = sumsubResp?.id;
        if (applicantId) {
          user.sumsubApplicantId = applicantId;
        }
      } catch (e) {
        console.error('Sumsub applicant creation failed:', e?.response?.data || e.message);
        // Do not block verification on Sumsub failure; surface warning to client
        await user.save();
        return res.status(200).json({
          success: true,
          message: 'OTP verified, but failed to create Sumsub applicant',
          warnings: [{ code: 'SUMSUB_CREATE_FAILED', detail: e?.response?.data || e.message }],
          user: { id: user._id, email: user.email, phone: user.phone, isVerified: user.isVerified, sumsubApplicantId: user.sumsubApplicantId || null },
        });
      }
    }

    await user.save();

    res.json({
      success: true,
      message: 'OTP verified',
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        isVerified: user.isVerified,
        sumsubApplicantId: user.sumsubApplicantId || null,
      },
    });
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
    const { idType: idTypeRaw, country } = req.body;
    const normalizeIdType = (t) => {
      const x = String(t || '').toLowerCase();
      if (x === 'passport') return 'passport';
      if (x === 'driver_license' || x === 'drivers' || x === 'driver') return 'driver_license';
      if (x === 'national_id' || x === 'id' || x === 'id_card') return 'national_id';
      return '';
    };
    const idType = normalizeIdType(idTypeRaw);

    let user = null;
    if (req.user?.userId) {
      user = await User.findById(req.user.userId);
    } else if (req.body.email) {
      user = await User.findOne({ email: req.body.email });
    }
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!idType) return res.status(400).json({ success: false, message: "idType is required and must be one of: 'passport', 'driver_license', 'national_id'" });

    if (!req.files || !req.files.idFront) {
      return res.status(400).json({ success: false, message: 'Front image of ID is required' });
    }

    const isAllowedMime = (m) => {
      const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png']);
      return allowed.has(String(m).toLowerCase());
    };

    const needBack = idType === 'driver_license' || idType === 'national_id';
    if (needBack && !req.files.idBack) {
      return res.status(400).json({ success: false, message: 'Back image of ID is required for this idType' });
    }

    // Validate mime types
    const frontMime = req.files.idFront?.[0]?.mimetype;
    if (!isAllowedMime(frontMime)) {
      return res.status(400).json({ success: false, message: 'Only JPG or PNG images are allowed for front image' });
    }
    if (req.files.idBack) {
      const backMime = req.files.idBack?.[0]?.mimetype;
      if (backMime && !isAllowedMime(backMime)) {
        return res.status(400).json({ success: false, message: 'Only JPG or PNG images are allowed for back image' });
      }
    }

    user.idType = idType;
    // Upload front image to Cloud storage
    const frontResult = await uploadToCloudinary(req.files.idFront[0].path, 'user_ids');
    console.log('Front image uploaded:', frontResult);
    user.idFrontUrl = frontResult;
    // Upload back image if provided or required
    if (req.files.idBack) {
      const backResult = await uploadToCloudinary(req.files.idBack[0].path, 'user_ids');
      user.idBackUrl = backResult;
    }
    user.idStatus = 'under_review';

    // Also persist per-document KYC for independent review/resubmit
    user.kyc = user.kyc || {};
    const setKyc = (typeKey, fUrl, bUrl) => {
      user.kyc[typeKey] = user.kyc[typeKey] || {};
      user.kyc[typeKey].frontUrl = fUrl || user.kyc[typeKey].frontUrl;
      if (bUrl !== undefined) user.kyc[typeKey].backUrl = bUrl || user.kyc[typeKey].backUrl;
      user.kyc[typeKey].status = 'under_review';
    };
    if (idType === 'passport') setKyc('passport', user.idFrontUrl, undefined);
    if (idType === 'driver_license') setKyc('driverLicense', user.idFrontUrl, user.idBackUrl);
    if (idType === 'national_id') setKyc('nationalId', user.idFrontUrl, user.idBackUrl);

    await user.save();

    // Try uploading to Sumsub as well
    const sumsub = { attempted: false, applicantId: user.sumsubApplicantId || null, uploads: [] };
    try {
      // Ensure applicant exists
      if (!user.sumsubApplicantId) {
        const levelName = 'id-and-liveness';
        const resp = await createApplicant(String(user._id), levelName, {});
        user.sumsubApplicantId = resp?.id;
        await user.save();
      }
      sumsub.applicantId = user.sumsubApplicantId;

      // Map idType to Sumsub idDocType
      const mapIdDocType = (t) => {
        const x = String(t || '').toLowerCase();
        if (x === 'passport') return 'PASSPORT';
        if (x === 'driver_license' || x === 'drivers' || x === 'driver') return 'DRIVERS';
        if (x === 'national_id' || x === 'id' || x === 'id_card') return 'ID_CARD';
        return 'PASSPORT';
      };

      const idDocTypeSumsub = mapIdDocType(idType);
      const normalizedCountry = (country || req.body.country || '').toString().toUpperCase();
      if (!normalizedCountry) {
        sumsub.attempted = false;
      } else {
        sumsub.attempted = true;
        // Front side
        const frontFile = req.files.idFront?.[0];
        if (frontFile) {
          const frontBuffer = await (await import('fs')).promises.readFile(frontFile.path);
          const r1 = await uploadDocumentToSumsub({
            applicantId: user.sumsubApplicantId,
            fileBuffer: frontBuffer,
            fileName: frontFile.originalname || 'front',
            mimeType: frontFile.mimetype,
            idDocType: idDocTypeSumsub,
            country: normalizedCountry,
            idDocSubType: idDocTypeSumsub === 'PASSPORT' ? undefined : 'FRONT_SIDE',
          });
          sumsub.uploads.push({ side: 'FRONT', result: r1 });
        }
        // Back side
        const backFile = req.files.idBack?.[0];
        if (idDocTypeSumsub !== 'PASSPORT' && backFile) {
          const backBuffer = await (await import('fs')).promises.readFile(backFile.path);
          const r2 = await uploadDocumentToSumsub({
            applicantId: user.sumsubApplicantId,
            fileBuffer: backBuffer,
            fileName: backFile.originalname || 'back',
            mimeType: backFile.mimetype,
            idDocType: idDocTypeSumsub,
            country: normalizedCountry,
            idDocSubType: 'BACK_SIDE',
          });
          sumsub.uploads.push({ side: 'BACK', result: r2 });
        }
      }
    } catch (e) {
      console.error('Sumsub upload during step2 failed:', e?.response?.data || e.message);
    }

    res.json({ success: true, message: "Your ID is under review. We'll notify you.", idType, frontIdUrl: user.idFrontUrl, backIdUrl: user.idBackUrl || null, kyc: user.kyc, sumsub });
  } catch (err) {
    next(err);
  }
}

export async function signupStep2Json(req, res, next) {
  try {
    console.log('[step2-json] fields:', req.body);
    console.log('[step2-json] files:', Array.isArray(req.files) ? req.files.map(f => ({ field: f.fieldname, originalname: f.originalname, mimetype: f.mimetype, size: f.size })) : req.files);

    const body = req.body || {};

    const pickField = (obj, namesArray) => {
      const names = new Set(namesArray.map(n => String(n).trim().toLowerCase()));
      for (const [rawKey, value] of Object.entries(obj)) {
        const key = String(rawKey).trim().toLowerCase();
        if (names.has(key)) {
          return typeof value === 'string' ? value.trim() : value;
        }
      }
      return undefined;
    };

    const country = pickField(body, ['country', 'cuntry']);
    const idTypeRaw = pickField(body, ['idtype', 'idType']);

    const normalizeIdType = (t) => {
      const x = String(t || '').toLowerCase();
      if (x === 'passport') return 'passport';
      if (x === 'driver_license' || x === 'drivers' || x === 'driver') return 'driver_license';
      if (x === 'national_id' || x === 'id' || x === 'id_card') return 'national_id';
      return '';
    };

    let user = null;
    if (req.user?.userId) {
      user = await User.findById(req.user.userId);
    } else if (req.body.email) {
      user = await User.findOne({ email: req.body.email });
    }
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const idType = normalizeIdType(idTypeRaw);
    if (!idType) return res.status(400).json({ success: false, message: "idType is required and must be one of: 'passport', 'driver_license', 'national_id'" });

    const getUploaded = (names) => {
      if (!req.files) return undefined;
      const wanted = new Set(names);
      if (Array.isArray(req.files)) {
        return req.files.find(f => wanted.has(f.fieldname));
      }
      for (const name of Object.keys(req.files)) {
        if (wanted.has(name) && Array.isArray(req.files[name]) && req.files[name][0]) {
          return req.files[name][0];
        }
      }
      return undefined;
    };

    const uploadedFront = getUploaded(['frontId', 'front', 'idFront']);
    const uploadedBack = getUploaded(['backId', 'back', 'idBack']);
    const base64Front = pickField(body, ['frontId', 'front', 'idFront', 'file', 'document']);
    const base64Back = pickField(body, ['backId', 'back', 'idBack']);

    const needBack = idType === 'driver_license' || idType === 'national_id';

    const hasFront = Boolean(uploadedFront || base64Front);
    const hasBack = Boolean(uploadedBack || base64Back);

    if (!hasFront) return res.status(400).json({ success: false, message: 'frontId image is required' });
    if (needBack && !hasBack) return res.status(400).json({ success: false, message: 'backId image is required for this idType' });

    const parseBase64Image = (data) => {
      if (!data || typeof data !== 'string') return null;
      let mimeType = 'image/jpeg';
      let base64 = data;
      const dataUrlMatch = data.match(/^data:(.+);base64,(.*)$/);
      if (dataUrlMatch) {
        mimeType = dataUrlMatch[1];
        base64 = dataUrlMatch[2];
      }
      return { buffer: Buffer.from(base64, 'base64'), mimeType };
    };

    const isAllowedMime = (m) => {
      const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png']);
      return allowed.has(String(m).toLowerCase());
    };

    const buildImage = (uploadedFile, base64, fallbackName) => {
      if (uploadedFile) {
        if (!isAllowedMime(uploadedFile.mimetype)) return { error: 'Only JPG or PNG images are allowed' };
        return {
          buffer: uploadedFile.buffer,
          mime: uploadedFile.mimetype || 'image/jpeg',
          originalName: uploadedFile.originalname || fallbackName,
        };
      }
      const parsed = parseBase64Image(base64);
      if (!parsed) return null;
      if (!isAllowedMime(parsed.mimeType)) return { error: 'Only JPG or PNG images are allowed' };
      return { buffer: parsed.buffer, mime: parsed.mimeType, originalName: fallbackName };
    };

    const front = buildImage(uploadedFront, base64Front, 'front');
    if (!front || front?.error) return res.status(400).json({ success: false, message: front?.error || 'Invalid frontId/base64 data' });
    const back = hasBack ? buildImage(uploadedBack, base64Back, 'back') : null;
    if (needBack && (!back || back?.error)) return res.status(400).json({ success: false, message: back?.error || 'Invalid backId/base64 data' });

    const ensureTempDir = () => {
      const tempDir = './public/temp';
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      return tempDir;
    };
    const extFromMime = (mime) => (mime === 'image/png' ? '.png' : '.jpg');
    const uploadOne = async (img, label, userId) => {
      const tempDir = ensureTempDir();
      const ext = extFromMime(img.mime);
      const fileName = `${Date.now()}-${label}-${(img.originalName || label).replace(/\s+/g, '-')}${ext}`;
      const tempPath = path.join(tempDir, fileName);
      fs.writeFileSync(tempPath, img.buffer);
      const s3Key = `user_ids/${userId}/${fileName}`;
      const url = await uploadToCloudinary(tempPath, s3Key);
      return url;
    };

    const frontUrl = await uploadOne(front, 'front', user._id);
    const backUrl = back ? await uploadOne(back, 'back', user._id) : undefined;

    user.idType = idType;
    user.idFrontUrl = frontUrl;
    if (backUrl) user.idBackUrl = backUrl;
    user.governmentIdUrl = undefined;
    user.idStatus = 'under_review';

    user.kyc = user.kyc || {};
    const setKyc = (typeKey, fUrl, bUrl) => {
      user.kyc[typeKey] = user.kyc[typeKey] || {};
      user.kyc[typeKey].frontUrl = fUrl || user.kyc[typeKey].frontUrl;
      if (bUrl !== undefined) user.kyc[typeKey].backUrl = bUrl || user.kyc[typeKey].backUrl;
      user.kyc[typeKey].status = 'under_review';
    };
    if (idType === 'passport') setKyc('passport', frontUrl, undefined);
    if (idType === 'driver_license') setKyc('driverLicense', frontUrl, backUrl);
    if (idType === 'national_id') setKyc('nationalId', frontUrl, backUrl);

    await user.save();

    const sumsub = { attempted: false, applicantId: user.sumsubApplicantId || null, uploads: [] };
    try {
      if (!user.sumsubApplicantId) {
        const levelName = 'id-and-liveness';
        const resp = await createApplicant(String(user._id), levelName, {});
        user.sumsubApplicantId = resp?.id;
        await user.save();
      }
      sumsub.applicantId = user.sumsubApplicantId;

      const mapIdDocType = (t) => {
        const x = String(t || '').toLowerCase();
        if (x === 'passport') return 'PASSPORT';
        if (x === 'driver_license' || x === 'drivers' || x === 'driver') return 'DRIVERS';
        if (x === 'national_id' || x === 'id' || x === 'id_card') return 'ID_CARD';
        return 'PASSPORT';
      };

      const idDocTypeSumsub = mapIdDocType(idType);
      const normalizedCountry = country.toString().toUpperCase();
      if (normalizedCountry) {
        sumsub.attempted = true;
        const r1 = await uploadDocumentToSumsub({
          applicantId: user.sumsubApplicantId,
          fileBuffer: front.buffer,
          fileName: front.originalName || 'front',
          mimeType: front.mime,
          idDocType: idDocTypeSumsub,
          country: normalizedCountry,
          idDocSubType: idDocTypeSumsub === 'PASSPORT' ? undefined : 'FRONT_SIDE',
        });
        sumsub.uploads.push({ side: 'FRONT', result: r1 });
        if (idDocTypeSumsub !== 'PASSPORT' && back) {
          const r2 = await uploadDocumentToSumsub({
            applicantId: user.sumsubApplicantId,
            fileBuffer: back.buffer,
            fileName: back.originalName || 'back',
            mimeType: back.mime,
            idDocType: idDocTypeSumsub,
            country: normalizedCountry,
            idDocSubType: 'BACK_SIDE',
          });
          sumsub.uploads.push({ side: 'BACK', result: r2 });
        }
      }
    } catch (e) {
      console.error('Sumsub upload during step2-json failed:', e?.response?.data || e.message);
    }

    return res.json({ success: true, message: 'Document(s) received and under review.', idType, idFrontUrl: frontUrl, idBackUrl: backUrl || null, kyc: user.kyc, sumsub });
  } catch (err) {
    next(err);
  }
}

export async function signupStep3(req, res, next) {
  try {
    const { error } = signupStep3Schema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    let user = null;
    if (req.user?.userId) {
      user = await User.findById(req.user.userId);
    } else if (req.body.email) {
      user = await User.findOne({ email: req.body.email });
    }
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Enforce presence of National ID before proceeding (per your requirement)
    const hasNationalId = Boolean(user?.kyc?.nationalId?.frontUrl);
    if (!hasNationalId) {
      return res.status(400).json({ success: false, message: 'National ID document is required before completing signup.' });
    }

    const { cardType, address } = req.body;
    user.cardType = cardType;
    if (cardType === 'physical') {
      user.address = address;
    } else if (cardType === 'virtual') {
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
    if (error)
      return res.status(400).json({ success: false, message: error.details[0].message });

    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user)
      return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.isVerified)
      return res.status(403).json({ success: false, message: 'Email not verified' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        isVerified: user.isVerified,
      },
    });

  } catch (err) {
    console.error('Login Error:', err);
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

export async function kycStatus(req, res, next) {
  try {
    let user = null;
    if (req.user?.userId) {
      user = await User.findById(req.user.userId);
    } else if (req.query.email || req.body.email) {
      const email = (req.query.email || req.body.email || '').toString().trim();
      user = await User.findOne({ email });
    }
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const kyc = user.kyc || {};
    return res.json({
      success: true,
      kyc: {
        passport: kyc.passport || null,
        driverLicense: kyc.driverLicense || null,
        nationalId: kyc.nationalId || null,
      },
    });
  } catch (err) {
    next(err);
  }
}
