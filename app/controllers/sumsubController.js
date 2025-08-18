import { createApplicant, uploadDocumentToSumsub, uploadDocumentMetadataOnly } from "../sumsub/sumsubService.js";
import formidable from 'formidable';
import fs from 'fs';
import User from '../models/User.js';

export const createApplicantHandler = async (req, res) => {
  try {
    const { userId, firstName, lastName, dob, country } = req.body;
    console.log(req.body);
    const fixedInfo = { firstName, lastName, dob };
    const applicant = await createApplicant(userId, 'id-and-liveness', fixedInfo);
    res.json(applicant);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create applicant' });
  }
};

export const webhookHandler = async (req, res) => {
  try {
    const event = req.body;
    console.log('Received Sumsub webhook:', JSON.stringify(event));

    // Only handle applicantReviewed
    if (event?.type !== 'applicantReviewed') {
      return res.sendStatus(200);
    }

    const applicantId = event.applicantId;
    const reviewStatus = event.reviewStatus || event.review?.reviewStatus || event.review?.status;
    const reviewAnswer = event.reviewResult?.reviewAnswer || event.review?.result?.reviewAnswer; // GREEN or RED
    const rejectLabels = event.reviewResult?.rejectLabels || event.review?.result?.rejectLabels || [];
    const moderationComment = event.reviewResult?.moderationComment || event.review?.result?.moderationComment || null;
    const clientComment = event.reviewResult?.clientComment || event.review?.result?.clientComment || null;

    if (!applicantId) return res.sendStatus(200);

    const user = await User.findOne({ sumsubApplicantId: applicantId });
    if (!user) return res.sendStatus(200);

    // Decide which doc type to update. We infer from what the user last uploaded via idType and existing urls.
    // Priority: if current user.idType exists and kyc slot has URLs, update that slot; else update any slot with URLs
    const pickTypeKey = () => {
      const map = {
        passport: 'passport',
        driver_license: 'driverLicense',
        national_id: 'nationalId',
      };
      const current = map[user.idType] || null;
      if (current && user.kyc?.[current]?.frontUrl) return current;
      if (user.kyc?.nationalId?.frontUrl) return 'nationalId';
      if (user.kyc?.driverLicense?.frontUrl) return 'driverLicense';
      if (user.kyc?.passport?.frontUrl) return 'passport';
      return current || 'passport';
    };

    const typeKey = pickTypeKey();
    user.kyc = user.kyc || {};
    user.kyc[typeKey] = user.kyc[typeKey] || {};
    user.kyc[typeKey].reviewStatus = reviewStatus || 'completed';
    user.kyc[typeKey].reviewAnswer = reviewAnswer || null;
    user.kyc[typeKey].rejectReasons = Array.isArray(rejectLabels) ? rejectLabels : [];
    user.kyc[typeKey].moderationComment = moderationComment || null;
    user.kyc[typeKey].clientComment = clientComment || null;
    user.kyc[typeKey].reviewedAt = new Date();

    if ((reviewAnswer || '').toUpperCase() === 'GREEN') {
      user.kyc[typeKey].status = 'approved';
    } else if ((reviewAnswer || '').toUpperCase() === 'RED') {
      user.kyc[typeKey].status = 'rejected';
    }

    // Optionally set overall idStatus to reflect the latest event for visibility
    user.idStatus = user.kyc[typeKey].status || user.idStatus;

    await user.save();
    return res.sendStatus(200);
  } catch (e) {
    console.error('Webhook processing error:', e?.response?.data || e.message);
    return res.sendStatus(200);
  }
};
export const uploadDocumentHandler = async (req, res) => {
  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(400).json({ error: 'Error parsing form data', details: err.message });
    }

    try {
      const getString = (v) => Array.isArray(v) ? v[0] : v;
      const applicantId = getString(fields.applicantId);
      const idDocType = getString(fields.idDocType);
      const country = getString(fields.country);
      const idDocSubType = getString(fields.idDocSubType);

      const pickFile = (f) => {
        if (!f) return undefined;
        const candidates = ['document', 'file', 'content', 'upload', 'attachment'];
        for (const name of candidates) {
          const value = f[name];
          if (value) return Array.isArray(value) ? value[0] : value;
        }
        const first = Object.values(f)[0];
        return Array.isArray(first) ? first[0] : first;
      };

      const file = pickFile(files);
      console.log('[upload-document] fields:', Object.keys(fields || {}));
      console.log('[upload-document] files keys:', Object.keys(files || {}));
      console.log('>>>>>>>>', file);

      if (!applicantId || !idDocType || !country || !file) {
        return res.status(400).json({ error: 'Missing required fields', details: { applicantId, idDocType, country, hasFile: Boolean(file) } });
      }

      const fileBuffer = fs.readFileSync(file.filepath);

      const result = await uploadDocumentToSumsub({
        applicantId,
        fileBuffer,
        fileName: file.originalFilename || 'upload',
        mimeType: file.mimetype || 'application/octet-stream',
        idDocType,
        country,
        idDocSubType,
      });

      return res.status(200).json({ message: 'Document uploaded to Sumsub', result });
    } catch (error) {
      console.error('Upload error:', error);
      return res.status(500).json({ error: 'Upload failed', details: error.message });
    }
  });
};

export const uploadDocumentDataOnlyHandler = async (req, res) => {
  try {
    // Accept JSON body or form-data style with nested metadata
    const { applicantId, metadata } = req.body || {};

    if (!applicantId || !metadata) {
      return res.status(400).json({ error: 'applicantId and metadata are required' });
    }

    const result = await uploadDocumentMetadataOnly(applicantId, metadata);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error.response?.status || 500).json({ error: error.response?.data || error.message });
  }
};
