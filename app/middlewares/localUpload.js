import multer from 'multer';
import path from 'path';
import fs from 'fs';

const tempDir = './public/temp';
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
    cb(null, filename);
  },
});

const upload = multer({ storage });

export default upload; 