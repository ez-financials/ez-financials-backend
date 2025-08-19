import express from 'express';
import { createApplicantHandler, uploadDocumentHandler, webhookHandler, uploadDocumentDataOnlyHandler } from '../controllers/sumsubController.js';


const router = express.Router();

router.post('/create-applicant', createApplicantHandler);
router.get('/webhook', webhookHandler);
router.post('/upload-document', uploadDocumentHandler);
router.post('/upload-document-data', uploadDocumentDataOnlyHandler);

export default router;
