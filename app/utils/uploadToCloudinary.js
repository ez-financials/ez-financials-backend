import AWS from 'aws-sdk';
import fs from 'fs';

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const uploadToS3 = async (filePath, key) => {
  const fileContent = fs.readFileSync(filePath);
  const params = {
    Bucket: "ez-inancials",
    Key: key, // e.g. 'user_ids/filename.jpg'
    Body: fileContent,
  };
  const data = await s3.upload(params).promise();
  fs.unlinkSync(filePath); // Remove local file
  return data.Location; // Public URL
};

export default uploadToS3; 