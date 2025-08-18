import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';
import FormData from 'form-data';

dotenv.config();

const BASE_URL = (process.env.SUMSUB_BASE_URL || 'https://api.sumsub.com').trim();
const APP_TOKEN = (process.env.SUMSUB_APP_TOKEN || '').trim();
const SECRET_KEY = (process.env.SUMSUB_SECRET_KEY || '').trim();
const DEBUG = (process.env.SUMSUB_DEBUG || '0').trim() === '1';

function mask(value, visible = 4) {
  if (!value) return 'MISSING';
  if (value.length <= visible * 2) return `${value[0]}***${value[value.length - 1]}`;
  return `${value.slice(0, visible)}***${value.slice(-visible)}`;
}

/**
 * Generate HMAC SHA256 signature required by Sumsub API.
 * Updates HMAC in parts per Sumsub example: ts + METHOD + PATH [+ body]
 */
function generateSignature(method, path, ts, body) {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedPath = path && path.startsWith('/') ? path : `/${path || ''}`;
  const hmac = crypto.createHmac('sha256', SECRET_KEY);
  hmac.update(`${ts}${normalizedMethod}${normalizedPath}`);
  if (body !== undefined && body !== null) {
    hmac.update(body);
  }
  return hmac.digest('hex');
}

function assertEnv() {
  if (!APP_TOKEN || !SECRET_KEY) {
    const message = 'Missing SUMSUB_APP_TOKEN or SUMSUB_SECRET_KEY in environment';
    if (DEBUG) {
      console.error('[Sumsub] ENV ERROR:', message, {
        APP_TOKEN: mask(APP_TOKEN),
        SECRET_KEY: mask(SECRET_KEY),
        BASE_URL
      });
    }
    throw new Error(message);
  }
}

/**
 * Create a new applicant in Sumsub.
 * @param {string} externalUserId - Your internal user ID (must be unique per user).
 * @param {string} levelName - Verification level (e.g. 'basic-kyc-level').
 * @param {Object} fixedInfo - Optional applicant details (name, dob, country).
 * @param {Array} metadata - Optional metadata array.
 */
