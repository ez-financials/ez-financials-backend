import AWS from 'aws-sdk';

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const sns = new AWS.SNS();

export async function sendSMS({ to, message }) {
  return sns.publish({
    Message: message,
    PhoneNumber: to, // E.164 format, e.g. +1234567890
  }).promise();
} 