export async function createApplicant(externalUserId, levelName = 'id-and-liveness', fixedInfo = {}, metadata = []) {
  assertEnv();
  const endpointPath = `/resources/applicants?levelName=${encodeURIComponent(levelName)}`;
  const url = `${BASE_URL}${endpointPath}`;
  const ts = Math.floor(Date.now() / 1000).toString();

  const requestBody = {
    externalUserId,
    fixedInfo,
    metadata
  };

  const bodyForSig = JSON.stringify(requestBody);
  const signature = generateSignature('POST', endpointPath, ts, bodyForSig);

  const headers = {
    'X-App-Token': APP_TOKEN,
    'X-App-Access-Ts': ts,
    'X-App-Access-Sig': signature,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  if (DEBUG) {
    console.log('[Sumsub][createApplicant] signingString:', `${ts}POST${endpointPath}${bodyForSig}`);
    console.log('[Sumsub][createApplicant] headers:', {
      'X-App-Token': mask(APP_TOKEN),
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': mask(signature, 6)
    });
  }

  try {
    const response = await axios.post(url, requestBody, { headers });
    return response.data;
  } catch (error) {
    if (DEBUG) console.error('Sumsub createApplicant error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Upload document to Sumsub for a specific applicant (with file content).
 * For multipart/form-data, include the full multipart body in the signature per Sumsub example.
 */
export const uploadDocumentToSumsub = async ({
  applicantId,
  fileBuffer,
  fileName,
  mimeType,
  idDocType,
  country,
  idDocSubType,
}) => {
  assertEnv();
  const endpointPath = `/resources/applicants/${applicantId}/info/idDoc`;
  const url = `${BASE_URL}${endpointPath}`;
  const ts = Math.floor(Date.now() / 1000).toString();

  const form = new FormData();
  const metadata = {
    idDocType: String(idDocType || '').toUpperCase(),
    country: String(country || '').toUpperCase(),
    ...(idDocSubType ? { idDocSubType: String(idDocSubType).toUpperCase() } : {})
  };
  form.append('metadata', JSON.stringify(metadata));
  form.append('content', fileBuffer, {
    filename: fileName,
    contentType: mimeType || 'application/octet-stream',
  });

  // Include full multipart body in signature
  const bodyBuffer = form.getBuffer();
  const signature = generateSignature('POST', endpointPath, ts, bodyBuffer);

  const headersBase = form.getHeaders();
  let contentLength;
  try {
    contentLength = await new Promise((resolve) => {
      form.getLength((err, length) => resolve(err ? undefined : length));
    });
  } catch (_) {}

  const headers = {
    ...headersBase,
    ...(contentLength ? { 'Content-Length': contentLength } : {}),
    'X-App-Token': APP_TOKEN,
    'X-App-Access-Ts': ts,
    'X-App-Access-Sig': signature,
    'X-Return-Doc-Warnings': 'true',
    'Accept': 'application/json'
  };

  if (DEBUG) {
    console.log('[Sumsub][uploadDocument] signingString:', `${ts}POST${endpointPath}[multipart ${contentLength ?? 'chunked'}]`);
    console.log('[Sumsub][uploadDocument] headers:', {
      'X-App-Token': mask(APP_TOKEN),
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': mask(signature, 6)
    });
  }

  try {
    const response = await axios.post(url, form, { headers, maxBodyLength: Infinity });
    return {
      message: 'Document uploaded to Sumsub',
      result: {
        success: true,
        data: response.data,
      },
    };
  } catch (error) {
    if (DEBUG) console.error('Sumsub document upload failed:', error?.response?.data || error.message);
    return {
      message: 'Document uploaded to Sumsub',
      result: {
        success: false,
        error: {
          code: error?.response?.status || 500,
          message: error?.response?.data || error.message,
        },
      },
    };
  }
};

// New: upload only document metadata (no file)
export async function uploadDocumentMetadataOnly(applicantId, metadataInput) {
  assertEnv();
  const endpointPath = `/resources/applicants/${applicantId}/info/idDoc`;
  const url = `${BASE_URL}${endpointPath}`;
  const ts = Math.floor(Date.now() / 1000).toString();

  const normalizedMetadata = {
    ...(metadataInput || {}),
  };
  if (normalizedMetadata.idDocType) {
    normalizedMetadata.idDocType = String(normalizedMetadata.idDocType).toUpperCase();
  }
  if (normalizedMetadata.country) {
    normalizedMetadata.country = String(normalizedMetadata.country).toUpperCase();
  }
  if (normalizedMetadata.idDocSubType) {
    normalizedMetadata.idDocSubType = String(normalizedMetadata.idDocSubType).toUpperCase();
  }

  const form = new FormData();
  form.append('metadata', JSON.stringify(normalizedMetadata));

  // Include full multipart body in signature
  const bodyBuffer = form.getBuffer();
  const signature = generateSignature('POST', endpointPath, ts, bodyBuffer);

  const headersBase = form.getHeaders();
  let contentLength;
  try {
    contentLength = await new Promise((resolve) => {
      form.getLength((err, length) => resolve(err ? undefined : length));
    });
  } catch (_) {}

  const headers = {
    ...headersBase,
    ...(contentLength ? { 'Content-Length': contentLength } : {}),
    'X-App-Token': APP_TOKEN,
    'X-App-Access-Ts': ts,
    'X-App-Access-Sig': signature,
    'Accept': 'application/json'
  };

  if (DEBUG) {
    console.log('[Sumsub][uploadDocumentMetadataOnly] signingString:', `${ts}POST${endpointPath}[multipart ${contentLength ?? 'chunked'}]`);
    console.log('[Sumsub][uploadDocumentMetadataOnly] headers:', {
      'X-App-Token': mask(APP_TOKEN),
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': mask(signature, 6)
    });
    console.log('[Sumsub][uploadDocumentMetadataOnly] metadata:', normalizedMetadata);
  }

  try {
    const response = await axios.post(url, form, { headers });
    return response.data;
  } catch (error) {
    if (DEBUG) console.error('Sumsub metadata-only upload failed:', error?.response?.data || error.message);
    throw error;
  }
}